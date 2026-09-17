import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent, serializeEvent, verifyChain, EVENT_LOG_VERSION, EventLog } from "../lib/event-log.js";

/** A log in its own temp directory, with the room log path the anchor sits beside. */
async function temporaryLog() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  return { directory, log: new EventLog(join(directory, "rooms.json")), path: join(directory, "events", "r1.jsonl") };
}

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

test("truncating a log to zero lines is reported by the head anchor", async () => {
  const { log, path } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  // The worst case: every line is gone, so an unanchored chain walk would call
  // the empty log healthy.
  await writeFile(path, "");
  await assert.rejects(() => log.read("r1"), /event log is truncated/);
});

test("truncating a log by two or more lines is reported by the head anchor", async () => {
  const { log, path } = await temporaryLog();
  for (const type of ["a", "b", "c"]) {
    await log.append("r1", { type, actor: { kind: "system", id: "system" }, payload: {} });
  }
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  await writeFile(path, `${lines.slice(0, 1).join("\n")}\n`);
  // The surviving prefix still verifies against itself, so only the anchor can
  // tell that the tail is missing.
  await assert.rejects(() => log.read("r1"), /event log is truncated/);
});

test("a healthy log reports no truncation and read does not throw", async () => {
  const { log } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  const events = await log.read("r1");
  assert.deepEqual(events.map((event) => event.type), ["a", "b"]);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
});

test("a log written before the anchor existed is not a false positive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  // Pre-Task-6 logs have no anchor; they must keep reading as before.
  await rm(join(directory, "events", "r1.jsonl.head"));
  assert.equal((await log.read("r1")).length, 1);
});

test("an append immediately after replace keeps the chain continuous", async () => {
  const { directory, log, path } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  const restored = createEvent({ type: "restored", actor: { kind: "system", id: "system" }, payload: {} });
  // A fresh instance so the head cache is not pre-seeded by the appends above:
  // restore then happens exactly as it does after a process restart.
  const reopened = new EventLog(join(directory, "rooms.json"));
  await reopened.replace("r1", [restored]);
  await reopened.append("r1", { type: "after", actor: { kind: "system", id: "system" }, payload: {} });
  const events = await reopened.read("r1");
  assert.deepEqual(events.map((event) => event.type), ["restored", "after"]);
  // Without the head-cache reset the second event would chain to the pre-restore
  // head and this would be broken.
  assert.equal(events[1].prev, restored.hash);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  assert.equal(await readFile(`${path}.head`, "utf8"), events[1].hash);
});

test("an append after replace on the same instance keeps the chain continuous", async () => {
  const { log } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  const restored = createEvent({ type: "restored", actor: { kind: "system", id: "system" }, payload: {} });
  await log.replace("r1", [restored]);
  const appended = await log.append("r1", { type: "after", actor: { kind: "system", id: "system" }, payload: {} });
  // This is R12: without resetting the room's head cache, prev would be the
  // pre-restore head and the chain would fork silently.
  assert.equal(appended.prev, restored.hash);
  assert.deepEqual(verifyChain(await log.read("r1")), { ok: true, brokenAt: null });
});

test("a failed anchor write never forks the chain the line already joined", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  const first = await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  // Replace the anchor file with a directory: the line is still writable, so
  // the append fails only after its line has landed.
  await rm(join(directory, "events", "r1.jsonl.head"));
  await mkdir(join(directory, "events", "r1.jsonl.head"));
  assert.equal(await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} }), null);
  await rm(join(directory, "events", "r1.jsonl.head"), { recursive: true });
  const third = await log.append("r1", { type: "c", actor: { kind: "system", id: "system" }, payload: {} });
  assert.equal(third.prev === first.hash, false, "the third line chains onto the line that is really on disk");
  const lines = (await readFile(join(directory, "events", "r1.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((event) => event.type), ["a", "b", "c"]);
  assert.deepEqual(verifyChain(lines), { ok: true, brokenAt: null });
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
