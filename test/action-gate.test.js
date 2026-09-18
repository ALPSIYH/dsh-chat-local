import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
async function harness(roomName = "行动治理门") {
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
  const room = await service.createRoom({ name: roomName, autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  const state = () => service.state.rooms.find((item) => item.id === room.id);
  async function openTurn(call) {
    await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
    await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
      text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from room:${room.id}]` }] } });
  }
  return {
    service, room, calls, ctx, directory, path: join(directory, "rooms.json"),
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
    /**
     * Wait until the log holds every event this service already owes. A turn's
     * deliveries are recorded asynchronously, so a read straight after
     * `openTurn` can legitimately see a log that has not yet caught up with the
     * writes the turn already started; the exact comparisons below are only
     * meaningful once those writes have settled.
     */
    settle: () => service.settledAudit(),
    idle: async () => (await service.resolveRoom(room.id)).orchestration?.state === "idle",
    /** Open a member's turn the way DSH reports it, and leave it open. */
    openTurn,
    close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

/** An execution as DSH reports it to the guard. */
const exec = (name, args = {}) => ({ name, arguments: args, agent: { session: { id: "s1" } } });

/**
 * What the guard and the room did before the gate existed, captured by running
 * this exact scenario — same state layout, same messages, same tool calls —
 * against the implementation without the gate. A room identifier and a message
 * identifier are fresh UUIDs on every run, so the recorded prompt is compared
 * after replacing every UUID with `{id}`.
 */
const PRE_GATE_OUTCOMES = [
  ["bash", "allow"],
  ["write_file", "allow"],
  ["read", "allow"],
  ["web_search", "allow"],
  ["chat_work review", "allow"],
  ["unnamed", "allow"],
  ["restricted bash", "群聊回合处于 discuss_only；Host 已拒绝非只读工具 bash。读取 DOCX/文本请改用 chat_read_document（无需 bash 或另行放权）；chat_memory.sharedFiles 列出用户明确共享的文件。不要将工具不匹配重复登记为权限审批。若确需写文件或执行命令，请用户打开负责人原生 DSH 会话处理具体权限；台账采纳不会授予执行权限。"],
  ["restricted read of the state file", "群聊回合处于受限模式：Host 已拒绝读取群聊自身的状态文件（其中包含所有房间）。读取本房间用 chat_memory；读取用户共享的材料用 chat_read_document。"],
  ["restricted loopback fetch", "群聊回合处于受限模式：Host 已拒绝访问本机或内网地址。受限回合不能借此读取本机服务或其他房间的状态；需要外部资料请直接用 web_search，需要本机操作请用户打开负责人原生 DSH 会话。"],
  ["restricted chat_relationships", "allow"],
];
const PRE_GATE_EVENT_TYPES = ["member.added", "message.created", "message.created", "turn.scheduled", "relationship.snapshot", "turn.prompt", "delivery.settled", "message.created", "turn.scheduled", "relationship.snapshot", "turn.prompt", "delivery.sent", "delivery.settled"];
const PRE_GATE_PROMPTS = [
  { chars: 2734, sha256: "d65a9d95a7eba27eca99c99b04150b98d7ece00ed8002bed81293ff21804ee6b" },
  { chars: 2790, sha256: "e20db3c20c9da0065fe984ea264a43de409f438f452f5a5ad42fa877256e4f1b" },
];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * One execution-mode turn in a room whose only member could not be reached on
 * the previous turn: the record the gate reads, with the room otherwise fresh.
 *
 * Returns with the second delivery's turn open. That is not yet a stable read
 * point for the log — the turn's own writes are still in flight — so a caller
 * that intends to compare event sequences waits with `h.settle()` first.
 */
async function gatedTurn() {
  const h = await harness("关闭对照");
  await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
  h.setFailing(true);
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第一轮" });
  await waitFor(async () => (await h.events()).some((event) => event.type === "delivery.settled"
    && event.payload.status === "failed"), "the failed delivery");
  await waitFor(() => h.idle(), "the first turn to end");
  h.setFailing(false);
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第二轮" });
  const call = await waitFor(() => h.calls.at(-1), "the second delivery");
  // The delivery loop records `delivery.sent` for the queued delivery it just
  // handed to the bridge, and only then does the member's turn arrive. Waiting
  // for that record keeps the two recorded in the order they happened: opening
  // the turn first lets the delivery reach `delivered` while the `sent`
  // transition is still waiting for its save, and a transition the room has
  // already left behind is not what its log states.
  await waitFor(async () => (await h.events()).some((event) => event.type === "delivery.sent"
    && event.payload.deliveryId === call.delivery.id), "the delivery to be recorded as sent");
  await h.openTurn(call);
  return { h, lock: h.service.policyLocks.get("s1") };
}

/**
 * Every decision the guard can reach for this turn: the four execution-mode
 * calls the gate may act on, and the restricted-turn calls it must never touch.
 */
function guardCases(roomId, directory) {
  return [
    ["bash", "inherit_dsh", exec("bash", { command: "echo x" })],
    ["write_file", "inherit_dsh", exec("write_file", { path: "/tmp/x", content: "y" })],
    ["read", "inherit_dsh", exec("read", { path: "/tmp/x" })],
    ["web_search", "inherit_dsh", exec("web_search", { query: "x" })],
    ["chat_work review", "inherit_dsh", exec("chat_work", { room: roomId, operationId: "op", action: "review",
      entryId: "e1", expectedRevision: 1, summary: "s", sourceMessageIds: ["m"] })],
    ["unnamed", "inherit_dsh", exec("", {})],
    ["restricted bash", "discuss_only", exec("bash", { command: "echo x" })],
    ["restricted read of the state file", "discuss_only", exec("read", { path: join(directory, "rooms.json") })],
    ["restricted loopback fetch", "discuss_only", exec("web_fetch", { url: "http://127.0.0.1:3080/" })],
    ["restricted chat_relationships", "discuss_only", exec("chat_relationships", { room: roomId })]
  ];
}

/** Run the case set against the room's live gate state. */
function runCases(h, lock) {
  const previous = lock.actionMode;
  return guardCases(h.room.id, h.directory).map(([label, mode, execution]) => {
    lock.actionMode = mode;
    const value = h.service.guardToolExecution(execution);
    lock.actionMode = previous;
    return [label, value === undefined ? "allow" : value];
  });
}

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

/**
 * The policy notice is a fact in the room's timeline, so it has to state the
 * change that happened and nothing else. The call can move the mode, the gate,
 * both, or neither — re-applying a native preset to a room already in that mode
 * changes no permission — and a reader of the timeline must be able to trust
 * each of those four statements.
 */
test("the policy notice states what changed, and a re-applied preset claims no change at all", async () => {
  const h = await harness("公告");
  // A bridge whose native presets can actually be applied, so the preset path
  // runs rather than failing on a missing permission service.
  const presets = new Map([["s1", "workspace-write"]]);
  const agent = { session: { id: "s1" }, status: "idle" };
  h.ctx.agents = { get: (id) => (id === "s1" ? agent : undefined) };
  h.ctx.permissionPresets = {
    names: ["workspace-write", "danger-full-access"],
    resolve: (name) => ({ sandbox: name, approval: name === "danger-full-access" ? "never" : "ask" }),
    current: (session) => presets.get(session.id),
    set(session, name) { presets.set(session.id, name); }
  };
  /** The notice the last policy call left in the room's own timeline. */
  const notice = () => h.service.state.rooms.find((room) => room.id === h.room.id).messages
    .filter((message) => message.author === "system:policy").at(-1).text;
  try {
    const first = await h.service.resolveRoom(h.room.id);
    // 1. The gate alone: the mode is untouched, so the notice is about the gate.
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: first.policy.defaultActionMode,
      expectedRevision: first.policy.revision, gate: true });
    const gateOnly = await notice();
    assert.match(gateOnly, /开启.*行动治理门/);
    assert.doesNotMatch(gateOnly, /切换为/, "a mode that did not move is not announced");

    // 2. The mode alone: the gate stays on and the notice is about the mode.
    const on = await h.service.resolveRoom(h.room.id);
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh",
      expectedRevision: on.policy.revision, confirmRisk: true });
    const modeOnly = await notice();
    assert.match(modeOnly, /将房间权限切换为 inherit_dsh/);
    assert.doesNotMatch(modeOnly, /行动治理门/, "a gate that did not move is not announced");
    assert.equal((await h.service.resolveRoom(h.room.id)).policy.gate, true);

    // 3. Both at once: both changes are stated, and neither is dropped.
    const moved = await h.service.resolveRoom(h.room.id);
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "workspace_write",
      expectedRevision: moved.policy.revision, confirmRisk: true, gate: false });
    const both = await notice();
    assert.match(both, /将房间权限切换为 workspace_write/);
    assert.match(both, /关闭.*行动治理门/);
    assert.equal((await h.service.resolveRoom(h.room.id)).policy.gate, undefined);

    // 4. The same native preset re-applied: nothing changed, so the notice must
    //    not claim that the gate — or the mode — changed.
    const reappliedBefore = await h.service.resolveRoom(h.room.id);
    const reapplied = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "workspace_write",
      expectedRevision: reappliedBefore.policy.revision, confirmRisk: true });
    assert.equal(reapplied.policy.defaultActionMode, "workspace_write");
    assert.equal(reapplied.policy.gate, undefined);
    const presetOnly = await notice();
    assert.doesNotMatch(presetOnly, /行动治理门/, "a gate that did not move must not be announced as moving");
    assert.doesNotMatch(presetOnly, /开启|关闭了本房间的行动治理门/, "and must not be announced as being switched");
    assert.match(presetOnly, /重新应用/, "the notice says the preset was re-applied");
    assert.equal(reapplied.policy.revision, reappliedBefore.policy.revision + 1);
  } finally {
    await h.close();
  }
});

/**
 * The one call that takes no risk confirmation is a call that moves only the
 * room's gate inside a mode the user has already confirmed. The gate is not a
 * permission, so that call names no execution change at all. Every other call
 * that names an execution mode is decided exactly as it was before the gate
 * existed, including a mode merely re-sent and a native preset merely
 * re-applied.
 */
test("only a gate-only change inside an already-confirmed mode takes no risk confirmation", async () => {
  const h = await harness("门单独");
  try {
    // The mode the user has explicitly confirmed. Naming an execution mode took
    // the confirmation here, exactly as it always did.
    await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh", expectedRevision: 1, confirmRisk: true });
    const confirmed = await h.service.resolveRoom(h.room.id);
    // The exception: the call moves the gate alone, so it needs no confirmation.
    const toggled = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh",
      expectedRevision: confirmed.policy.revision, gate: true });
    assert.equal(toggled.policy.gate, true);
    assert.equal(toggled.policy.defaultActionMode, "inherit_dsh");
    assert.equal(toggled.policy.revision, confirmed.policy.revision + 1);
    // Turning it back off is the same call and the same exception.
    const off = await h.service.setRoomPolicy(h.room.id, { defaultActionMode: "inherit_dsh",
      expectedRevision: toggled.policy.revision, gate: false });
    assert.equal(off.policy.gate, undefined);
    assert.equal(off.policy.defaultActionMode, "inherit_dsh");
    // The exception is only the gate: a call that also moves the mode still
    // refuses without the confirmation, so the gate is not a way around it.
    await assert.rejects(h.service.setRoomPolicy(h.room.id, { defaultActionMode: "workspace_write",
      expectedRevision: off.policy.revision, gate: true }), /explicit risk confirmation/);
    // So does naming an execution mode whose native preset would be re-applied
    // in the same call.
    await assert.rejects(h.service.setRoomPolicy(h.room.id, { defaultActionMode: "full_access",
      expectedRevision: off.policy.revision, gate: true }), /explicit risk confirmation/);
    // Neither refused call moved anything.
    const after = await h.service.resolveRoom(h.room.id);
    assert.equal(after.policy.revision, off.policy.revision);
    assert.equal(after.policy.defaultActionMode, "inherit_dsh");
    assert.equal(after.policy.gate, undefined);
  } finally {
    await h.close();
  }
});

test("with the gate off, a whole turn behaves exactly as it did before the gate existed", async () => {
  const { h, lock } = await gatedTurn();
  try {
    // 1. Tool execution outcome, refusal text included.
    assert.deepEqual(runCases(h, lock), PRE_GATE_OUTCOMES);
    // The turn's deliveries are recorded without their caller awaiting them, so
    // the log has to be read once its writes have settled. This waits for the
    // work already issued; it does not wait for, or start, anything new.
    await h.settle();
    const events = await h.events();
    // 2. The emitted event sequence.
    assert.deepEqual(events.map((event) => event.type), PRE_GATE_EVENT_TYPES);
    assert.ok(!events.some((event) => event.type === "action_gate"),
      "a room with the gate off records no judgement about its executions");
    // 3. The prompt text every delivery carried, compared after replacing the
    //    identifiers that are fresh UUIDs on each run.
    const prompts = events.filter((event) => event.type === "turn.prompt").map((event) => event.payload);
    assert.deepEqual(prompts.map((payload) => payload.promptChars), PRE_GATE_PROMPTS.map((expected) => expected.chars));
    prompts.forEach((payload, index) => {
      const normalized = payload.prompt.replace(UUID, "{id}");
      assert.equal(createHash("sha256").update(normalized).digest("hex"),
        PRE_GATE_PROMPTS[index].sha256, normalized);
    });
  } finally {
    await h.close();
  }
});

/**
 * The same scenario, repeated with the state directory under concurrent write
 * load. The lock above reads the log immediately after a turn opens, which is
 * exactly the window in which the turn's last delivery event is still queued
 * behind its save; without waiting for that save the read can win the race and
 * report a sequence that is one event short. Each round here asserts the same
 * exact sequence the lock does, so a round that skipped the wait would fail
 * intermittently rather than quietly compare a shorter list.
 */
test("the gate-off turn holds its exact recorded sequence across repeated loaded runs", async () => {
  const ROUNDS = 16;
  const sequences = new Set();
  for (let round = 1; round <= ROUNDS; round += 1) {
    const { h, lock } = await gatedTurn();
    // A burst of independent writes into the same directory: they contend with
    // the turn's own save and append, which is what made the read race real.
    let noise;
    try {
      noise = Array.from({ length: 24 }, (_, index) =>
        writeFile(join(h.directory, `noise-${round}-${index}.tmp`), "x".repeat(8_192)));
      assert.deepEqual(runCases(h, lock), PRE_GATE_OUTCOMES, `round ${round}: the guard's decisions`);
      await h.settle();
      await Promise.all(noise);
      const events = await h.events();
      const types = events.map((event) => event.type);
      assert.deepEqual(types, PRE_GATE_EVENT_TYPES, `round ${round}: the emitted event sequence`);
      const prompts = events.filter((event) => event.type === "turn.prompt").map((event) => event.payload);
      assert.deepEqual(prompts.map((payload) => payload.promptChars),
        PRE_GATE_PROMPTS.map((expected) => expected.chars), `round ${round}: the prompt sizes`);
      for (const [index, payload] of prompts.entries()) {
        const normalized = payload.prompt.replace(UUID, "{id}");
        assert.equal(createHash("sha256").update(normalized).digest("hex"),
          PRE_GATE_PROMPTS[index].sha256, `round ${round}: prompt ${index + 1}`);
      }
      sequences.add(types.join(","));
    } finally {
      await Promise.allSettled(noise ?? []);
      await h.close();
    }
  }
  assert.equal(sequences.size, 1, "every round must record the same sequence, not merely a passing one");
  assert.deepEqual([...sequences], [PRE_GATE_EVENT_TYPES.join(",")]);
});

test("turning the gate on only adds refusals, and never rewrites one that already held", async () => {
  const { h, lock } = await gatedTurn();
  try {
    const off = runCases(h, lock);
    h.enableGate();
    const on = runCases(h, lock);
    assert.equal(off.length, on.length);
    const added = [];
    for (let index = 0; index < off.length; index += 1) {
      const [label, before] = off[index];
      const [, after] = on[index];
      if (before !== "allow") {
        // A refusal that already held is untouched: enabling the gate cannot
        // turn one refusal into another, or into an allowance.
        assert.equal(after, before, `${label} was refused before the gate and must stay refused the same way`);
        continue;
      }
      if (after !== "allow") added.push(label);
    }
    // The refusals the gate adds are exactly the execution-mode calls it judges,
    // and the three explanations are distinct.
    assert.deepEqual(added, ["bash", "write_file", "unnamed"]);
    const denials = new Map(on.filter(([label]) => added.includes(label)));
    assert.match(denials.get("bash"), /要求先由用户确认/);
    assert.match(denials.get("write_file"), /要求先由用户确认/);
    assert.match(denials.get("unnamed"), /无法判定/);
    assert.notEqual(denials.get("bash"), denials.get("unnamed"));
    // A low-impact read, a search, a room tool and every restricted-turn call
    // are still allowed: the gate is not a blanket refusal.
    for (const label of ["read", "web_search", "chat_work review", "restricted bash",
      "restricted read of the state file", "restricted loopback fetch", "restricted chat_relationships"]) {
      assert.equal(on.find(([name]) => name === label)[1], off.find(([name]) => name === label)[1],
        `${label} must be decided the same way with the gate on`);
    }
    // Each added refusal is recorded once, with the judgement and the counters
    // it was taken on.
    const recorded = (await h.events()).filter((event) => event.type === "action_gate");
    assert.deepEqual(recorded.map((event) => event.payload.judgement),
      ["require_confirmation", "require_confirmation", "deny"]);
    assert.deepEqual(recorded.map((event) => event.payload.tool), ["bash", "write_file", null]);
    for (const event of recorded) {
      assert.equal(event.payload.basis.counters.deliveryFailures, 1);
      assert.equal(event.payload.basis.counters.deliverySuccesses, 0);
    }
    // The tool table is the only place a tool's kind is decided, and a tool it
    // does not name is read conservatively. This member carries no open
    // disagreement of their own, so the review reading has nothing to fire on
    // here — the lock for that reading lives beside the pure judgement — but the
    // high-impact reading must reach a tool nobody registered, or leaving a tool
    // out of the table would be the way around the rule.
    h.setSample([{ observer: "s1", target: "s1", tick: 1,
      counters: { deliveryFailures: 1, deliverySuccesses: 0, unresolvedDisagreements: 0 } }]);
    const unlisted = h.service.guardToolExecution(exec("some_tool_from_the_future", { x: 1 }));
    assert.match(unlisted, /要求先由用户确认/);
    const last = (await h.events()).filter((event) => event.type === "action_gate").at(-1);
    assert.equal(last.payload.tool, "some_tool_from_the_future");
    assert.equal(last.payload.judgement, "require_confirmation");
    assert.equal(last.payload.riskClass, "high");
    assert.equal(last.payload.action, "execute");
  } finally {
    await h.close();
  }
});
