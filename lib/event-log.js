import { createHash, randomUUID } from "node:crypto";
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
