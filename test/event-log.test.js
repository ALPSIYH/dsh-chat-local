import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent, serializeEvent, verifyChain, EVENT_LOG_VERSION, EventLog } from "../lib/event-log.js";

test("an event carries version, provenance and a hash over its own content", () => {
  const event = createEvent({
    type: "message.created", tick: 7, at: 1_700_000_000_000,
    actor: { kind: "session", id: "s1" },
    payload: { messageId: "m1", text: "你好" },
    causes: ["m0"],
    provenance: { originClass: "agent", sessionKind: "interactive", roomId: "r1" }
  });
  assert.equal(event.v, EVENT_LOG_VERSION);
  assert.equal(event.tick, 7);
  assert.equal(typeof event.id, "string");
  assert.equal(event.prev, null);
  assert.equal(typeof event.hash, "string");
  assert.equal(event.hash.length, 64);
});

test("serialization is one line and round-trips", () => {
  const event = createEvent({ type: "t", actor: { kind: "human", id: "human:me" },
    payload: { text: "多行\n内容" }, provenance: { roomId: "r1" } });
  const line = serializeEvent(event);
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line).payload, { text: "多行\n内容" });
});

test("a tampered event breaks the chain at its index", () => {
  const a = createEvent({ type: "a", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" } });
  const b = createEvent({ type: "b", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: a.hash });
  const c = createEvent({ type: "c", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: b.hash });
  assert.deepEqual(verifyChain([a, b, c]), { ok: true, brokenAt: null });
  const tampered = { ...b, payload: { sneaky: true } };
  assert.deepEqual(verifyChain([a, tampered, c]), { ok: false, brokenAt: 1 });
});

test("a serialized line verifies after read-back even with an undefined-valued key", () => {
  const event = createEvent({ type: "a", actor: { kind: "human", id: "human:me" },
    payload: { x: undefined }, provenance: { roomId: "r" } });
  assert.deepEqual(verifyChain([JSON.parse(serializeEvent(event))]), { ok: true, brokenAt: null });
});

test("append chains events and read returns them in order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await log.append("r1", { type: "a", actor: { kind: "human", id: "human:me" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "human", id: "human:me" }, payload: {} });
  const events = await log.read("r1");
  assert.deepEqual(events.map((event) => event.type), ["a", "b"]);
  assert.equal(events[1].prev, events[0].hash);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
});

test("concurrent appends stay serialized and never interleave", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await Promise.all(Array.from({ length: 20 }, (_v, index) =>
    log.append("r1", { type: `t${index}`, actor: { kind: "system", id: "system" }, payload: { index } })));
  const events = await log.read("r1");
  assert.equal(events.length, 20);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  assert.deepEqual(events.map((event) => event.payload.index).sort((a, b) => a - b), [...Array(20).keys()]);
});

test("a truncated or corrupt line is reported, not silently skipped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  const path = join(directory, "events", "r1.jsonl");
  await writeFile(path, (await readFile(path, "utf8")) + "{\"half\":");
  await assert.rejects(() => log.read("r1"), /event log is corrupt at line 2/);
});

test("an append failure degrades without throwing and is counted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  // Make the events directory un-creatable by occupying the path with a file.
  await writeFile(join(directory, "events"), "not a directory");
  await assert.doesNotReject(() => log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} }));
  assert.equal(log.health().appended, 0);
  assert.ok(log.health().failed >= 1);
});
