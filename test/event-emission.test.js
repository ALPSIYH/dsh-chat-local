import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";

async function waitFor(predicate, label = "condition") {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function harness(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-emit-"));
  const calls = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: {
      status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); }
    },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "事件测试", autoDeliver: options.autoDeliver ?? false,
    members: [{ kind: "session", sessionId: "s1", alias: "成员" }] });
  return { directory, service, room, calls };
}

test("sending a message appends an immutable message.created event with provenance", async () => {
  const h = await harness();
  const message = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第一条" });
  const events = await h.service.eventsFor(h.room.id);
  const created = events.filter((event) => event.type === "message.created");
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.messageId, message.id);
  assert.equal(created[0].payload.text, "第一条");
  assert.equal(created[0].provenance.originClass, "owner");
  assert.equal(created[0].provenance.roomId, h.room.id);
});

test("events are append-only: a replay of the same operation adds no second event", async () => {
  const h = await harness();
  const message = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human",
    text: "重试", clientOperationId: "op-1" });
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human",
    text: "重试", clientOperationId: "op-1" });
  const events = await h.service.eventsFor(h.room.id);
  assert.equal(events.filter((event) => event.type === "message.created").length, 1);
  assert.equal(events[0].payload.messageId, message.id);
});

test("a log write failure does not fail the send itself", async () => {
  const h = await harness();
  // A regular file where the per-room log directory belongs makes every append
  // fail, so the side channel cannot succeed by accident.
  await writeFile(join(h.directory, "events"), "not a directory", "utf8");
  let sent;
  await assert.doesNotReject(async () => {
    sent = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "仍然成功" });
  });
  assert.equal(h.service.logHealth().failed >= 1, true);
  const messages = await h.service.messages(h.room.id);
  assert.equal(messages.some((message) => message.id === sent.id && message.text === "仍然成功"), true);
});

test("an agent auto-reply appends its own message.created event", async () => {
  const h = await harness({ autoDeliver: true });
  const trigger = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "开始" });
  const call = await waitFor(() => h.calls[0], "the member delivery");
  await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
  await h.service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
  await h.service.observeSessionEvent(call.to, { type: "assistant/message", data: { turn: 1, step: 1,
    message: { content: [{ type: "text", text: "自动回复" }] } } });
  await h.service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
  const created = await waitFor(async () => {
    const found = (await h.service.eventsFor(h.room.id)).filter((event) => event.type === "message.created");
    return found.length >= 2 ? found : undefined;
  }, "the agent reply event");
  assert.equal(created.length, 2);
  const reply = created.find((event) => event.payload.authorKind === "session");
  assert.equal(reply.payload.text, "自动回复");
  assert.equal(reply.provenance.originClass, "agent");
  assert.equal(reply.provenance.messageId, reply.payload.messageId);
  assert.deepEqual(reply.causes, [trigger.id]);
});

test("message and delivery events carry their ids, actor id and owning message", async () => {
  const h = await harness({ autoDeliver: true });
  const sent = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "投递" });
  const delivery = await waitFor(async () =>
    (await h.service.eventsFor(h.room.id)).find((event) => event.type === "delivery.sent"), "the delivery.sent event");
  assert.deepEqual(delivery.causes, [sent.id]);
  assert.equal(delivery.provenance.messageId, sent.id);
  assert.equal(delivery.provenance.actorId, "s1");
  assert.equal(delivery.provenance.roomId, h.room.id);
  const created = (await h.service.eventsFor(h.room.id)).find((event) => event.type === "message.created");
  assert.equal(created.provenance.messageId, sent.id);
  assert.equal(created.provenance.actorId, "human:me");
});

test("a scheduled turn records its tick and the exact recipient order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const calls = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (from, to) => { calls.push(to); } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "顺序", autoDeliver: true, members: [
    { kind: "session", sessionId: "s1", alias: "甲" },
    { kind: "session", sessionId: "s2", alias: "乙" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "开始" });
  const deadline = Date.now() + 2000;
  while (calls.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const scheduled = (await service.eventsFor(room.id)).filter((event) => event.type === "turn.scheduled");
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0].payload.recipients, ["s1", "s2"]);
  assert.equal(scheduled[0].payload.order, "configured");
  assert.ok(scheduled[0].tick >= 1);
  // The configured order is what the room was *told*; the executed order is what
  // ran. The event must carry the latter, and it must match reality.
  assert.deepEqual(scheduled[0].payload.executed, ["s1", "s2"]);
  assert.deepEqual(calls, scheduled[0].payload.executed);
  await service.close();
});

test("a rotated turn records the executed sequence the configured order cannot show", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const deliveries = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (from, to) => { deliveries.push(to); } },
    get(name) { return this[name]; }
  };
  const path = join(directory, "rooms.json");
  const first = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await first.ready;
  const room = await first.createRoom({ name: "轮转", autoDeliver: true, members: [
    { kind: "session", sessionId: "s1", alias: "甲" },
    { kind: "session", sessionId: "s2", alias: "乙" }] });
  await first.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await waitFor(() => deliveries.length >= 2, "both deliveries of the first turn");
  // Quiesce before the second turn, so it is a fresh schedule rather than a
  // superseded run: the rotation offset is the only thing that differs.
  await first.close();
  const second = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await second.ready;
  await second.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  await waitFor(() => deliveries.length >= 4, "both deliveries of the second turn");
  const scheduled = (await second.eventsFor(room.id)).filter((event) => event.type === "turn.scheduled");
  assert.equal(scheduled.length, 2);
  // The configured order never changes, so it alone could not tell these apart.
  assert.deepEqual(scheduled.map((event) => event.payload.recipients), [["s1", "s2"], ["s1", "s2"]]);
  assert.deepEqual(scheduled.map((event) => event.payload.executed), [["s1", "s2"], ["s2", "s1"]]);
  assert.deepEqual(scheduled.map((event) => event.payload.rotationStart), [0, 1]);
  // "Step 3 was B, not C": the second turn's third participant is derivable from
  // the event alone, and it matches who actually ran.
  assert.equal(scheduled[1].payload.executed[0], "s2");
  assert.deepEqual(deliveries.slice(2), scheduled[1].payload.executed);
  await second.close();
});

test("a freshly created room starts at tick zero and persists it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(n) { return this[n]; } };
  const path = join(directory, "rooms.json");
  const service = new DshChatLocalService(ctx, { path });
  await service.ready;
  // No members and autoDeliver off, so this room never schedules a turn: `tick`
  // must exist on its own rather than be introduced by the scheduler.
  const room = await service.createRoom({ name: "零", autoDeliver: false });
  assert.equal(room.tick, 0);
  await service.close();
  assert.equal(JSON.parse(await readFile(path, "utf8")).rooms[0].tick, 0);
  const reopened = new DshChatLocalService(ctx, { path });
  await reopened.ready;
  assert.equal((await reopened.resolveRoom(room.id)).tick, 0);
  await reopened.close();
});

test("the tick is persisted and keeps increasing across a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const deliveries = [];
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => { deliveries.push(1); } },
    get(n) { return this[n]; } };
  const path = join(directory, "rooms.json");
  const first = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await first.ready;
  // autoDeliver must be true: the tick advances per *scheduled turn*, so a room
  // that never schedules one has no ticks to compare.
  const room = await first.createRoom({ name: "t", autoDeliver: true, members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await first.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const firstDeadline = Date.now() + 2000;
  while (!deliveries.length && Date.now() < firstDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const ticks = async (service) => (await service.eventsFor(room.id))
    .filter((event) => event.type === "turn.scheduled").map((event) => event.tick);
  assert.deepEqual(await ticks(first), [1]);
  await first.close();
  const second = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await second.ready;
  await second.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const secondDeadline = Date.now() + 2000;
  while (deliveries.length < 2 && Date.now() < secondDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await ticks(second), [1, 2]);
});

test("the tick reaches disk, so a restart resumes from it instead of replaying it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const deliveries = [];
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => { deliveries.push(1); } },
    get(n) { return this[n]; } };
  const path = join(directory, "rooms.json");
  const first = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await first.ready;
  const room = await first.createRoom({ name: "t", autoDeliver: true, members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await first.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await waitFor(() => deliveries.length === 1, "the first delivery");
  await first.close();
  // The tick must be durable on its own: nothing else needs to be written for it
  // to survive, otherwise a restart would silently replay the same number.
  assert.equal(JSON.parse(await readFile(path, "utf8")).rooms[0].tick, 1);
  const second = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await second.ready;
  assert.equal((await second.resolveRoom(room.id)).tick, 1);
  await second.close();
});
