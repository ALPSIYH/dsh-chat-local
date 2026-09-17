import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** Drive one delivered member through a complete native turn, as DSH reports it. */
async function replyTo(service, call, text) {
  await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
  await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
  await service.observeSessionEvent(call.to, { type: "assistant/message", data: { turn: 1, step: 1,
    message: { content: [{ type: "text", text }] } } });
  await service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
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

test("the exact prompt handed to a member is recorded by hash and by content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-prompt-"));
  const prompts = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (_from, to, text) => { prompts.push({ to, text }); } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "提示词", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "议题" });
  const deadline = Date.now() + 2000;
  while (!prompts.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const recorded = (await service.eventsFor(room.id)).filter((event) => event.type === "turn.prompt");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].payload.memberSessionId, "s1");
  assert.equal(recorded[0].payload.prompt, prompts[0].text);
  assert.equal(recorded[0].payload.promptChars, prompts[0].text.length);
  assert.match(recorded[0].payload.promptHash, /^[0-9a-f]{64}$/);
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

test("a delivery event names the same delivery the prompt does, so the pair joins by script", async () => {
  const h = await harness({ autoDeliver: true });
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "配对" });
  const call = await waitFor(() => h.calls[0], "the member delivery");
  await replyTo(h.service, call, "回复");
  const events = await waitFor(async () => {
    const found = await h.service.eventsFor(h.room.id);
    return found.some((event) => event.type === "delivery.settled" && event.payload.status === "replied") ? found : undefined;
  }, "the settled delivery");
  const prompt = events.find((event) => event.type === "turn.prompt");
  const sent = events.find((event) => event.type === "delivery.sent");
  const settled = events.find((event) => event.type === "delivery.settled" && event.payload.status === "replied");
  assert.equal(prompt.payload.deliveryId, call.delivery.id);
  // Without an id on the delivery events, pairing the recorded prompt with the
  // delivery it produced needs tick order plus member: an inference, not a join.
  assert.equal(sent.payload.deliveryId, prompt.payload.deliveryId);
  assert.equal(settled.payload.deliveryId, prompt.payload.deliveryId);
});

test("a restart records an event for every in-flight delivery it recovers as failed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-restart-"));
  const path = join(directory, "rooms.json");
  const deliveries = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => { deliveries.push(1); } },
    get(name) { return this[name]; } };
  const first = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 60_000 });
  // Registered before any assertion: a failing assertion must not leave the
  // long reply timer holding the test file open.
  t.after(() => first.close());
  await first.ready;
  const room = await first.createRoom({ name: "重启", autoDeliver: true, members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  const sent = await first.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  await waitFor(() => deliveries.length === 1, "the in-flight delivery");
  // Dispatched but never observed, so the delivery is still in flight when the
  // process ends: shutdown does not settle it.
  await first.close();
  const inFlight = JSON.parse(await readFile(path, "utf8")).rooms[0].messages.flatMap((message) => message.deliveries);
  // Dispatched, never observed: whichever in-flight status it reached, shutdown
  // does not settle it.
  assert.equal(inFlight.length, 1);
  assert.ok(["queued", "sent", "delivered", "working"].includes(inFlight[0].status), inFlight[0].status);
  const second = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 60_000 });
  t.after(() => second.close());
  await second.ready;
  const recovered = (await second.messages(room.id)).flatMap((message) => message.deliveries);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "failed");
  assert.equal(recovered[0].recoveryReason, "restart");
  const settle = (await second.eventsFor(room.id))
    .find((event) => event.type === "delivery.settled" && event.payload.deliveryId === recovered[0].id);
  // The status a restart recovers as failed is this experiment's dependent
  // variable, so the log must not leave it indistinguishable from a delivery
  // that genuinely settled.
  assert.ok(settle, "the restart recovery must explain the status change in the log");
  assert.equal(settle.payload.status, "failed");
  assert.equal(settle.payload.previous, inFlight[0].status);
  assert.equal(settle.payload.recoveryReason, "restart");
  assert.deepEqual(settle.causes, [sent.id]);
});

test("the settle the save persisted is recorded before the message.created that same save made durable", async () => {
  const h = await harness({ autoDeliver: true });
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "开始" });
  const call = await waitFor(() => h.calls[0], "the member delivery");
  await replyTo(h.service, call, "自动回复");
  // One read of an append-only sequence: the index is the ordering evidence, so
  // there is no timing window to sample and no repetition to flake on.
  const events = await waitFor(async () => {
    const found = await h.service.eventsFor(h.room.id);
    return found.some((event) => event.type === "message.created" && event.payload.authorKind === "session") ? found : undefined;
  }, "the agent reply event");
  const settled = events.findIndex((event) => event.type === "delivery.settled" && event.payload.status === "replied");
  const created = events.findIndex((event) => event.type === "message.created" && event.payload.authorKind === "session");
  assert.ok(settled >= 0, "the reply must settle its delivery");
  assert.ok(created >= 0, "the reply must be audited");
  // The settle is a state change the following save persists, and the audit of
  // the reply may only be recorded by that save. Recording the reply first is
  // the R20 defect: a log entry describing state that had not reached disk.
  assert.ok(settled < created, `the settle (${settled}) must precede the created event (${created})`);
});

test("the message.created of a superseding send follows the settles that same save persisted", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-supersede-"));
  const deliveries = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => { deliveries.push(1); } },
    get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 60_000 });
  // Registered before any assertion: a failing assertion must not leave the
  // long reply timer holding the test file open.
  t.after(() => service.close());
  await service.ready;
  const room = await service.createRoom({ name: "取代", autoDeliver: true, members: [
    { kind: "session", sessionId: "s1", alias: "甲" },
    { kind: "session", sessionId: "s2", alias: "乙" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  // The turn loop is sequential, so exactly one capture is in flight: the first
  // delivery has been dispatched and nothing has settled it.
  await waitFor(() => deliveries.length === 1, "the in-flight delivery");
  const second = await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const events = await service.eventsFor(room.id);
  const settles = events.flatMap((event, index) => event.type === "delivery.settled" && event.payload.status === "superseded" ? [index] : []);
  const created = events.findIndex((event) => event.type === "message.created" && event.payload.messageId === second.id);
  assert.equal(settles.length, 1);
  assert.ok(created >= 0, "the superseding message must be audited");
  // #commitSend is the explicit save-then-record site: its message.created can
  // only appear after everything the same send recorded before that save, which
  // here is the supersede settle. Recording it earlier would describe state that
  // had not reached disk.
  assert.ok(created > Math.max(...settles), `created (${created}) must follow the settles (${settles})`);
});

test("a save that never lands leaves no message.created behind it", async () => {
  const h = await harness();
  // Replace the state file with a directory: every rename onto it fails, so the
  // save that would have made this message durable cannot succeed.
  await rm(join(h.directory, "rooms.json"));
  await mkdir(join(h.directory, "rooms.json"));
  await assert.rejects(() => h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "不会落地" }));
  // #commitSend saves before it records; an event here would describe state that
  // never reached disk.
  assert.deepEqual(await h.service.eventsFor(h.room.id), []);
});
