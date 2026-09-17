import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Event log version. Bump this whenever the envelope shape changes: readers
 * must refuse a log they cannot interpret rather than guess at missing fields.
 */
export const EVENT_LOG_VERSION = 1;

const HASHED_FIELDS = ["v", "id", "at", "tick", "type", "actor", "payload", "causes", "provenance", "prev"];

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

/** Walk a chain and report the first index whose link does not verify. */
export function verifyChain(events) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.prev !== previous) return { ok: false, brokenAt: index };
    if (hashEvent(event) !== event.hash) return { ok: false, brokenAt: index };
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
  #appended = 0;
  #failed = 0;
  #lastError = null;

  constructor(statePath) {
    this.#statePath = statePath;
  }

  health() {
    return { appended: this.#appended, failed: this.#failed, lastError: this.#lastError };
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
    }
    return this.#lastHash.get(roomId);
  }

  /** Serialize appends per room; returns the written event. */
  append(roomId, input) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const prev = await this.#lastHashFor(roomId);
        const event = createEvent({ ...input, prev });
        const path = eventLogPath(this.#statePath, roomId);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await appendFile(path, `${serializeEvent(event)}\n`, { encoding: "utf8", mode: 0o600 });
        // Cache before the anchor, not after: the line is what chains, so a
        // failed anchor write must not leave the next append pointing at the
        // line before this one.
        this.#lastHash.set(roomId, event.hash);
        // Only once the line is durable does it become the head. A crash here
        // leaves the anchor one line behind — the accepted residual: a later
        // truncation of exactly that one line is then invisible.
        await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), event.hash);
        this.#appended += 1;
        return event;
      } catch (error) {
        this.#failed += 1;
        this.#lastError = String(error?.message ?? error);
        return null;
      }
    });
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  /**
   * Atomically replace one room's log (restore path only; normal writes never
   * call this, because the log is append-only). The head cache is reset in the
   * same step: it never expires on its own, so without the reset the next
   * append would chain from the pre-restore head and fork the chain silently.
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
      // The sentinel, not a deletion, keeps this one step: a restore to empty
      // must still be able to report a truncation from zero lines.
      await writeHeadAnchor(eventLogHeadPath(this.#statePath, roomId), last ?? NO_HEAD);
      return events;
    });
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  /**
   * Read and verify the whole log; a corrupt line is an error, never skipped.
   *
   * The head anchor is a high-water mark: when it exists and names no event in
   * the file, the file's tail is gone. Only a missing anchor is accepted as
   * "written before anchors existed" — a healthy log always ends at its anchor,
   * so it can never be reported as truncated.
   */
  async read(roomId) {
    const text = await readFile(eventLogPath(this.#statePath, roomId), "utf8").catch((error) => {
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
    const text = await readFile(eventLogHeadPath(this.#statePath, roomId), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    const anchor = text?.trim();
    return anchor ? anchor : null;
  }
}
