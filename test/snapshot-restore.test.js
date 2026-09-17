import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSnapshot } from "../lib/room-export.js";
import { verifyChain } from "../lib/event-log.js";
import { DshChatLocalService } from "../lib/room-store.js";

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
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].prev, null);
  assert.equal((await service.eventsFor(room.id)).length, 2);
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
  assert.equal(later.events.length, 2);
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

test("a restore whose save fails leaves memory exactly as it was", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "回滚失败", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const statePath = join(directory, "rooms.json");
  const before = await readFile(statePath, "utf8");
  const beforeMessages = (await service.messages(room.id)).map((message) => message.text);
  // The only honest way to make this save fail from a test: the room operation
  // is chained onto `saveTail`, so a save operation that rejects here is exactly
  // what a full disk or a vanished directory looks like to `#save`.
  const blocked = new Error("simulated save failure");
  service.saveTail = { then() { throw blocked; } };
  await assert.rejects(() => service.restoreFromSnapshot(snapshot, { confirm: true }), /simulated save failure/);
  assert.deepEqual((await service.messages(room.id)).map((message) => message.text), beforeMessages,
    "the failed restore was rolled back in memory");
  assert.equal(await readFile(statePath, "utf8"), before);
  await service.close();
});
