import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DshChatLocalService } from "../lib/room-store.js";
import { apply } from "../lib/index.js";

/**
 * The gate's wiring into the tool guard: what the guard does with a judgement,
 * and what it records. The judgement itself is pinned in `gate.test.js`; here the
 * question is whether the room's own state reaches it, whether a refusal is
 * visible in the log afterwards, and whether anything is recorded when the gate
 * allows.
 */

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * One service over a temporary state directory, with a bridge that can be made
 * to fail: a delivery that never arrives is what leaves the member with failed
 * deliveries and no successful one, which is the record the gate reads.
 */
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-action-gate-"));
  const calls = [];
  let failing = false;
  const ctx = {
    agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => {
        if (failing) throw new Error("dsh-bridge refused the delivery");
        calls.push({ from, to, text, delivery });
      } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), replyTimeoutMs: 5_000 });
  await service.ready;
  const room = await service.createRoom({ name: "行动治理门", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  const state = () => service.state.rooms.find((item) => item.id === room.id);
  return {
    service, room, calls, ctx, path: join(directory, "rooms.json"),
    saved: async () => JSON.parse(await readFile(join(directory, "rooms.json"), "utf8")),
    /** Reopen the same state file with a fresh service, as a restart would. */
    reopen: async () => {
      const next = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), replyTimeoutMs: 5_000 });
      await next.ready;
      return next;
    },
    setFailing: (value) => { failing = value; },
    /** The room's live policy. The gate flag is read from here on every execution. */
    enableGate: () => { state().policy.gate = true; },
    setSample: (pairs) => { service.relationshipSamples.set(room.id, { asOfTick: state().tick, version: 1,
      derivedFromCount: 0, pairs }); },
    events: () => service.eventsFor(room.id),
    idle: async () => (await service.resolveRoom(room.id)).orchestration?.state === "idle",
    /** Open a member's turn the way DSH reports it, and leave it open. */
    openTurn: async (call) => {
      await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
      await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
        text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from room:${room.id}]` }] } });
    },
    close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

/** An execution as DSH reports it to the guard. */
const exec = (name, args = {}) => ({ name, arguments: args, agent: { session: { id: "s1" } } });

test("a refusal carries the judgement that caused it and is recorded with the counters behind it", async () => {
  const h = await harness();
  try {
    // An execution-mode policy is where the gate lives: a restricted turn is
    // already decided by the read-only rules above it, and the gate never
    // loosens those.
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    // Turn one cannot reach 甲 at all.
    h.setFailing(true);
    await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第一轮" });
    await waitFor(async () => (await h.events()).some((event) => event.type === "delivery.settled"
      && event.payload.status === "failed"), "the failed delivery");
    await waitFor(() => h.idle(), "the first turn to end");
    h.setFailing(false);
    // Turn two reaches them, so the record the gate reads is the one turn one left.
    await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第二轮" });
    const call = await waitFor(() => h.calls.at(-1), "the second delivery");
    await h.openTurn(call);
    h.enableGate();
    const before = await h.events();
    const snapshot = before.filter((event) => event.type === "relationship.snapshot").at(-1);
    const self = snapshot.payload.pairs.find((pair) => pair.observer === "s1" && pair.target === "s1");
    assert.equal(self.counters.deliveryFailures, 1, "the fixture must leave a failed delivery behind");
    assert.equal(self.counters.deliverySuccesses, 0, "and no successful one");

    const denial = h.service.guardToolExecution(exec("bash", { command: "rm -rf build" }));
    assert.equal(typeof denial, "string", "the guard refuses by returning a reason");
    assert.match(denial, /治理门/);
    assert.match(denial, /用户/);
    // The guard cannot ask the user anything, so the refusal must say so and
    // must not leave the member waiting for an approval that will never come.
    assert.match(denial, /无法弹出审批/);
    assert.doesNotMatch(denial, /等待.*(?:批准|审批)|已提交.*审批/);
    // A low-impact read is not what the confirmation rule is for.
    assert.equal(h.service.guardToolExecution(exec("read", { path: "/tmp/notes.txt" })), undefined);

    const recorded = (await h.events()).find((event) => event.type === "action_gate");
    assert.ok(recorded, "a refusal is recorded, not merely intended");
    assert.equal(recorded.payload.judgement, "require_confirmation");
    assert.equal(recorded.payload.tool, "bash");
    assert.equal(recorded.payload.riskClass, "high");
    assert.equal(recorded.payload.action, "execute");
    // `basis` is the counter snapshot the judgement was taken on: the same pair
    // and the same numbers the turn's own relationship snapshot states.
    assert.deepEqual(recorded.payload.basis, { observer: "s1", target: "s1",
      asOfTick: snapshot.payload.asOfTick, version: snapshot.payload.version,
      derivedFromCount: snapshot.payload.derivedFromCount, counters: { ...self.counters } });
    assert.equal(recorded.provenance.roomId, h.room.id);
    assert.equal(recorded.provenance.actorId, "s1");
  } finally {
    await h.close();
  }
});

test("an allowed execution records nothing", async () => {
  const h = await harness();
  try {
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    h.enableGate();
    h.setSample([{ observer: "s1", target: "s1", tick: 1,
      counters: { deliveryFailures: 2, deliverySuccesses: 0, unresolvedDisagreements: 0 } }]);
    h.service.policyLocks.set("s1", { active: true, roomId: h.room.id, actionMode: "inherit_dsh",
      expiresAt: Date.now() + 10_000 });
    const before = JSON.stringify((await h.events()).map((event) => event.type));
    assert.equal(h.service.guardToolExecution(exec("read", { path: "/tmp/notes.txt" })), undefined);
    assert.equal(h.service.guardToolExecution(exec("chat_memory", { room: h.room.id })), undefined);
    assert.equal(JSON.stringify((await h.events()).map((event) => event.type)), before,
      "the gate observes only what it refuses");
  } finally {
    await h.close();
  }
});

test("with the gate off, the same low-trust record lets the same execution through and records nothing", async () => {
  const h = await harness();
  try {
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    // Exactly the record that is refused above, with the gate left alone.
    h.setSample([{ observer: "s1", target: "s1", tick: 1,
      counters: { deliveryFailures: 2, deliverySuccesses: 0, unresolvedDisagreements: 1 } }]);
    h.service.policyLocks.set("s1", { active: true, roomId: h.room.id, actionMode: "inherit_dsh",
      expiresAt: Date.now() + 10_000 });
    const before = (await h.events()).length;
    assert.equal(h.service.guardToolExecution(exec("bash", { command: "rm -rf build" })), undefined);
    assert.equal(h.service.guardToolExecution(exec("read", {})), undefined);
    assert.equal((await h.events()).length, before);
  } finally {
    await h.close();
  }
});

test("a stale or ambiguous lock still returns before the gate is consulted", async () => {
  const h = await harness();
  try {
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    h.enableGate();
    h.setSample([{ observer: "s1", target: "s1", tick: 1,
      counters: { deliveryFailures: 2, deliverySuccesses: 0, unresolvedDisagreements: 1 } }]);
    // The shape DSH leaves behind when it coalesces two deliveries into one turn.
    h.service.policyLocks.set("s1", { active: true, roomId: h.room.id, actionMode: "discuss_only",
      stale: true, ambiguous: true, expiresAt: Date.now() + 10_000 });
    const before = (await h.events()).length;
    const denial = h.service.guardToolExecution(exec("bash", {}));
    assert.match(denial, /失效|超时/, "the stale lock's own refusal decides first");
    assert.doesNotMatch(denial, /治理门/);
    assert.equal((await h.events()).length, before, "a lock the gate never reached records nothing");
  } finally {
    await h.close();
  }
});

test("a gate survives a later change to an unrelated policy field, across a restart", async () => {
  const h = await harness();
  try {
    // An execution mode first: that is the only place the gate has any effect.
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    const on = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh",
      expectedRevision: 2, confirmRisk: true, gate: true });
    assert.equal(on.policy.gate, true);
    assert.equal((await h.saved()).rooms[0].policy.gate, true, "the flag reaches the state file");
    // Rebuilding the policy must carry the extra field: a mode change is not a
    // reason to forget what else the user chose.
    const moved = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "read_only_audit",
      expectedRevision: on.policy.revision });
    assert.equal(moved.policy.defaultActionMode, "read_only_audit");
    assert.equal(moved.policy.gate, true);
    assert.equal((await h.saved()).rooms[0].policy.gate, true);
    const reopened = await h.reopen();
    try {
      assert.equal((await reopened.resolveRoom(h.room.id)).policy.gate, true, "and it survives a reload");
    } finally { await reopened.close(); }
  } finally {
    await h.close();
  }
});

test("a call that changes only the gate takes effect, and a call that changes nothing does not", async () => {
  const h = await harness();
  try {
    const before = await h.service.resolveRoom(h.room.id);
    const on = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: before.policy.defaultActionMode,
      expectedRevision: before.policy.revision, gate: true });
    assert.equal(on.policy.gate, true, "the mode is unchanged, so only the gate can have changed");
    assert.equal(on.policy.revision, before.policy.revision + 1, "a real change bumps the policy revision");
    const again = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: on.policy.defaultActionMode,
      expectedRevision: on.policy.revision, gate: true });
    assert.equal(again.policy.revision, on.policy.revision, "asking for what already holds changes nothing");
    const off = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: again.policy.defaultActionMode,
      expectedRevision: again.policy.revision, gate: false });
    assert.equal(off.policy.gate, undefined);
    assert.equal(off.policy.revision, again.policy.revision + 1);
  } finally {
    await h.close();
  }
});

test("a room that has never enabled the gate stores exactly the policy shape it stored before", async () => {
  const h = await harness();
  try {
    assert.deepEqual(Object.keys((await h.saved()).rooms[0].policy),
      ["revision", "defaultActionMode", "updatedAt"]);
    const before = await h.service.resolveRoom(h.room.id);
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: before.policy.defaultActionMode,
      expectedRevision: before.policy.revision, gate: true });
    assert.deepEqual(Object.keys((await h.saved()).rooms[0].policy),
      ["revision", "defaultActionMode", "gate", "updatedAt"]);
    const on = await h.service.resolveRoom(h.room.id);
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: on.policy.defaultActionMode,
      expectedRevision: on.policy.revision, gate: false });
    assert.deepEqual(Object.keys((await h.saved()).rooms[0].policy),
      ["revision", "defaultActionMode", "updatedAt"], "turning it off leaves no trace of the field");
  } finally {
    await h.close();
  }
});

test("the policy endpoint carries the gate switch and tells the room about it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-gate-route-"));
  let handler;
  const disposers = [];
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    on() {},
    tools: { register() {}, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    sessionTitle: { get() {} },
    sessions: { get() { return { header: { cwd: directory } }; } },
    agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  apply(ctx, { path: join(directory, "rooms.json") });
  const request = async (path, body, method) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/api/dsh-chat-local${path}`;
    req.method = method ?? (body === undefined ? "GET" : "POST");
    let status, text;
    await handler(req, { writeHead(code) { status = code; }, end(value) { text = value; } });
    assert.equal(status, 200, text);
    return JSON.parse(text).value;
  };
  try {
    const room = await request("/rooms", { name: "治理门路由", autoDeliver: false });
    const updated = await request(`/rooms/${room.id}/policy`, { defaultActionMode: room.policy.defaultActionMode,
      expectedRevision: room.policy.revision, gate: true });
    assert.equal(updated.policy.gate, true);
    // The room is told, in its own timeline, so a member that later meets a
    // refusal can see that the room's governance was turned on.
    const messages = await request(`/rooms/${room.id}/messages`);
    assert.ok(messages.some((message) => message.author === "system:policy" && message.text.includes("治理门")),
      "the change is announced in the room");
  } finally {
    for (const dispose of disposers.reverse()) await dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
