import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent, hashEvent, serializeEvent, verifyChain, EVENT_LOG_VERSION, EventLog } from "../lib/event-log.js";
import { deriveRelationships } from "../lib/relationship.js";

/** A log in its own temp directory, with the room log path the anchor sits beside. */
async function temporaryLog() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  return { directory, log: new EventLog(join(directory, "rooms.json")), path: join(directory, "events", "r1.jsonl") };
}

/**
 * Run `body` with `Date.now` pinned to one value, restoring the real clock
 * afterwards. Tests in a file run sequentially, so this cannot leak into a
 * neighbouring test; pinning the clock is what makes "same millisecond"
 * provable rather than sampled.
 */
async function withFrozenClock(now, body) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return await body();
  } finally {
    Date.now = real;
  }
}

/** One `ledger.transition` append for the frozen-clock derivations below. */
function transitionInput(payload) {
  return { type: "ledger.transition", actor: { kind: "session", id: "s1" }, payload,
    provenance: { roomId: "r1", actorId: "s1" } };
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
  assert.deepEqual(verifyChain([a, tampered, c]), { ok: false, brokenAt: 1, reason: "hash-mismatch" });
});

test("an envelope version this build cannot read is refused, not walked", () => {
  const event = createEvent({ type: "a", actor: { kind: "human", id: "human:me" },
    payload: {}, provenance: { roomId: "r" } });
  // `v` is part of the hash material, so the bump is re-hashed: otherwise the
  // hash check would reject this event anyway and the version check would never
  // be the reason it was refused.
  const future = { ...event, v: EVENT_LOG_VERSION + 1 };
  future.hash = hashEvent(future);
  // The chain itself is intact: prev and hash both verify. Only the reader's
  // ability to interpret the envelope is in question.
  assert.deepEqual(verifyChain([future]), { ok: false, brokenAt: 0, reason: "unsupported-version" });
  assert.deepEqual(verifyChain([event]), { ok: true, brokenAt: null });
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

test("a replace whose anchor write fails still chains the next append onto the restored head", async () => {
  const { log, path } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  const restored = createEvent({ type: "restored", actor: { kind: "system", id: "system" }, payload: {} });
  // Occupy the anchor path: the log's own rename lands first, then the anchor
  // write fails. This is the one window where the cache and the disk can
  // disagree about which head is current.
  await rm(`${path}.head`);
  await mkdir(`${path}.head`);
  await assert.rejects(() => log.replace("r1", [restored]));
  await rm(`${path}.head`, { recursive: true });
  const appended = await log.append("r1", { type: "after", actor: { kind: "system", id: "system" }, payload: {} });
  // A pre-restore head here would chain to an event the restored log no longer
  // contains — the R12 defect on the failure path.
  assert.equal(appended.prev, restored.hash);
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((event) => event.type), ["restored", "after"]);
  assert.deepEqual(verifyChain(lines), { ok: true, brokenAt: null });
});

test("an append onto a truncated log is refused and counted, never healed into a fork", async () => {
  const { directory, log, path } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  // Truncate to zero lines, leaving the anchor in place.
  await writeFile(path, "");
  // A fresh instance is the case that matters: after a restart the head cache is
  // cold, so the append has to read and verify the log it is about to join.
  const reopened = new EventLog(join(directory, "rooms.json"));
  const refused = await reopened.append("r1", { type: "c", actor: { kind: "system", id: "system" }, payload: {} });
  assert.equal(refused, null, "the append degrades rather than throwing");
  assert.equal(reopened.health().failed, 1);
  assert.match(reopened.health().lastError, /truncated/);
  // Nothing was written, so the truncation stays visible instead of being
  // papered over by a new head.
  await assert.rejects(() => reopened.read("r1"), /event log is truncated/);
  assert.equal(await readFile(path, "utf8"), "");
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

test("a reported write failure names the file without leaking its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  // This is the real shape of the leak: occupying the events directory with a
  // file fails the append with ENOTDIR, whose raw Node message embeds the
  // absolute path it failed on. /health answers unauthenticated on loopback, so
  // that message must never be what is published.
  await writeFile(join(directory, "events"), "not a directory");
  assert.equal(await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} }), null);
  const { lastError } = log.health();
  assert.equal(typeof lastError, "string");
  assert.ok(!lastError.includes("/"), `the reported error must carry no path: ${lastError}`);
  assert.ok(!lastError.includes(directory), "the reported error must not carry the state directory");
  // Still diagnostic: the errno code and the leaf that failed.
  assert.match(lastError, /^ENOTDIR/);
  assert.match(lastError, /r1\.jsonl/);
});

test("a later successful append clears the latched error but not the count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const path = join(directory, "rooms.json");
  const log = new EventLog(path);
  await writeFile(join(directory, "events"), "not a directory");
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  assert.notEqual(log.health().lastError, null);
  // Repair the directory, then append for real: the most recent failure is no
  // longer the log's current health, so it must not stay latched for the
  // lifetime of the process while `failed` keeps the lifetime tally.
  await rm(join(directory, "events"));
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  assert.equal(log.health().appended, 1);
  assert.equal(log.health().failed, 1);
  assert.equal(log.health().lastError, null);
});

test("a dropped append is named, not only counted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await writeFile(join(directory, "events"), "not a directory");
  await log.append("r1", { type: "message.created", actor: { kind: "human", id: "human:me" },
    payload: { messageId: "m1" }, provenance: { roomId: "r1" } });
  const health = log.health();
  assert.equal(health.failed, 1);
  assert.equal(health.droppedCount, 1);
  // The message is already durable and will never get an event, so the gap is
  // identifying: an operator can tell which record has no audit trail.
  assert.deepEqual(health.dropped, [{ roomId: "r1", type: "message.created", messageId: "m1" }]);
  // The health shape is a snapshot, not a handle on the live list.
  health.dropped.push({ roomId: "forged" });
  assert.equal(log.health().dropped.length, 1);
});

test("the named gaps are bounded, so a long outage cannot grow the health shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await writeFile(join(directory, "events"), "not a directory");
  for (let index = 0; index < 25; index += 1) {
    await log.append("r1", { type: "message.created", actor: { kind: "human", id: "human:me" },
      payload: { messageId: `m${index}` }, provenance: { roomId: "r1" } });
  }
  const health = log.health();
  assert.equal(health.droppedCount, 25);
  assert.equal(health.dropped.length, 20);
  // The most recent gaps are the ones worth naming.
  assert.equal(health.dropped.at(-1).messageId, "m24");
});

test("a primed log appends without parsing the room file again", async () => {
  const { directory, log } = await temporaryLog();
  const first = await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  // Priming is what moves the full-log parse out of the send path: a fresh
  // instance starts cold, exactly as it does after a process restart.
  const reopened = new EventLog(join(directory, "rooms.json"));
  await reopened.prime(["r1"]);
  reopened.read = async () => { throw new Error("append must not read the log"); };
  const appended = await reopened.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  assert.ok(appended, `the primed append must not fall back to a read (${reopened.health().lastError})`);
  assert.equal(appended.prev, first.hash);
  assert.equal(reopened.health().appended, 1);
});

test("priming a log it cannot verify leaves it cold, so the truncation still surfaces", async () => {
  const { directory, log, path } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} });
  await writeFile(path, "");
  // A cold cache is the safe failure: priming must never seed a head from a log
  // it could not verify, or a detected truncation would become a silent fork.
  const reopened = new EventLog(join(directory, "rooms.json"));
  await assert.doesNotReject(() => reopened.prime(["r1"]));
  assert.equal(await reopened.append("r1", { type: "c", actor: { kind: "system", id: "system" }, payload: {} }), null);
  assert.match(reopened.health().lastError, /truncated/);
  assert.equal(reopened.health().failed, 1);
});

test("same-millisecond appends get strictly increasing at and are derived in append order", async () => {
  const { log } = await temporaryLog();
  const now = 1_800_000_000_000;
  // Every append below happens at the same wall-clock reading: the guard, not
  // the clock, is what orders them.
  const events = await withFrozenClock(now, async () => {
    await log.append("r1", { type: "turn.scheduled", tick: 1, actor: { kind: "system", id: "system" },
      payload: { rootMessageId: "m1", epoch: 1, recipients: ["s1"], order: "configured", rotationStart: 0,
        executed: ["s1"] }, provenance: { roomId: "r1" } });
    // A blocked report and the resume that retires it, written back to back. An
    // unguarded log stamps both with `at = now`; the derivation then breaks the
    // `(tick, at)` tie with the events' random UUIDs, and whether the report is
    // seen before its confirmation — `blockedConfirmed` 1 or 0 — is luck.
    await log.append("r1", transitionInput({ entryId: "e1", revision: 1, kind: "task", action: "progress",
      status: "blocked", ownerSessionId: "s1", state: "blocked" }));
    await log.append("r1", transitionInput({ entryId: "e1", revision: 2, kind: "task", action: "progress",
      status: "open", ownerSessionId: "s1", state: "in_progress" }));
    assert.equal(Date.now(), now, "the clock must not move inside the frozen window");
    return log.read("r1");
  });
  assert.deepEqual(events.map((event) => event.type), ["turn.scheduled", "ledger.transition", "ledger.transition"]);
  // The invariant the fix exists for: append order is the order, and it is
  // visible in the stamps alone, with no id to break a tie.
  assert.deepEqual(events.map((event) => event.at), [now, now + 1, now + 2]);
  assert.ok(events[1].at > events[0].at && events[2].at > events[1].at);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });

  const counters = (result) => result.pairs.find((pair) => pair.observer === "s1" && pair.target === "s1").counters;
  const derived = deriveRelationships({ events, roomId: "r1" });
  assert.equal(counters(derived).blockedReports, 1);
  assert.equal(counters(derived).blockedConfirmed, 1);
  // The count is a function of `(tick, at)` alone: the same envelopes handed
  // over in the opposite array order derive identically, so no id and no input
  // order can decide whether the resume retires the report.
  assert.deepEqual(deriveRelationships({ events: [...events].reverse(), roomId: "r1" }), derived);
});

test("an explicit at is honoured verbatim and never lets the room's guard go backwards", async () => {
  const { log } = await temporaryLog();
  const stated = await log.append("r1", { type: "a", actor: { kind: "system", id: "system" },
    payload: {}, provenance: { roomId: "r1" }, at: 5_000 });
  assert.equal(stated.at, 5_000, "a caller's explicit stamp is not rewritten");
  // The wall clock is far behind the stamp already on disk. The guard keeps the
  // next append strictly after the line that is really there.
  const next = await withFrozenClock(1_000, () => log.append("r1", { type: "b",
    actor: { kind: "system", id: "system" }, payload: {}, provenance: { roomId: "r1" } }));
  assert.equal(next.at, 5_001);
  assert.deepEqual(verifyChain(await log.read("r1")), { ok: true, brokenAt: null });
});

test("a cold cache seeds the at guard from the log it already reads", async () => {
  const { directory, log } = await temporaryLog();
  const first = await log.append("r1", { type: "a", actor: { kind: "system", id: "system" },
    payload: {}, provenance: { roomId: "r1" }, at: 7_000 });
  // A fresh instance is the restart case: the head cache is cold, so `append`
  // parses the log once. The guard is seeded from that same parse — no second
  // read — and the clock has gone backwards since the line was written.
  const reopened = new EventLog(join(directory, "rooms.json"));
  const second = await withFrozenClock(1_000, () => reopened.append("r1", { type: "b",
    actor: { kind: "system", id: "system" }, payload: {}, provenance: { roomId: "r1" } }));
  assert.equal(second.prev, first.hash);
  assert.equal(second.at, 7_001);
  assert.deepEqual((await reopened.read("r1")).map((event) => event.at), [7_000, 7_001]);
  assert.deepEqual(verifyChain(await reopened.read("r1")), { ok: true, brokenAt: null });
});

test("priming seeds the at guard from the same parse as the head", async () => {
  const { directory, log } = await temporaryLog();
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" },
    payload: {}, provenance: { roomId: "r1" }, at: 4_000 });
  // Warming is what keeps the first append after a restart off the room's log;
  // the guard is warmed from that same parse, so it needs no read of its own.
  const reopened = new EventLog(join(directory, "rooms.json"));
  await reopened.prime(["r1"]);
  const appended = await withFrozenClock(1_000, () => reopened.append("r1", { type: "b",
    actor: { kind: "system", id: "system" }, payload: {}, provenance: { roomId: "r1" } }));
  assert.equal(appended.at, 4_001);
});

test("replace resets the at guard and preserves every rewritten stamp", async () => {
  const { log } = await temporaryLog();
  // A far-future stamp, so a guard left over from before the restore is
  // unmistakable: it would push the next append past it instead of following
  // the restored log.
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" },
    payload: {}, provenance: { roomId: "r1" }, at: 9_000_000_000_000 });
  const first = createEvent({ type: "restored.1", actor: { kind: "system", id: "system" }, payload: {}, at: 1_500 });
  const second = createEvent({ type: "restored.2", actor: { kind: "system", id: "system" }, payload: {},
    at: 1_700, prev: first.hash });
  await log.replace("r1", [first, second]);
  const appended = await withFrozenClock(2_000, () => log.append("r1", { type: "after",
    actor: { kind: "system", id: "system" }, payload: {}, provenance: { roomId: "r1" } }));
  assert.equal(appended.at, 2_000, "the guard restarts from the restored log, not from the replaced one");
  const events = await log.read("r1");
  // `replace` rewrites the events as they were: their own stamps are untouched.
  assert.deepEqual(events.map((event) => event.at), [1_500, 1_700, 2_000]);
  assert.deepEqual(events.map((event) => event.type), ["restored.1", "restored.2", "after"]);
  assert.equal(events[0].hash, first.hash);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
});

test("drain waits for appends no caller awaited", async () => {
  const { log } = await temporaryLog();
  let settled = 0;
  const track = (promise) => promise.then((event) => { if (event) settled += 1; });
  // Fire-and-forget, exactly as the delivery path issues them, then drain alone:
  // a caller that removes the state tree right after must find the log complete.
  track(log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} }));
  track(log.append("r1", { type: "b", actor: { kind: "system", id: "system" }, payload: {} }));
  await log.drain();
  assert.equal(settled, 2);
  const events = await log.read("r1");
  assert.equal(events.length, 2);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
});
