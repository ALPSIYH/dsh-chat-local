import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
