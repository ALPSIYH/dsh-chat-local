import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSnapshot } from "../lib/room-export.js";
import { verifyChain } from "../lib/event-log.js";
import { DshChatLocalService } from "../lib/room-store.js";

/**
 * The `randomUUID` a state write is pinned to when a test needs to fail exactly
 * that write. The write path names its temp file `${destination}.${uuid}.tmp`
 * and takes the uuid from the global, so stubbing the global pins the path and a
 * directory can be placed there. The write then fails with the kernel's EISDIR
 * without the destination — the durable state file — being touched at all.
 */
const PINNED_TEMP = "00000000-0000-4000-8000-000000000000";

async function serviceAt(directory) {
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} }, get(n) { return this[n]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  return service;
}

/** Wait until an in-flight turn has delivered, so a restore has a live orphan. */
async function waitFor(predicate, label = "condition") {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Watch the service's state-write tail while a restore runs, so a test can act
 * inside the swap→bump window: the restored room object is live and its own
 * state write is in flight, but `restoreFromSnapshot` has not registered the log
 * replace yet. `afterSwap` runs on the tail assignment of the first save made
 * after the swap — the restore's own save, after that save has claimed — and
 * `atRestoreAwait` runs on the restore's `await this.saveTail` read instead, the
 * second read of the tail after the swap. Whatever `atRestoreAwait` returns
 * (when it returns one) is the promise the restore then waits on, which is how a
 * test puts a save in the window without the restore also joining its write.
 * Both hooks fire at most once, and the accessor is left installed: it shows the
 * same values a plain property would.
 */
function watchRestoreWindow(service, previous, { afterSwap, atRestoreAwait } = {}) {
  let internal = service.journal.writeTail;
  let tailReads = 0;
  let wroteTail = false;
  let awaited = false;
  Object.defineProperty(service.journal, "writeTail", {
    configurable: true,
    get() {
      if (awaited || typeof atRestoreAwait !== "function" || service.state.rooms[0] === previous) return internal;
      tailReads += 1;
      if (tailReads < 2) return internal;
      awaited = true;
      const tail = internal;
      const replacement = atRestoreAwait(service.state.rooms[0]);
      return replacement === undefined ? tail : replacement;
    },
    set(value) {
      internal = value;
      if (wroteTail || service.state.rooms[0] === previous) return;
      wroteTail = true;
      afterSwap?.(service.state.rooms[0]);
    }
  });
}

/** The `message.created` envelope the queue builds for one message. */
function messageCreated(message) {
  return { type: "message.created", actor: { kind: message.authorKind, id: message.author },
    payload: { messageId: message.id, roomSeq: message.roomSeq, text: message.text,
      authorKind: message.authorKind, mentions: [], clientOperationId: null, correctsMessageId: null },
    causes: [], provenance: { originClass: "system", sessionKind: "interactive", messageId: message.id } };
}

/**
 * A service whose single member delivers immediately but whose turn never ends
 * on its own, so a restore can be issued while the turn is genuinely in flight.
 */
function deferredServiceAt(directory) {
  const inFlight = [];
  let waiting = [];
  const release = () => {
    const next = waiting;
    waiting = [];
    for (const resolve of next) resolve();
  };
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: {
      status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => {
        inFlight.push({ from, to, delivery });
        await new Promise((resolve) => waiting.push(resolve));
      }
    },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 4_000 });
  return { service, inFlight, release };
}

test("a snapshot round-trips a room with its event log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = await service.snapshotRun(room.id, "cfg-abc");
  const parsed = JSON.parse(snapshot.content);
  assert.deepEqual(validateSnapshot(parsed).ok, true);
  assert.equal(parsed.configHash, "cfg-abc");
  // The log holds exactly what is durable. A room creation is not an event, and
  // a non-auto-delivered message is audited only by the save that persists it
  // (R20), so this counts the log rather than a fixed guess at its length.
  const durable = await service.eventsFor(room.id);
  assert.deepEqual(parsed.events, durable);
  assert.equal(parsed.events.length >= 1, true);
  assert.equal(parsed.room.messages.length, 1);
  await service.close();
});

test("a run snapshot never lags an append that was already recorded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-lag-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false });
  // A snapshot taken over a lagging chain would silently drop an experiment's
  // events. These appends are issued the way the delivery path issues them —
  // never awaited — and a single snapshot follows them.
  for (let index = 0; index < 20; index += 1) {
    void service.eventLog.append(room.id, { type: "probe", actor: { kind: "system", id: "system" }, payload: { index } });
  }
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  assert.equal(parsed.events.filter((event) => event.type === "probe").length, 20);
  assert.deepEqual(verifyChain(parsed.events), { ok: true, brokenAt: null });
  await service.close();
});

test("a tampered snapshot is rejected with a reason", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  parsed.room.messages[0].text = "被篡改";
  const result = validateSnapshot(parsed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /hash/);
  await service.close();
});

test("restoring requires an explicit confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await assert.rejects(() => service.restoreFromSnapshot(parsed, {}), /confirm/);
  const result = await service.restoreFromSnapshot(parsed, { confirm: true });
  assert.equal(result.roomId, room.id);
  await service.close();
});

test("a restored room keeps writing a continuous chain from the snapshot's head", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "回滚", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  // Diverge after the snapshot: this branch is what the restore must discard.
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const restored = await service.restoreFromSnapshot(snapshot, { confirm: true });
  assert.equal(restored.eventsWritten, snapshot.events.length);
  assert.equal((await service.messages(room.id)).length, 1);
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "三" });
  const events = await service.eventsFor(room.id);
  // The restored log is exactly the snapshot's, then the new message chains onto
  // its head — not onto the discarded branch's head.
  assert.deepEqual(events.slice(0, snapshot.events.length).map((event) => event.hash),
    snapshot.events.map((event) => event.hash));
  assert.equal(events[snapshot.events.length].prev, snapshot.events.at(-1).hash);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await service.close();
});

test("the content hash covers the event log, not just the room", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "覆盖", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  assert.equal(parsed.events.length >= 1, true);
  // Editing the log while leaving `room` alone must still break the hash: a
  // regression that dropped `events` from the hashed material would pass a test
  // that only tampers with the room.
  parsed.events[0].payload = { ...parsed.events[0].payload, text: "被篡改" };
  const result = validateSnapshot(parsed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /hash/);
  await service.close();
});

test("a snapshot whose chain is broken is rejected before anything is overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "断链", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  // Each details edit saves, which is what flushes the preceding message's
  // audit — the snapshot only ever contains durable events.
  const saveNow = async () => service.setRoomDetails(room.id, { name: "断链", expectedRevision: (await service.resolveRoom(room.id)).revision });
  await saveNow();
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  await saveNow();
  // The log also holds the room's own membership fact (R41), so the snapshot
  // taken after the first durable message is two links, not one; the head is
  // still the event with no predecessor.
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events[0].prev, null);
  assert.equal((await service.eventsFor(room.id)).length, 3);
  const before = await service.messages(room.id);
  const beforeEvents = await service.eventsFor(room.id);
  // Re-sign the shortened snapshot so it is otherwise well-formed: what has to
  // refuse it is the chain itself, not the content hash.
  const { createHash } = await import("node:crypto");
  const rebuilt = (events, roomState) => ({ ...later, events, room: roomState,
    contentHash: createHash("sha256").update(JSON.stringify({ room: roomState, events, configHash: later.configHash })).digest("hex") });
  // A snapshot of the same room taken one event later: its second link is real,
  // so dropping the head leaves an event whose `prev` names nothing.
  const later = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  assert.equal(later.events.length, 3);
  assert.equal(later.events[1].prev, later.events[0].hash);
  const noHead = rebuilt(later.events.slice(1), later.room);
  const inspected = validateSnapshot(noHead);
  assert.equal(inspected.ok, false);
  assert.match(inspected.reason, /chain/);
  await assert.rejects(() => service.restoreFromSnapshot(noHead, { confirm: true }), /invalid snapshot/);
  // Even with an intact chain, a room edited on its own is refused by the hash
  // over the pair — the two halves are covered together, not separately.
  const lying = { ...later, room: { ...later.room,
    messages: later.room.messages.map((message) => ({ ...message, text: "被篡改" })) } };
  const lieChecked = validateSnapshot(lying);
  assert.equal(lieChecked.ok, false);
  assert.match(lieChecked.reason, /hash/);
  await assert.rejects(() => service.restoreFromSnapshot(lying, { confirm: true }), /invalid snapshot/);
  // The untampered pair still validates, so the refusals above are about the
  // tampering and not about a snapshot being un-restorable at all.
  assert.equal(validateSnapshot(later).ok, true);
  // Rejected before the swap: state and log are exactly what they were.
  assert.deepEqual((await service.messages(room.id)).map((message) => message.text), before.map((message) => message.text));
  assert.deepEqual((await service.eventsFor(room.id)).map((event) => event.hash), beforeEvents.map((event) => event.hash));
  await service.close();
});

test("a restore stops an in-flight turn instead of letting it write past the swap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const { service, inFlight, release } = deferredServiceAt(directory);
  await service.ready;
  const room = await service.createRoom({ name: "竞态", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  // Start a turn and let it park on the bridge, so the restore lands while the
  // turn is genuinely mid-flight and its room object is about to be orphaned.
  const running = service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await waitFor(() => inFlight.length >= 1, "the delivery");
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await service.restoreFromSnapshot(snapshot, { confirm: true });
  release();
  // Let the orphan's continuation run to completion (or park) before judging it.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const events = await service.eventsFor(room.id);
  // Without superseding, the orphan passes its own epoch guard, records the
  // prompt it was about to deliver, and appends it *after* the restored log was
  // written — the restored room and its log then describe different things.
  assert.deepEqual(events.map((event) => event.hash), snapshot.events.map((event) => event.hash),
    "the orphan wrote nothing past the swap");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await running.catch(() => {});
  await service.close();
});

test("a restore's state file is not rewritten by the turn it superseded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const { service, inFlight, release } = deferredServiceAt(directory);
  await service.ready;
  const room = await service.createRoom({ name: "覆写", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  const running = service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await waitFor(() => inFlight.length >= 1, "the delivery");
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  // A second send supersedes the first turn, so the room the snapshot describes
  // is one epoch behind the orphan still running against it.
  const second = service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  await waitFor(() => inFlight.length >= 2, "the second delivery");
  // The control: what a restore of this snapshot writes when nothing else is
  // running. The restored file must end up identical to this.
  const control = await serviceAt(directory);
  await control.restoreFromSnapshot(snapshot, { confirm: true });
  const expected = JSON.parse(await readFile(join(directory, "rooms.json"), "utf8")).rooms[0];
  await control.close();
  await service.restoreFromSnapshot(snapshot, { confirm: true });
  release();
  await new Promise((resolve) => setTimeout(resolve, 300));
  // A superseded turn keeps running after the swap and does save again. That is
  // safe only because `#save` serialises the live state array — the very object
  // the restore installed — so the orphan's saves write the restored room, and
  // its mutations land on the detached object. This test pins that: if a save
  // ever serialised the orphan, the file would carry its epoch back.
  const onDisk = JSON.parse(await readFile(join(directory, "rooms.json"), "utf8"));
  assert.deepEqual(onDisk.rooms.map((item) => item.id), [room.id]);
  assert.equal(onDisk.rooms[0].epoch, expected.epoch);
  assert.deepEqual(onDisk.rooms[0].orchestration, expected.orchestration);
  assert.deepEqual(onDisk.rooms[0].messages, expected.messages);
  await running.catch(() => {});
  await second.catch(() => {});
  await service.close();
});

/**
 * A restore whose own state write fails has to roll back, keep the audits its
 * save claimed, and keep the append a save that landed in its window still owes.
 *
 * The write fails for real, at the filesystem: a directory is put at the exact
 * temp path the restore's own write will use, so its write fails with the
 * kernel's EISDIR, the way a vanished or read-only path does in production. That
 * path is pinned by stubbing the one input that names it, the write's
 * `randomUUID`. The destination is left as it was, so the test does not write
 * `rooms.json` and the assertion on it can be about the file the failed restore
 * did not produce. A synthetic rejected promise would not model this — the
 * previous version of this test threw before `#save` reached its guarded write,
 * so the audits it had claimed were never re-queued and the path the product
 * actually takes had no coverage — and a single failing save is never concurrent
 * with another flush, so it could not cover the window either.
 */
test("a restore whose save fails leaves memory exactly as it was", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "回滚失败", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const statePath = join(directory, "rooms.json");
  const previous = service.state.rooms[0];
  // A real producer queues the event for the live room and its save is parked, so
  // its write lands only after the restore has swapped the room away. A flush
  // that refuses that entry because the swap has happened drops a fact that *is*
  // the durable state, with no re-queue and no trace, and the log then
  // under-describes `rooms.json` forever.
  let releaseSave;
  const held = new Promise((resolve) => { releaseSave = resolve; });
  service.journal.writeTail = held;
  const producing = service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit",
    expectedRevision: previous.policy.revision, gate: true });
  producing.catch(() => {});
  await waitFor(() => service.journal.writeTail !== held, "the producer's save to claim and park");
  const beforeMessages = (await service.messages(room.id)).map((message) => message.text);
  // One entry the restore's own save will claim, and therefore has to re-queue
  // when its write fails. Queued in the queue's own shape, like every producer.
  const probe = { id: crypto.randomUUID() };
  service.journal.pendingAudits.push({ room: previous,
    build: () => ({ type: "probe.requeued", actor: { kind: "system", id: "system:probe" },
      payload: { id: probe.id }, provenance: { originClass: "system", sessionKind: "interactive" } }),
    stillValid: () => true });
  const restoring = service.restoreFromSnapshot(snapshot, { confirm: true });
  restoring.catch(() => {});
  await waitFor(() => service.journal.replacements.size > 0, "the restore's replace gate");
  // The restore's write is failed for real, at the filesystem, the instant the
  // producer's write has landed and published its flush — after that write and
  // before the restore's own body runs. Its temp file is pinned by stubbing the
  // one thing that names it (the write path has no other input), and a directory
  // is put there, so the kernel refuses the write with EISDIR. The destination is
  // never touched: the test makes no write to `rooms.json`, which is what lets
  // the assertion below be about the file the failed restore did *not* produce.
  const temporary = `${statePath}.${PINNED_TEMP}.tmp`;
  let durable = null;
  let durableIno = null;
  let flush = service.journal.auditFlush;
  const realRandomUUID = crypto.randomUUID;
  Object.defineProperty(service.journal, "auditFlush", {
    configurable: true,
    get() { return flush; },
    set(value) {
      flush = value;
      if (durable !== null || service.journal.replacements.size === 0) return;
      durable = readFileSync(statePath, "utf8");
      durableIno = statSync(statePath).ino;
      crypto.randomUUID = () => PINNED_TEMP;
      mkdirSync(temporary);
    }
  });
  try {
    releaseSave();
    await assert.rejects(() => restoring, (error) => error.code === "EISDIR");
  } finally {
    crypto.randomUUID = realRandomUUID;
    rmSync(temporary, { recursive: true, force: true });
  }
  assert.equal(service.state.rooms[0], previous, "the failed restore was rolled back in memory");
  assert.deepEqual((await service.messages(room.id)).map((message) => message.text), beforeMessages,
    "the failed restore was rolled back in memory");
  // The disk, not the test's own write: the bytes and the inode are the ones the
  // producer's save left, captured before the restore's body ran. A restore that
  // had replaced the file — as one that ignored its own failed write would —
  // would put the older snapshot's bytes there, and a rename always installs a
  // new inode, so both parts of this fail together. That the expectation really
  // is the pre-restore state (which holds 二) and not the snapshot's (which does
  // not) is what gives the pair its teeth.
  assert.equal(durable.includes("二"), true, "the expectation is the pre-restore state, not the snapshot's");
  assert.equal(await readFile(statePath, "utf8"), durable,
    "the failed restore wrote the state file it never made durable");
  assert.equal(statSync(statePath).ino, durableIno,
    "the failed restore replaced the state file it never made durable");
  // A save after the failure re-claims what the failed one re-queued, and the
  // append the producer's write was owed is on the log now that the restore has
  // settled and the room it replaced is live again.
  await service.setRoomDetails(room.id, { name: "回滚后再改",
    expectedRevision: (await service.resolveRoom(room.id)).revision });
  await service.settledAudit();
  const events = await service.eventsFor(room.id);
  assert.equal(events.filter((event) => event.type === "message.created" && event.payload?.authorKind === "system"
    && String(event.payload?.text).includes("read_only_audit")).length, 1,
    "a durable change with no audit event leaves the log under-describing rooms.json");
  assert.deepEqual(events.filter((event) => event.type === "probe.requeued").map((event) => event.payload.id),
    [probe.id], "the audits a failed restore claimed must be re-queued, not discarded");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await service.close();
});

/**
 * A restore installs the restored room and then replaces the log, and the window
 * between the two spans a real state write and the join on it. A save can claim
 * an audit inside that window, and such a save's snapshot *is* the durable state
 * — it is written after the restore's own — so dropping its append leaves the log
 * under-describing `rooms.json`. The entry belongs to the restored object, which
 * is the live one, so the flush's central check keeps it; a guard keyed on the
 * room id plus a counter cannot tell that object from the one it replaced and
 * drops the append instead.
 *
 * The same claim also carries an entry for the discarded object. That one must
 * never reach the restored log: it is the phantom direction of the same rule, and
 * a check that only asks "is this room id still present" would let it through.
 */
test("a legitimate save claimed in a restore's swap→bump window is still audited", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-window-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "窗口", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await service.setRoomDetails(room.id, { name: "窗口改", expectedRevision: (await service.resolveRoom(room.id)).revision });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  const previous = service.state.rooms[0];
  let notice;
  let discarded;
  watchRestoreWindow(service, previous, {
    atRestoreAwait(live) {
      // The change this save will write, with the event that explains it queued
      // in the queue's own shape. It is built here rather than through a producer
      // because every producer awaits `ready` before it queues, and only a claim
      // made synchronously with this read lands before the bump.
      live.roomSeq += 1;
      notice = { id: crypto.randomUUID(), roomId: live.id, roomSeq: live.roomSeq, author: "system:probe",
        authorKind: "system", authorAlias: "窗口", sentAt: Date.now(), actionMode: live.policy.defaultActionMode,
        policyRevision: live.policy.revision, mentions: [], deliveries: [], text: "窗口内的持久变更" };
      live.messages.push(notice);
      discarded = { id: crypto.randomUUID() };
      service.journal.pendingAudits.push({ room: live, build: () => messageCreated(notice),
        stillValid: () => live.messages.some((item) => item.id === notice.id) });
      service.journal.pendingAudits.push({ room: previous,
        build: () => ({ type: "probe.discarded", actor: { kind: "system", id: "system:probe" },
          payload: { id: discarded.id }, provenance: { originClass: "system", sessionKind: "interactive" } }),
        stillValid: () => true });
      // The workspace's own save callback claims synchronously; a public method
      // would await `ready` first and claim after the bump instead.
      void service.workspace.persist().catch(() => {});
    }
  });
  await service.restoreFromSnapshot(snapshot, { confirm: true });
  await service.settledAudit();
  const onDisk = JSON.parse(await readFile(join(directory, "rooms.json"), "utf8")).rooms[0];
  const events = await service.eventsFor(room.id);
  assert.deepEqual(onDisk.messages.filter((message) => message.id === notice.id).map((message) => message.id),
    [notice.id], "the window save's snapshot is the durable state");
  assert.deepEqual(events.filter((event) => event.payload?.messageId === notice.id).map((event) => event.payload.messageId),
    [notice.id], "a durable change with no audit event leaves the log under-describing rooms.json");
  assert.deepEqual(events.filter((event) => event.type === "probe.discarded"), [],
    "an entry for the room object this restore replaced reached the restored log");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await service.close();
});

/**
 * The same window has a second edge. A save claimed after the swap belongs to the
 * restored object, so the identity half of the flush's check passes — but the
 * restore only joins that save's *write*, not its flush, so the flush can run
 * before the restore registers the replace. An append registered first is then
 * erased by the replace: the change is durable and the log has no event for it.
 * A restore must therefore publish its replace at the swap, so a flush that could
 * append to that room waits for it and lands after it.
 */
test("an audit append claimed for the restored room is ordered after the log replace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-order-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "次序", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await service.setRoomDetails(room.id, { name: "次序改", expectedRevision: (await service.resolveRoom(room.id)).revision });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  const previous = service.state.rooms[0];
  const order = [];
  watchRestoreWindow(service, previous, {
    afterSwap(live) {
      // A real policy change, claimed inside the window. Its save chains behind
      // the restore's own write, so the restore does join that write — and
      // without the replace published at the swap this save's flush ends up
      // appending before the replace registers, which erases it.
      void service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit",
        expectedRevision: live.policy.revision, gate: true }).catch(() => {});
    }
  });
  const append = service.eventLog.append.bind(service.eventLog);
  service.eventLog.append = (roomId, input) => {
    order.push(`append:${input?.type}`);
    return append(roomId, input);
  };
  const replace = service.eventLog.replace.bind(service.eventLog);
  service.eventLog.replace = (roomId, events) => {
    order.push("replace");
    return replace(roomId, events);
  };
  await service.restoreFromSnapshot(snapshot, { confirm: true });
  await service.settledAudit();
  const onDisk = JSON.parse(await readFile(join(directory, "rooms.json"), "utf8")).rooms[0];
  const events = await service.eventsFor(room.id);
  assert.equal(onDisk.policy.gate, true, "the window save's policy change is the durable state");
  assert.equal(events.filter((event) => event.type === "message.created"
    && event.payload.authorKind === "system").length, 1,
    "the durable policy change was appended after the log it belongs to was replaced");
  // The ordering itself, not only its outcome: an append the log's writer
  // received before the replace is one the replace erases.
  assert.deepEqual(order, ["replace", "append:message.created"],
    "the append was registered after the replace, so the replace cannot erase it");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await service.close();
});

/**
 * A failed state write re-queues its claimed audits as raw entries, and a raw
 * entry holds the room object it was queued against. If a restore lands before
 * the next save, that save re-claims the entry after the swap — its `stillValid`
 * only asks whether the discarded room still holds the message, which it does,
 * because nothing mutates that detached object — and a guard keyed on the room
 * id sees the same room and lets it through. The entry is then an orphan event in
 * the restored log: a `message.created` for a message no restored state contains.
 * Object identity refuses it, because the object it names is not the live room.
 */
test("a failed-write audit re-queued across a restore does not leak into the replaced log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-orphan-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "孤儿", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await service.setRoomDetails(room.id, { name: "孤儿改", expectedRevision: (await service.resolveRoom(room.id)).revision });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  const previous = service.state.rooms[0];
  // A state write that fails on a schedule: it claims the policy notice, and the
  // failure lands once the restore's own save has already claimed — so the
  // restore never sees the re-queued entry and a later save is the one that does.
  let failWrite;
  const held = new Promise((resolve, reject) => { failWrite = reject; });
  let internal = held;
  let fired = false;
  Object.defineProperty(service.journal, "writeTail", {
    configurable: true,
    get() { return internal; },
    set(value) {
      internal = value;
      if (fired || service.state.rooms[0] === previous) return;
      fired = true;
      failWrite(new Error("simulated state write failure"));
    }
  });
  const failing = service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit",
    expectedRevision: previous.policy.revision, gate: true });
  failing.catch(() => {});
  // The failure is scheduled from the restore's own save, so the restore has to
  // be running before it can happen: start it, then let the held write fail.
  const restoring = service.restoreFromSnapshot(snapshot, { confirm: true });
  await assert.rejects(() => failing, /simulated state write failure/);
  await restoring;
  // A save after the restore is what re-claims the re-queued raw entry.
  await service.setRoomDetails(room.id, { name: "孤儿再改", expectedRevision: (await service.resolveRoom(room.id)).revision });
  await service.settledAudit();
  const events = await service.eventsFor(room.id);
  const orphans = events.filter((event) => event.type === "message.created"
    && event.payload.authorKind === "system");
  assert.deepEqual(orphans, [], "a re-queued entry for the replaced room was appended into the restored log");
  assert.deepEqual(events, snapshot.events, "the restored log is exactly the snapshot's log");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  await service.close();
});

/**
 * The wait a flush makes on a log replace is acyclic only because a room id has
 * at most one replace in flight. With two, two concurrent restores of one room
 * can each claim an audit entry for that room and wait on the other's replace —
 * each released only after its own save returns, which it cannot while its flush
 * is waiting. That is the mutual wait this test pins; both saves here claim an
 * entry, which the round's liveness harness never constructed, so the schedule
 * it exercises is reachable rather than hypothetical.
 *
 * The assertion on `maxInFlight` is taken before the schedules are released: on
 * a tree without the per-room restore lock the second restore has already
 * swapped and opened its replace by then, so this fails on the count instead of
 * hanging, and the settle below is the backstop for the wait itself.
 */
test("two restores of one room are serialised, so the mutual wait cannot form", { timeout: 8_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-serial-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "串行", autoDeliver: false });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  const live = service.state.rooms[0];
  const registry = service.journal.replacements;
  const open = registry.open.bind(registry);
  let maxInFlight = 0;
  registry.open = (roomId) => {
    const entry = open(roomId);
    maxInFlight = Math.max(maxInFlight, registry.size);
    return entry;
  };
  const claim = (id) => ({ room: live,
    build: () => ({ type: "probe.claimed", actor: { kind: "system", id: "system:probe" },
      payload: { id }, provenance: { originClass: "system", sessionKind: "interactive" } }),
    stillValid: () => true });
  let releaseSave;
  const held = new Promise((resolve) => { releaseSave = resolve; });
  service.journal.writeTail = held;
  service.journal.pendingAudits.push(claim("first"));
  const first = service.restoreFromSnapshot(snapshot, { confirm: true });
  first.catch(() => {});
  await waitFor(() => service.journal.replacements.size === 1, "the first restore's replace");
  service.journal.pendingAudits.push(claim("second"));
  const second = service.restoreFromSnapshot(snapshot, { confirm: true });
  second.catch(() => {});
  // On a tree without the per-room lock the second restore swaps and claims here;
  // with it, the second restore is parked and has opened nothing.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(maxInFlight, 1, "two log replaces were in flight for one room at once");
  assert.equal(service.journal.replacements.size, 1, "only the running restore's replace is in flight");
  releaseSave();
  const settled = await Promise.allSettled([first, second]);
  const statuses = settled.map((result) => result.status);
  assert.deepEqual(statuses, ["fulfilled", "fulfilled"],
    `a restore did not settle (${statuses.join(",")}): ${settled.map((result) => result.reason?.message ?? "").join("; ")}`);
  assert.equal(registry.size, 0, "a log replace was left registered");
  await service.settledAudit();
  assert.deepEqual(verifyChain(await service.eventsFor(room.id)), { ok: true, brokenAt: null });
  await service.close();
});

/**
 * A flush re-looks-up a room's replace after every wait, so the registry must
 * drop an entry before that entry's promise can resolve. If it resolved while
 * still registered, the re-lookup would find the same replace again on every
 * pass and the flush would spin in microtasks forever — a hang in which even
 * timers stop firing. The claim here is empty, so nothing waits on the replace
 * and the registry's state at the moment it resolves is directly observable.
 */
test("a log replace is dropped from the registry before its waiters resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-drop-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "掉落", autoDeliver: false });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  let releaseSave;
  const held = new Promise((resolve) => { releaseSave = resolve; });
  service.journal.writeTail = held;
  const restoring = service.restoreFromSnapshot(snapshot, { confirm: true });
  await waitFor(() => service.journal.replacements.get(room.id), "the restore's replace");
  const replace = service.journal.replacements.get(room.id);
  assert.deepEqual(Object.keys(replace).sort(), ["promise", "roomId"], "replacement waiters must never receive its resolver");
  let observed = "the replace never resolved";
  void replace.promise.then(() => { observed = service.journal.replacements.get(room.id); });
  releaseSave();
  await restoring;
  assert.equal(observed, null,
    "the replace was still registered when it resolved, so a flush that re-looks-up would wait on it again forever");
  assert.equal(service.journal.replacements.size, 0, "a log replace was left registered");
  await service.close();
});
