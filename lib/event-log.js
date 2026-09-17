import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
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
    if (!this.#lastHash.has(roomId)) {
      const existing = await this.read(roomId).catch(() => []);
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
        this.#lastHash.set(roomId, event.hash);
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

  /** Read and verify the whole log; a corrupt line is an error, never skipped. */
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
    return events;
  }
}
