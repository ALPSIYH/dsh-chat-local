import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
async function writeHeadAnchor(path, line) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, line, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
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
  #lastHash = new Map();
  #lastAt = new Map();
  #appended = 0;
  #failed = 0;
  #lastError = null;
  #dropped = [];
  #droppedCount = 0;

  constructor(statePath) {
    this.#statePath = statePath;
  }

  /**
   * Health shape for `/health`. `appended` and `failed` are lifetime tallies;
   * `lastError` is the most recent failure and is cleared by the next success,
   * so it describes current health rather than latching the first transient
   * fault forever. `dropped` names the most recent claims that never got an
   * event, newest last, capped; `droppedCount` keeps the full total.
   */
  health() {
    return { appended: this.#appended, failed: this.#failed, lastError: this.#lastError,
      droppedCount: this.#droppedCount, dropped: this.#dropped.map((gap) => ({ ...gap })) };
  }

  /**
   * Warm the head cache for the given rooms. Called once, before any room can
   * be written to, so the first append to a room is a write rather than a full
   * parse of the room's log inside the send path. A room that fails to verify
   * is left cold instead of seeded: `append` re-reads and reports it, so
   * priming can never turn a detected truncation into a silent fork.
   */
  async prime(roomIds) {
    await Promise.all([...roomIds].map(async (roomId) => {
      if (this.#lastHash.has(roomId)) return;
      try {
        const existing = await this.read(roomId).catch((error) => {
          if (error?.code === "ENOENT") return [];
          throw error;
        });
        this.#lastHash.set(roomId, existing.at(-1)?.hash ?? null);
        // Seeded from the same parse, so warming the `at` guard costs no second
        // read of the room's log.
        this.#lastAt.set(roomId, atSeed(existing.at(-1)));
      } catch { /* left cold: the first append re-reads and counts the failure */ }
    }));
  }

  /**
   * Await every append already queued. Delivery events are recorded without
   * being awaited by their caller, so both a reader and a shutdown need this:
   * a read must not return a snapshot missing appends that were already
   * recorded, and shutdown must not race a write into `events/`.
   *
   * Safe to await from a reader: the chain never waits on a reader — only
   * `append`'s own `#lastHashFor` calls `read`, and `read` never touches the
   * chain — so this cannot wait on itself. Every stored tail is also wrapped in
   * `.catch`, so no entry can leave a pass pending.
   */
  async drain() {
    // Two passes: the first settles what is queued now, the second covers an
    // append queued by a continuation of the first. `append` registers its tail
    // synchronously, so everything issued before this call is in the first pass.
    await Promise.allSettled([...this.#tails.values()]);
    await Promise.allSettled([...this.#tails.values()]);
  }

  async #lastHashFor(roomId) {
    // `has`, not truthiness: an empty log's head is legitimately `null`, and
    // re-reading it on every append would cost a full log parse.
    if (!this.#lastHash.has(roomId)) {
      // Only a genuinely absent log means "no head". Letting a verification
      // failure through to `append`'s catch is what keeps it visible: swallowing
      // it would seed the head at `null`, chain the next event onto nothing, and
      // turn a detected truncation into a permanent silent fork.
      const existing = await this.read(roomId).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      this.#lastHash.set(roomId, existing.at(-1)?.hash ?? null);
      // The `at` guard is seeded from the parse that is happening anyway: the
      // last event's stamp is where the room's clock resumes.
      this.#lastAt.set(roomId, atSeed(existing.at(-1)));
    }
    return this.#lastHash.get(roomId);
  }

  /** Serialize appends per room; returns the written event. */
  append(roomId, input) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const prev = await this.#lastHashFor(roomId);
        // Append order is the log's ordering truth, so `at` is strictly
        // increasing within a room. Two events written in the same millisecond
        // would otherwise carry the same `(tick, at)` and the derivation would
        // order them by their random `id` — the same interaction sequence could
        // then yield different counters on different runs. `has`, not
        // truthiness: `0` is a valid seed, and an unseeded room starts at it.
        const lastAt = this.#lastAt.has(roomId) ? this.#lastAt.get(roomId) : 0;
        // A caller that states `at` keeps it verbatim; anything else means
        // "now", floored by the guard. The cache is only ever raised, so even an
        // explicitly supplied past stamp cannot let the next append fall behind
        // a line that is already on disk.
        const wanted = Number.isFinite(input?.at) ? input.at : null;
        const at = wanted ?? Math.max(Date.now(), lastAt + 1);
        const event = createEvent({ ...input, at, prev });
        const path = eventLogPath(this.#statePath, roomId);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        // The write path is type-checked for the same reason the read path is,
        // and it is the worse of the two when it is skipped: opening a named pipe
        // for writing blocks until a reader appears, so an append to a swapped-in
        // FIFO waits forever — and because `drain()` awaits the per-room tail, the
        // wait takes every read of that room and `close()` with it, and a bare
        // process does not exit. A refused append is a counted, dropped append
        // (below), which is the documented degradation rather than a deadlock.
        await assertRegularFile(path);
        await appendFile(path, `${serializeEvent(event)}\n`, { encoding: "utf8", mode: 0o600 });
        // Cache before the anchor, not after: the line is what chains, so a
        // failed anchor write must not leave the next append pointing at the
        // line before this one. The `at` guard is cached here for the same
        // reason: the line is durable, whatever happens to the anchor, so the
        // next append must stay strictly after it.
        this.#lastHash.set(roomId, event.hash);
        this.#lastAt.set(roomId, Math.max(lastAt, at));
        // Only once the line is durable does it become the head. A crash here
        // leaves the anchor one line behind — the accepted residual: a later
        // truncation of exactly that one line is then invisible.
        await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), event.hash);
        this.#appended += 1;
        // The log is healthy again as of this line, so a transient failure must
        // not stay latched as if it were still current: `failed` keeps the
        // lifetime tally.
        this.#lastError = null;
        return event;
      } catch (error) {
        this.#failed += 1;
        this.#lastError = errorLeaf(error);
        // A dropped append is a permanent hole whose record is already durable
        // and will never be retried, so the gap is named rather than only
        // counted: an operator can tell which message has no event at all.
        this.#droppedCount += 1;
        this.#dropped.push({ roomId, type: input?.type ?? null,
          messageId: input?.payload?.messageId ?? input?.provenance?.messageId ?? null });
        if (this.#dropped.length > DROPPED_LIMIT) this.#dropped.shift();
        return null;
      }
    });
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  /**
   * Atomically replace one room's log (restore path only; normal writes never
   * call this, because the log is append-only). The head cache and the `at`
   * guard are both reset in the same step: neither expires on its own, so
   * without the reset the next append would chain from the pre-restore head and
   * fork the chain silently, or resume from a stamp the restored log no longer
   * contains.
   */
  replace(roomId, events) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const path = eventLogPath(this.#statePath, roomId);
      const last = events.at(-1)?.hash ?? null;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, events.map((event) => `${serializeEvent(event)}\n`).join(""),
        { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
      // Reset the cache here, not after the anchor: the renamed log is already
      // the room's log, so from this point the restored head is the only correct
      // predecessor. A failed anchor write would otherwise leave the cache on
      // the pre-restore head and fork the chain invisibly.
      this.#lastHash.set(roomId, last);
      // The `at` guard is reset in the same step, for the same reason: the log
      // on disk is now the restored one, so a stale high-water mark would push
      // the next append's `at` forward from a history that no longer exists.
      // Each rewritten event keeps its own original `at`; only the guard moves.
      this.#lastAt.set(roomId, atSeed(events.at(-1)));
      // The sentinel, not a deletion, keeps this one step: a restore to empty
      // must still be able to report a truncation from zero lines.
      await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), last ?? NO_HEAD);
      return events;
    });
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  /**
   * Parse one room's log, oldest first, and check it against its head anchor; a
   * corrupt line is an error, never skipped.
   *
   * This parses and anchor-checks; it does not verify the chain link by link.
   * `verifyChain` is the function that does, and a caller that needs that
   * guarantee must run it over the events this returns.
   *
   * The head anchor is a high-water mark: when it exists and names no event in
   * the file, the file's tail is gone. Only a missing anchor is accepted as
   * "written before anchors existed" — a healthy log always ends at its anchor,
   * so it can never be reported as truncated.
   *
   * Both files are type-checked before they are read: a non-regular file would
   * not fail, it would wait forever. See `assertRegularFile`.
   */
  async read(roomId) {
    const path = eventLogPath(this.#statePath, roomId);
    await assertRegularFile(path);
    const text = await readFile(path, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const events = [];
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); }
      catch { throw new Error(`event log is corrupt at line ${index + 1}`); }
    }
    const anchor = await this.#readHeadAnchor(roomId);
    if (anchor === null || anchor === NO_HEAD) return events;
    if (!events.some((event) => event.hash === anchor)) {
      throw new Error(`event log is truncated: head anchor is ${anchor} but the log's last line is ${events.at(-1)?.hash ?? "none"}`);
    }
    return events;
  }

  /** The recorded head hash, or null when the log predates anchors. */
  async #readHeadAnchor(roomId) {
    const path = eventLogHeadPath(this.#statePath, roomId);
    await assertRegularFile(path);
    const text = await readFile(path, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    const anchor = text?.trim();
    return anchor ? anchor : null;
  }
}
