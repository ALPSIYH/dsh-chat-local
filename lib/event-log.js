import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Event log version. Bump this whenever the envelope shape changes: readers
 * must refuse a log they cannot interpret rather than guess at missing fields.
 */
export const EVENT_LOG_VERSION = 1;

const HASHED_FIELDS = ["v", "id", "at", "tick", "type", "actor", "payload", "causes", "provenance", "prev"];

/** How many named gaps the health shape lists before it is count-only. */
const DROPPED_LIMIT = 20;

/** The first absolute path a message embeds, POSIX or Windows drive. */
const PATH_IN_MESSAGE = /(?:[A-Za-z]:\\|\/)[^\s'",;)]+/;

/** The deepest component of a path, under either separator. */
function leafName(value) {
  const parts = String(value).split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts.at(-1) : String(value);
}

/**
 * The seed for a room's `at` guard: the stamp of the log's last event, or 0 for
 * an empty log and for an envelope whose stamp is not a number. Normalising here
 * keeps the guard a finite number by construction, so `lastAt + 1` can never
 * turn into `NaN` and silently drop the monotonicity the guard exists for.
 */
function atSeed(event) {
  return Number.isFinite(event?.at) ? event.at : 0;
}

/**
 * A path-free leaf for the health endpoint: the errno code plus the basename the
 * failure named. A raw Node message embeds the absolute path it failed on, and
 * `/health` answers unauthenticated on loopback, so the path never leaves the
 * process — but the code and the leaf still say what failed. Only fs errors
 * carry a code, and only fs errors name a path; the errors this module raises
 * itself (truncation, corruption) are path-free and pass through unchanged.
 */
function errorLeaf(error) {
  const code = typeof error?.code === "string" && error.code ? error.code : null;
  const raw = String(error?.message ?? error);
  if (!code) return raw;
  const named = raw.match(PATH_IN_MESSAGE)?.[0];
  return named ? `${code}: ${leafName(named)}` : code;
}

/**
 * Canonical JSON: keys sorted at every depth, so a hash never depends on the
 * order a caller happened to build an object in.
 *
 * This is the single serializer for the log: `serializeEvent` writes exactly
 * this text, so the bytes on disk are the bytes that were hashed and a
 * faithful read-back can never fail its own verification. `Array.from` (not
 * `map`) so a sparse array's holes materialise as `null` instead of being
 * skipped, which would emit invalid JSON such as `[,1]`.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashEvent(event) {
  const material = Object.fromEntries(HASHED_FIELDS.map((field) => [field, event[field] ?? null]));
  return createHash("sha256").update(canonical(material)).digest("hex");
}

/**
 * Build one immutable event. `prev` chains to the previous event's hash so a
 * rewritten history is detectable; `provenance` is never model-authored.
 */
export function createEvent({ type, actor, payload, causes = [], provenance, tick = 0, at = Date.now(), prev = null }) {
  const event = {
    v: EVENT_LOG_VERSION,
    id: randomUUID(),
    at,
    tick,
    type: String(type),
    actor: actor ?? { kind: "system", id: "system" },
    payload: payload ?? {},
    causes: [...causes],
    provenance: provenance ?? {},
    prev
  };
  event.hash = hashEvent(event);
  return event;
}

/**
 * One event per line. Serialised with `canonical` rather than `JSON.stringify`
 * so the written bytes are exactly the hashed bytes; embedded newlines are
 * impossible because `canonical` escapes them via `JSON.stringify` on strings.
 */
export function serializeEvent(event) {
  const line = canonical(event);
  if (line.includes("\n")) throw new Error("event log line must not contain a raw newline");
  return line;
}

/**
 * Walk a chain and report the first index whose link does not verify. The
 * envelope version is checked first: a log this build cannot interpret must be
 * refused rather than walked as if the fields it knows were all there are.
 * A success carries no `reason`; a failure names one.
 */
export function verifyChain(events) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.v !== EVENT_LOG_VERSION) return { ok: false, brokenAt: index, reason: "unsupported-version" };
    if (event.prev !== previous) return { ok: false, brokenAt: index, reason: "broken-chain" };
    if (hashEvent(event) !== event.hash) return { ok: false, brokenAt: index, reason: "hash-mismatch" };
    previous = event.hash;
  }
  return { ok: true, brokenAt: null };
}

/** Per-room log path: `<state dir>/events/<roomId>.jsonl`. */
export function eventLogPath(statePath, roomId) {
  return join(dirname(statePath), "events", `${roomId}.jsonl`);
}

/**
 * Head anchor for one room's log: the hash of its last line, beside the log.
 * The file name derives from the log path so there is still exactly one place
 * that decides where a room's log lives.
 */
export function eventLogHeadPath(statePath, roomId) {
  return `${eventLogPath(statePath, roomId)}.head`;
}

/**
 * The anchor's null sentinel: a log with no head at all still needs a readable
 * marker, so `read` can tell "restored empty" from "predates the anchor". The
 * word can never collide with a hash, which is hex.
 */
const NO_HEAD = "null";

/**
 * Write one room's head anchor. The anchor is a high-water mark for `read`, so
 * it must be complete before it is visible: temp file, then rename.
 */
async function syncPath(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicText(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    await syncPath(temporary);
    await rename(temporary, path);
    await syncPath(dirname(path));
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

async function writeHeadAnchor(path, line) { await atomicText(path, line); }

function operationHash(input) {
  const provenance = { ...(input?.provenance ?? {}) };
  delete provenance.operationId;
  delete provenance.operationHash;
  return createHash("sha256").update(canonical({ type: String(input?.type),
    actor: input?.actor ?? { kind: "system", id: "system" }, payload: input?.payload ?? {},
    causes: input?.causes ?? [], provenance, tick: input?.tick ?? 0,
    at: Number.isFinite(input?.at) ? input.at : null })).digest("hex");
}

function requireChain(events) {
  const checked = verifyChain(events);
  if (!checked.ok) throw new Error(`event log chain verification failed at ${checked.brokenAt}: ${checked.reason}`);
}

function parseEvents(text) {
  const events = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch { throw new Error(`event log is corrupt at line ${index + 1}`); }
  }
  return events;
}

function conflict() {
  return Object.assign(new Error("event log operation id conflict: input differs from the completed operation"), { code: "OPERATION_CONFLICT" });
}

/**
 * Refuse a log path that is not a regular file, before anything reads it.
 *
 * `readFile` on a named pipe does not fail: it waits for a writer, and if none
 * ever comes it waits forever. A FIFO (or socket, device or directory) sitting
 * where `<room>.jsonl` belongs would therefore hang every reader — the read-only
 * evaluation script, its CI run, and an operator's own checks — with no error
 * and no output. A hang is worse than a refusal, so the type is settled first.
 * The path is stat'd, which follows a symlink: a link to a regular file is still
 * a regular file, and only a genuine non-regular target is refused. A missing
 * path is not an error here; the caller's `ENOENT` handling is unchanged. The
 * message carries the leaf name rather than the absolute path, for the same
 * reason every other failure this module reports does.
 */
async function assertRegularFile(path) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile()) {
    throw new Error(`event log is not a regular file (refused a FIFO, socket, device or directory): ${leafName(path)}`);
  }
}

/**
 * Append-only per-room event log. Writes are chained through a promise so two
 * concurrent callers can never interleave a partial line, and a write failure
 * degrades the audit trail without failing the room operation it observed —
 * but it is counted, because a silently missing audit trail is worse than a
 * visible one.
 */
export class EventLog {
  #statePath;
  #tails = new Map();
  #cache = new Map();
  #appended = 0;
  #failed = 0;
  #lastError = null;
  #dropped = [];
  #droppedCount = 0;
  #pendingRecovery = new Set();
  #recoveredOperations = 0;

  constructor(statePath) { this.#statePath = statePath; }

  health() {
    return { appended: this.#appended, failed: this.#failed, lastError: this.#lastError,
      droppedCount: this.#droppedCount, dropped: this.#dropped.map(gap => ({ ...gap })),
      pendingRecovery: this.#pendingRecovery.size, pendingRooms: [...this.#pendingRecovery].sort(),
      recoveredOperations: this.#recoveredOperations };
  }

  #enqueue(roomId, operation) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const next = previous.then(operation);
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  #pendingPath(roomId) { return `${eventLogPath(this.#statePath, roomId)}.pending`; }
  #receiptPath(roomId) { return `${eventLogPath(this.#statePath, roomId)}.operations`; }

  async #optional(path, encoding) {
    await assertRegularFile(path);
    try { return await readFile(path, encoding); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }

  async #signature(roomId) {
    const parts = [];
    for (const path of [eventLogPath(this.#statePath, roomId), eventLogHeadPath(this.#statePath, roomId)]) {
      await assertRegularFile(path);
      try {
        const info = await stat(path, { bigint: true });
        parts.push(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
      } catch (error) { if (error?.code !== "ENOENT") throw error; parts.push("absent"); }
    }
    return parts.join("|");
  }

  async #receipts(roomId) {
    const text = await this.#optional(this.#receiptPath(roomId), "utf8");
    if (text === null) return [];
    let value;
    try { value = JSON.parse(text); } catch { throw new Error("event log operation receipts are corrupt"); }
    if (value?.version !== 1 || !Array.isArray(value.operations)
      || value.operations.some(item => typeof item?.id !== "string" || typeof item?.hash !== "string")) {
      throw new Error("event log operation receipts are invalid");
    }
    return value.operations;
  }

  async #writeIntent(roomId, input) {
    const body = { version: 1, roomId, ...input };
    const checksum = createHash("sha256").update(canonical(body)).digest("hex");
    await atomicText(this.#pendingPath(roomId), `${canonical({ ...body, checksum })}\n`);
    this.#pendingRecovery.add(roomId);
  }

  async #intent(roomId) {
    let text;
    try { text = await this.#optional(this.#pendingPath(roomId), "utf8"); }
    catch (error) {
      // An unreadable intent is still unresolved work. File-type and access
      // errors must not make the health report look like no intent exists.
      this.#pendingRecovery.add(roomId);
      throw error;
    }
    if (text === null) { this.#pendingRecovery.delete(roomId); return null; }
    this.#pendingRecovery.add(roomId);
    let value;
    try { value = JSON.parse(text); } catch { throw new Error("event log pending intent is corrupt; recovery refused"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("event log pending intent is invalid; recovery refused");
    const { checksum, ...body } = value;
    if (body.version !== 1 || body.roomId !== roomId || !["append", "replace"].includes(body.kind)
      || createHash("sha256").update(canonical(body)).digest("hex") !== checksum) {
      throw new Error("event log pending intent is invalid; recovery refused");
    }
    return body;
  }

  async #clearIntent(roomId) {
    await rm(this.#pendingPath(roomId), { force: true });
    this.#pendingRecovery.delete(roomId);
    await syncPath(dirname(this.#pendingPath(roomId)));
  }

  async #completeReplace(roomId, intent) {
    requireChain(intent.events);
    if (typeof intent.operationId === "string") {
      if (createHash("sha256").update(canonical(intent.events)).digest("hex") !== intent.operationHash) {
        throw new Error("event log replacement intent content hash is invalid");
      }
      const receipts = await this.#receipts(roomId);
      const previous = receipts.find(item => item.id === intent.operationId);
      if (previous) {
        if (previous.hash !== intent.operationHash) throw conflict();
        return;
      }
    }
    const path = eventLogPath(this.#statePath, roomId);
    await atomicText(path, intent.events.map(event => `${serializeEvent(event)}\n`).join(""));
    await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), intent.events.at(-1)?.hash ?? NO_HEAD);
    if (typeof intent.operationId === "string") {
      const receipts = await this.#receipts(roomId);
      receipts.push({ id: intent.operationId, hash: intent.operationHash });
      await atomicText(this.#receiptPath(roomId), `${canonical({ version: 1, operations: receipts })}\n`);
    }
  }

  async #recoverDisk(roomId) {
    const intent = await this.#intent(roomId);
    if (!intent) return false;
    this.#cache.delete(roomId);
    if (intent.kind === "replace") {
      await this.#completeReplace(roomId, intent);
    } else {
      const path = eventLogPath(this.#statePath, roomId);
      const bytes = await this.#optional(path) ?? Buffer.alloc(0);
      if (!Number.isSafeInteger(intent.baseBytes) || intent.baseBytes < 0 || bytes.length < intent.baseBytes) {
        throw new Error("event log pending append base is truncated; recovery refused");
      }
      const base = bytes.subarray(0, intent.baseBytes), events = parseEvents(base.toString("utf8"));
      requireChain(events);
      if ((events.at(-1)?.hash ?? null) !== intent.baseHash || intent.event?.prev !== intent.baseHash
        || hashEvent(intent.event) !== intent.event.hash || intent.event.v !== EVENT_LOG_VERSION) {
        throw new Error("event log pending append base changed; recovery refused");
      }
      if (![undefined, "", "\n"].includes(intent.separator)) throw new Error("event log pending separator is invalid");
      const wanted = Buffer.from(`${intent.separator ?? ""}${serializeEvent(intent.event)}\n`), tail = bytes.subarray(intent.baseBytes);
      if (tail.length > wanted.length || !tail.equals(wanted.subarray(0, tail.length))) {
        throw new Error("event log pending append has unrelated trailing bytes; recovery refused");
      }
      if (tail.length !== wanted.length) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        if (bytes.length > intent.baseBytes) await truncate(path, intent.baseBytes);
        await appendFile(path, wanted, { mode: 0o600 });
      }
      // A complete line may be present only in the page cache if the process
      // stopped after appendFile but before fsync. Recovery must sync it too.
      await syncPath(path);
      await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), intent.event.hash);
    }
    await this.#clearIntent(roomId);
    this.#recoveredOperations += 1;
    this.#lastError = null;
    return true;
  }

  /** Explicitly mutating recovery; ordinary reads and evaluation stay read-only. */
  recover(roomId) {
    return this.#enqueue(roomId, async () => {
      try {
        const recovered = await this.#recoverDisk(roomId);
        this.#lastError = null;
        return { roomId, recovered };
      } catch (error) {
        this.#failed += 1;
        this.#lastError = errorLeaf(error);
        throw error;
      }
    });
  }

  async recoverAll() {
    const directory = dirname(eventLogPath(this.#statePath, "placeholder"));
    let names;
    try { names = await readdir(directory); }
    catch (error) {
      if (error?.code === "ENOENT") return [];
      this.#failed += 1;
      this.#lastError = errorLeaf(error);
      throw error;
    }
    const suffix = ".jsonl.pending";
    return Promise.all(names.filter(name => name.endsWith(suffix)).sort()
      .map(name => this.recover(name.slice(0, -suffix.length))));
  }

  /** Prime verifies the full chain; a changed inode/size/timestamp invalidates it. */
  async prime(roomIds) {
    await Promise.all([...roomIds].map(roomId => this.#enqueue(roomId, () => this.#verified(roomId)).catch(() => {})));
  }

  async #verified(roomId) {
    const signature = await this.#signature(roomId);
    const cached = this.#cache.get(roomId);
    if (cached?.signature === signature) return cached;
    const { events, bytes, needsSeparator } = await this.#readDisk(roomId, true);
    requireChain(events);
    const operations = new Map();
    for (const event of events) {
      const id = event.provenance?.operationId;
      if (typeof id !== "string") continue;
      if (operations.has(id)) throw new Error("event log has duplicate operation ids");
      operations.set(id, event);
    }
    const value = { signature, head: events.at(-1)?.hash ?? null, at: atSeed(events.at(-1)),
      bytes, needsSeparator, operations };
    this.#cache.set(roomId, value);
    return value;
  }

  async drain() {
    await Promise.allSettled([...this.#tails.values()]);
    await Promise.allSettled([...this.#tails.values()]);
  }

  appendOnce(roomId, input, operationId) {
    if (typeof operationId !== "string" || !operationId) return Promise.reject(new TypeError("operation id must be a non-empty string"));
    return this.append(roomId, input, operationId);
  }

  /**
   * A stable operation id makes a retry return the already durable event.
   * Dedupe follows the current chain: an explicit restore intentionally removes
   * post-snapshot events and their append identities. Replacement identities
   * themselves are retained separately so a retried restore is never replayed.
   */
  append(roomId, input, operationId) {
    input = structuredClone(input);
    return this.#enqueue(roomId, async () => {
      let ownEventId;
      let durableEvent = false;
      try {
        await this.#recoverDisk(roomId);
        const cached = await this.#verified(roomId);
        const fingerprint = operationId === undefined ? null : operationHash(input);
        if (operationId !== undefined && (typeof operationId !== "string" || !operationId)) throw new TypeError("operation id must be a non-empty string");
        const prior = operationId === undefined ? null : cached.operations.get(operationId);
        if (prior) {
          if (prior.provenance.operationHash !== fingerprint) throw conflict();
          return structuredClone(prior);
        }
        const wanted = Number.isFinite(input?.at) ? input.at : null;
        const at = wanted ?? Math.max(Date.now(), cached.at + 1);
        const event = JSON.parse(serializeEvent(createEvent({ ...input, at, prev: cached.head,
          ...(operationId === undefined ? {} : { provenance: { ...(input?.provenance ?? {}), operationId, operationHash: fingerprint } }) })));
        ownEventId = event.id;
        const separator = cached.needsSeparator ? "\n" : "";
        const path = eventLogPath(this.#statePath, roomId), line = `${separator}${serializeEvent(event)}\n`;
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await assertRegularFile(path);
        await this.#writeIntent(roomId, { kind: "append", baseBytes: cached.bytes, baseHash: cached.head, separator, event });
        await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
        await syncPath(path);
        await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), event.hash);
        durableEvent = true;
        this.#appended += 1;
        await this.#clearIntent(roomId);
        cached.head = event.hash;
        cached.at = Math.max(cached.at, at);
        cached.bytes += Buffer.byteLength(line);
        cached.needsSeparator = false;
        cached.signature = await this.#signature(roomId);
        if (operationId !== undefined) cached.operations.set(operationId, structuredClone(event));
        this.#lastError = null;
        return event;
      } catch (error) {
        this.#cache.delete(roomId);
        if (error?.code === "OPERATION_CONFLICT") throw error;
        this.#failed += 1;
        this.#lastError = errorLeaf(error);
        // A retained intent is repairable work, not a permanently dropped fact.
        // Probe the path as atomic publication may have succeeded before fsync
        // reported a failure, in which case #writeIntent did not return.
        const pending = await this.#intent(roomId).catch(() => null);
        if (!durableEvent && !(ownEventId && pending?.kind === "append" && pending.event?.id === ownEventId)) {
          this.#droppedCount += 1;
          this.#dropped.push({ roomId, type: input?.type ?? null,
            messageId: input?.payload?.messageId ?? input?.provenance?.messageId ?? null });
          if (this.#dropped.length > DROPPED_LIMIT) this.#dropped.shift();
        }
        return null;
      }
    });
  }

  /** Idempotent replacement receipts prevent a retried restore erasing later writes. */
  replace(roomId, events, operationId) {
    events = structuredClone(events);
    return this.#enqueue(roomId, async () => {
      await this.#recoverDisk(roomId);
      requireChain(events);
      const fingerprint = createHash("sha256").update(canonical(events)).digest("hex");
      if (operationId !== undefined && (typeof operationId !== "string" || !operationId)) throw new TypeError("operation id must be a non-empty string");
      if (operationId !== undefined) {
        const previous = (await this.#receipts(roomId)).find(item => item.id === operationId);
        if (previous) { if (previous.hash !== fingerprint) throw conflict(); return events; }
      }
      const intent = { kind: "replace", events, ...(operationId === undefined ? {} : { operationId, operationHash: fingerprint }) };
      await this.#writeIntent(roomId, intent);
      this.#cache.delete(roomId);
      await this.#completeReplace(roomId, intent);
      await this.#clearIntent(roomId);
      return events;
    });
  }

  /** Read-only coherent read. Interrupted writes require explicit recovery. */
  read(roomId) { return this.#enqueue(roomId, () => this.#readDisk(roomId)); }

  async #readDisk(roomId, details = false) {
    if (await this.#intent(roomId)) throw new Error("event log recovery required: unfinished write intent; run service recovery before reading");
    const text = await this.#optional(eventLogPath(this.#statePath, roomId), "utf8") ?? "";
    const events = parseEvents(text);
    const anchor = (await this.#optional(eventLogHeadPath(this.#statePath, roomId), "utf8"))?.trim();
    if (anchor && anchor !== NO_HEAD && !events.some(event => event.hash === anchor)) {
      throw new Error(`event log is truncated: head anchor is ${anchor} but the log's last line is ${events.at(-1)?.hash ?? "none"}`);
    }
    return details ? { events, bytes: Buffer.byteLength(text), needsSeparator: text.length > 0 && !text.endsWith("\n") } : events;
  }
}
