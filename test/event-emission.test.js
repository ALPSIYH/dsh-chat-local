import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";
import { verifyChain } from "../lib/event-log.js";
import { deriveRelationships } from "../lib/relationship.js";

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
    const settled = found.find((event) => event.type === "delivery.settled" && event.payload.status === "replied");
    const sent = found.find((event) => event.type === "delivery.sent");
    const prompt = found.find((event) => event.type === "turn.prompt");
    // Poll for every event this test joins, not only the first to appear: a
    // snapshot that has the settle but not the send would otherwise be compared
    // against an event that was never in it.
    return settled && sent && prompt ? found : undefined;
  }, "the prompt, the sent delivery and its settle");
  const prompt = events.find((event) => event.type === "turn.prompt");
  const sent = events.find((event) => event.type === "delivery.sent");
  const settled = events.find((event) => event.type === "delivery.settled" && event.payload.status === "replied");
  assert.equal(prompt.payload.deliveryId, call.delivery.id);
  // Without an id on the delivery events, pairing the recorded prompt with the
  // delivery it produced needs tick order plus member: an inference, not a join.
  assert.equal(sent.payload.deliveryId, prompt.payload.deliveryId);
  assert.equal(settled.payload.deliveryId, prompt.payload.deliveryId);
});

test("eventsFor never returns a snapshot missing an append that was already recorded", async () => {
  const h = await harness();
  // The delivery path records without awaiting the append, so it queues appends
  // that a reader has no promise for. Twenty of them, issued and forgotten, then
  // one read: a read that did not join the chain would return a prefix of them.
  for (let index = 0; index < 20; index += 1) {
    void h.service.eventLog.append(h.room.id, { type: "probe", actor: { kind: "system", id: "system" }, payload: { index } });
  }
  const events = await h.service.eventsFor(h.room.id);
  assert.equal(events.filter((event) => event.type === "probe").length, 20);
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
  // Poll for the recovery event rather than reading once: if it is genuinely
  // absent the failure names the missing event instead of a partial snapshot.
  const events = await waitFor(async () => {
    const found = await second.eventsFor(room.id);
    return found.some((event) => event.type === "delivery.settled" && event.payload.deliveryId === recovered[0].id) ? found : undefined;
  }, "the restart recovery event that explains the status change");
  const settle = events.find((event) => event.type === "delivery.settled" && event.payload.deliveryId === recovered[0].id);
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
  // Both entries are queued before that one save and flushed by it in queue
  // order, so the reply follows the settle with nothing between them: the same
  // save that persisted the replied status is the one that made the reply
  // durable, and the log says so in that order.
  assert.equal(created, settled + 1, "one save must flush the settle and then the reply it explains");
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
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

test("a delivery status change whose save never lands leaves no delivery event behind it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-phantom-"));
  const path = join(directory, "rooms.json");
  const calls = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); } },
    get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 60_000 });
  // Registered before any assertion: a failing assertion must not leave the
  // long reply timer holding the test file open.
  t.after(() => service.close());
  await service.ready;
  const room = await service.createRoom({ name: "幻影", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "开始" });
  const call = await waitFor(() => calls[0], "the member delivery");
  await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
  await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
  // `delivered` is this delivery's last status on disk, and the whole durable
  // record the failed save below will be missing.
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.equal(onDisk.rooms[0].messages.flatMap((message) => message.deliveries)[0].status, "delivered");
  // Replace the state file with a directory: every rename onto it fails, so the
  // save that would persist the next status cannot land.
  await rm(path);
  await mkdir(path);
  await assert.rejects(() => service.observeSessionEvent(call.to, { type: "assistant/message",
    data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "幻影回复" }] } } }));
  // The status did change in memory...
  const inMemory = (await service.messages(room.id)).flatMap((message) => message.deliveries);
  assert.equal(inMemory.length, 1);
  assert.equal(inMemory[0].status, "working");
  // ...but no save made it durable, so the log must not explain it (R21). The
  // events that did reach disk stop at the delivered status this room holds.
  const events = await service.eventsFor(room.id);
  assert.deepEqual(events.filter((event) => event.type.startsWith("delivery.")).map((event) => event.payload.status),
    ["sent", "delivered"]);
  // Drop the directory so the next save can land: the event then appears with
  // the status, and the chain still verifies.
  await rm(path, { recursive: true });
  await service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
  const recorded = await service.eventsFor(room.id);
  const settle = recorded.find((event) => event.type === "delivery.settled" && event.payload.status === "replied");
  assert.ok(settle, "the save that persisted the replied status must record it");
  assert.equal(settle.payload.previous, "working");
  assert.deepEqual(verifyChain(recorded), { ok: true, brokenAt: null });
});

/**
 * A room whose members can each hold a live turn, so `operateWork` and the
 * charter tools can be driven as a participant the way the tools drive them.
 * Only the bridge is a stub: the ledger, the save path and the event log are
 * the real ones, because the log is the subject.
 */
async function ledgerHarness() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-ledger-"));
  const calls = [];
  const ctx = {
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"),
    maxRounds: 1, maxReplies: 1, replyTimeoutMs: 5_000, monitorIntervalMs: 3_600_000 });
  await service.ready;
  const room = await service.createRoom({ name: "台账事件", autoDeliver: true, members: [
    { kind: "session", sessionId: "s1", alias: "记录" },
    { kind: "session", sessionId: "s2", alias: "执行" },
    { kind: "session", sessionId: "s3", alias: "复核" }] });
  let operations = 0;
  return {
    directory, service, room, calls,
    /** Open a live turn for one member and return the message it can cite. */
    async activate(sessionId, text = "请核对台账并登记结论。") {
      await service.stopRoom(room.id);
      const index = calls.length;
      const source = await service.send({ roomId: room.id, author: "human:me", authorKind: "human",
        text, mentions: [sessionId] });
      const call = await waitFor(() => calls[index], "a participant delivery");
      const turn = index + 1;
      await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn } });
      await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
        text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
      return source;
    },
    command(source, input = {}) {
      return { operationId: `ledger-event-${++operations}`, sourceMessageIds: [source.id],
        summary: "根据本轮讨论登记可核对的状态变化", ...input };
    },
    async cleanup() { await service.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

const TASK_FIELDS = { kind: "task", title: "核对统计口径", details: "对照原始报告逐项核对",
  acceptanceCriteria: "列出原始出处、口径和页码", ownerSessionId: "s2", reviewerSessionId: "s3" };

test("each work action appends exactly one ledger.transition typed to the state it wrote", async () => {
  const h = await ledgerHarness();
  try {
    const source = await h.activate("s2");
    let entry = await h.service.operateWork(h.room.id, "s2", h.command(source, { action: "record", fields: TASK_FIELDS }));
    const entryId = entry.id;
    const act = (input) => h.service.operateWork(h.room.id, "s2",
      h.command(source, { entryId, expectedRevision: entry.revision, ...input }));
    entry = await act({ action: "comment" });
    entry = await act({ action: "amend", fields: { details: "对照原始报告与附录逐项核对" } });
    entry = await act({ action: "acknowledge" });
    entry = await act({ action: "progress", state: "blocked",
      blocker: { kind: "file", summary: "正文无法读取", nextStep: "提供同版正文", filePaths: ["/example/manuscript.docx"] } });
    entry = await act({ action: "progress", state: "in_progress" });
    const submission = h.command(source, { action: "submit", entryId, expectedRevision: entry.revision, deliverable: "核对表 v2" });
    entry = await h.service.operateWork(h.room.id, "s2", submission);
    // A replayed operation must be as idempotent in the log as it is in state.
    await h.service.operateWork(h.room.id, "s2", submission);
    const reviewer = await h.activate("s3");
    entry = await h.service.operateWork(h.room.id, "s3", h.command(reviewer, { action: "review", entryId,
      expectedRevision: entry.revision, verdict: "approve" }));

    const events = (await h.service.eventsFor(h.room.id)).filter((event) => event.type === "ledger.transition");
    assert.deepEqual(events.map((event) => event.payload.action),
      ["record", "comment", "amend", "acknowledge", "progress", "progress", "submit", "review"]);
    // The payload is the entry this save wrote, not the command the caller sent.
    assert.deepEqual(events.map((event) => event.payload.entryId), new Array(8).fill(entryId));
    assert.deepEqual(events.map((event) => event.payload.revision), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(events.map((event) => event.payload.status),
      ["open", "open", "open", "in_progress", "blocked", "in_progress", "in_review", "done"]);
    assert.deepEqual(events.map((event) => event.payload.kind), new Array(8).fill("task"));
    assert.deepEqual(events.map((event) => event.payload.state),
      [null, null, null, null, "blocked", "in_progress", null, null]);
    assert.deepEqual(events.map((event) => event.payload.verdict), [null, null, null, null, null, null, null, "approve"]);
    assert.deepEqual(events.map((event) => event.payload.ownerSessionId), new Array(8).fill("s2"));
    assert.deepEqual(events.map((event) => event.payload.reviewerSessionId), new Array(8).fill("s3"));
    assert.deepEqual(events.map((event) => event.payload.dispositionAction), new Array(8).fill(null));
    // The full field list, spelled out: a renamed key is a research counter that
    // reads a silent zero, so the shape is pinned rather than merely sampled.
    // The log serialises in canonical (sorted) key order, so the comparison is
    // sorted rather than an assertion about the writer's insertion order.
    assert.deepEqual(Object.keys(events[0].payload).sort(), ["action", "dispositionAction", "entryId",
      "kind", "ownerSessionId", "proposerSessionId", "replacesProposalId", "reviewerSessionId",
      "revision", "state", "status", "verdict"]);
  } finally { await h.cleanup(); }
});

test("a save that never lands leaves no ledger.transition behind it", async () => {
  const h = await ledgerHarness();
  try {
    const transitions = async () => (await h.service.eventsFor(h.room.id))
      .filter((event) => event.type === "ledger.transition");
    // Replace the state file with a directory: every rename onto it fails, so
    // the save that would have made this entry durable cannot succeed.
    await rm(join(h.directory, "rooms.json"));
    await mkdir(join(h.directory, "rooms.json"));
    await assert.rejects(() => h.service.createLedgerEntry(h.room.id, { kind: "task", title: "不会落地",
      ownerSessionId: "s2", reviewerSessionId: "s3" }));
    // The transition is queued behind the save, so a save that never landed
    // records nothing: recording it first (or on failure) would describe a
    // revision that never reached disk (R20).
    assert.deepEqual(await transitions(), []);
    // Let a save land. The state it writes contains both entries, so both
    // transitions appear — the queued one was held back, not dropped, which is
    // what makes the empty log above a claim about the write rather than about
    // an emitter that never ran.
    await rm(join(h.directory, "rooms.json"), { recursive: true });
    const second = await h.service.createLedgerEntry(h.room.id, { kind: "task", title: "会落地",
      ownerSessionId: "s2", reviewerSessionId: "s3" });
    const recorded = await transitions();
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1].payload.entryId, second.id);
    const ledger = await h.service.listLedger(h.room.id, { includeArchived: true });
    assert.deepEqual(ledger.map((entry) => entry.id).sort(), recorded.map((event) => event.payload.entryId).sort());
  } finally { await h.cleanup(); }
});

test("a charter proposal records its proposer, and a replacement names the proposal it replaced (R44)", async () => {
  const h = await ledgerHarness();
  try {
    const firstSource = await h.activate("s2");
    const memory = await h.service.roomMemory(h.room.id);
    const original = await h.service.proposeCharter(h.room.id, "s2", { baseRevision: memory.profile.revision,
      charter: "规则甲", reason: "初稿", sourceMessageIds: [firstSource.id] });
    const secondSource = await h.activate("s3");
    const replacement = await h.service.proposeCharter(h.room.id, "s3", { baseRevision: memory.profile.revision,
      charter: "规则乙", reason: "取代初稿", sourceMessageIds: [secondSource.id], replacesProposalId: original.id });

    const events = (await h.service.eventsFor(h.room.id)).filter((event) => event.type === "ledger.transition");
    assert.equal(events.length, 2);
    // The superseded counter attributes a replacement to the *replaced*
    // proposal's proposer, so the replaced proposal's own record has to name
    // that proposer and be keyed by the id the replacement cites.
    assert.equal(events[0].payload.entryId, original.id);
    assert.equal(events[0].payload.kind, "charter");
    assert.equal(events[0].payload.action, "propose");
    assert.equal(events[0].payload.proposerSessionId, "s2");
    assert.equal(events[0].payload.replacesProposalId, null);
    assert.equal(events[1].payload.entryId, replacement.id);
    assert.equal(events[1].payload.proposerSessionId, "s3");
    assert.equal(events[1].payload.replacesProposalId, original.id);
  } finally { await h.cleanup(); }
});

test("a superseded charter proposal is counted from a real room log, not a silent zero (R44)", async () => {
  const h = await ledgerHarness();
  try {
    const firstSource = await h.activate("s2");
    const memory = await h.service.roomMemory(h.room.id);
    const original = await h.service.proposeCharter(h.room.id, "s2", { baseRevision: memory.profile.revision,
      charter: "规则甲", reason: "初稿", sourceMessageIds: [firstSource.id] });
    const secondSource = await h.activate("s3");
    await h.service.proposeCharter(h.room.id, "s3", { baseRevision: memory.profile.revision,
      charter: "规则乙", reason: "取代初稿", sourceMessageIds: [secondSource.id], replacesProposalId: original.id });

    // The end-to-end claim behind R44: the derivation reads these two field
    // names off the emitted events, so a spelling mismatch shows up here as the
    // silent zero the ruling exists to prevent.
    const result = deriveRelationships({ events: await h.service.eventsFor(h.room.id), roomId: h.room.id });
    const counters = (sessionId) => result.pairs.find((pair) => pair.observer === sessionId
      && pair.target === sessionId)?.counters;
    assert.equal(counters("s2").charterProposalsSuperseded, 1);
    assert.equal(counters("s3").charterProposalsSuperseded, 0);
  } finally { await h.cleanup(); }
});
