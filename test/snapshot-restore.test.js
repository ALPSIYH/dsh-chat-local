import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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
