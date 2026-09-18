import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { DshChatLocalService, relationshipDigest, RELATIONSHIP_DIGEST_MAX_CHARS } from "../lib/room-store.js";
import { apply } from "../lib/index.js";
import { deriveRelationships, effectiveAppraisals } from "../lib/relationship.js";
import { configHashOf, injectionConfigFor, RUN_MANIFEST_EVENT_TYPE,
  RELATIONSHIP_DIGEST_HEADING, RELATIONSHIP_DIGEST_APPRAISAL_HEADING } from "../lib/experiment.js";
import { evaluate } from "../scripts/relationship-eval.mjs";

/**
 * The experiment's own surfaces: the human-only intervention API, the run
 * manifest, the two arms, and the injection cost record.
 *
 * Everything here drives the real service. The pure derivation's treatment of an
 * intervention is covered in `test/relationship.test.js`; what is covered here is
 * the writer: what it refuses, what it records, and how the arm changes a turn.
 */

async function waitFor(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** One service with two members and a captured delivery seam, never a real Session. */
async function harness(config = {}, { onDeliver } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-intervention-"));
  const calls = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: {
      status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => {
        calls.push({ from, to, text, delivery });
        if (onDeliver) await onDeliver({ from, to, text, delivery });
      }
    },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800, ...config });
  await service.ready;
  const room = await service.createRoom({ name: "实验房间", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }, { kind: "session", sessionId: "s2", alias: "乙" }] });
  return { directory, service, room, calls, ctx,
    close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}

/** The delivery the room handed to one member, waiting for it if it is not out yet. */
async function deliveryFor(h, sessionId) {
  return await waitFor(() => h.calls.find((call) => call.to === sessionId), `the delivery to ${sessionId}`);
}

/** Open the restricted turn a delivered message starts for one member. */
async function activate(h, call, turn = 1) {
  await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn } });
  await h.service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
}

/** Open the turn, answer it, and close it, as DSH reports the whole exchange. */
async function replyTo(h, call, text, turn = 1) {
  await activate(h, call, turn);
  await h.service.observeSessionEvent(call.to, { type: "assistant/message", data: { turn, step: 1,
    message: { content: [{ type: "text", text }] } } });
  await h.service.observeSessionEvent(call.to, { type: "turn/end", data: { turn, reason: { kind: "completed" } } });
}

/**
 * Send one human message and answer every delivery it makes, starting one
 * episode. The turn delivers to its members one at a time — each delivery waits
 * for its own reply — so the new deliveries are taken as they appear rather than
 * read once when the first arrives.
 */
async function runEpisode(h, text, reply = "回复", turn = 1) {
  const known = new Set(h.calls.map((call) => call.delivery.id));
  const answered = new Set();
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const call of h.calls.filter((item) => !known.has(item.delivery.id) && !answered.has(item.delivery.id))) {
      answered.add(call.delivery.id);
      await replyTo(h, call, reply, turn);
    }
    const room = await h.service.resolveRoom(h.room.id);
    if (room.orchestration?.state === "idle") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await waitFor(async () => (await h.service.resolveRoom(h.room.id)).orchestration?.state === "idle", "the episode to end");
  await h.service.settledAudit();
  return h.calls.filter((call) => answered.has(call.delivery.id));
}

/** Every event of one type in a room's log, oldest first. */
async function eventsOfType(h, type, roomId = h.room.id) {
  return (await h.service.eventsFor(roomId)).filter((event) => event.type === type);
}

// --- Task 5.1: the intervention API -----------------------------------------

test("an intervention from inside a group-chat turn is refused", async () => {
  const h = await harness();
  try {
    await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "开始" });
    const call = await deliveryFor(h, "s1");
    await activate(h, call);
    // The member is inside its turn: this is exactly the call an agent would
    // make to clear its own counters, and it must not land.
    await assert.rejects(() => h.service.relationshipIntervention(h.room.id,
      { action: "clear", appliedBy: "human", mechanism: "agent-attempt" }), /group-chat turn is active/);
    assert.equal((await eventsOfType(h, "relationship.intervention")).length, 0,
      "a refused intervention must not reach the log");
    // Closing the turn reopens the human path: the refusal is about the active
    // turn, not a blanket denial of the endpoint.
    await h.service.observeSessionEvent("s1", { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    await waitFor(async () => (await h.service.resolveRoom(h.room.id)).orchestration?.state === "idle", "the turn to end");
    await h.service.relationshipIntervention(h.room.id,
      { action: "clear", appliedBy: "human", mechanism: "after-the-turn" });
    assert.equal((await eventsOfType(h, "relationship.intervention")).length, 1);
  } finally { await h.close(); }
});

test("the intervention endpoint is human-only, over its own route and over the service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-intervention-route-"));
  let handler;
  const disposers = [];
  try {
    apply({ effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
      on() {}, tools: { register() {}, guard() {} },
      webServer: { register(route) { handler = route.handler; } },
      get() {} }, { path: join(directory, "rooms.json") });
    const request = async (path, body) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))]);
      req.url = `/api/dsh-chat-local${path}`;
      req.method = "POST";
      let status, text;
      await handler(req, { writeHead(code) { status = code; }, end(body2) { text = body2; } });
      return { status, body: JSON.parse(text) };
    };
    const created = await request("/rooms", { name: "路由", autoDeliver: false,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    assert.equal(created.status, 200, created.body.error);
    const roomId = created.body.value.id;
    for (const appliedBy of [undefined, "agent", "system", "arm", "Human"]) {
      const answer = await request(`/rooms/${roomId}/relationship-intervention`,
        { action: "clear", appliedBy, mechanism: "test" });
      assert.equal(answer.status, 403, `appliedBy=${String(appliedBy)} must be refused`);
      assert.match(answer.body.error, /appliedBy must be "human"/);
    }
    const missingMechanism = await request(`/rooms/${roomId}/relationship-intervention`,
      { action: "clear", appliedBy: "human" });
    assert.equal(missingMechanism.status, 400);
    assert.match(missingMechanism.body.error, /mechanism/);
    const unknownAction = await request(`/rooms/${roomId}/relationship-intervention`,
      { action: "wipe", appliedBy: "human", mechanism: "test" });
    assert.equal(unknownAction.status, 400);
    assert.match(unknownAction.body.error, /action must be one of set, clear, seed/);
    const accepted = await request(`/rooms/${roomId}/relationship-intervention`,
      { action: "clear", appliedBy: "human", mechanism: "cli" });
    assert.equal(accepted.status, 200, accepted.body.error);
    assert.equal(accepted.body.value.action, "clear");
    // No agent tool exists for either experiment endpoint: the only way in is
    // this HTTP surface, which is human-only by construction above.
    const names = [];
    apply({ effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
      on() {}, tools: { register(tool) { names.push(tool.name); }, guard() {} },
      webServer: { register() {} }, get() {} }, { path: join(directory, "rooms2.json") });
    assert.deepEqual(names.filter((name) => /interven|manifest|experiment/u.test(name)), [],
      "the experiment's mutating endpoints must not be agent-callable tools");
  } finally {
    for (const dispose of disposers.reverse()) await dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an intervention records the counters as they stood before it", async () => {
  const h = await harness();
  try {
    await runEpisode(h, "第一轮", "回复一");
    const before = deriveRelationships({ events: await h.service.eventsFor(h.room.id), roomId: h.room.id });
    const authored = before.pairs.find((pair) => pair.observer === "s1" && pair.target === "s1").counters.messagesAuthored;
    assert.ok(authored > 0, "the fixture must carry a counter for the intervention to close over");
    const result = await h.service.relationshipIntervention(h.room.id,
      { action: "clear", targetId: "s1", appliedBy: "human", mechanism: "manual-reset", note: "reset for the second arm" });
    const recorded = (await eventsOfType(h, "relationship.intervention"))[0];
    assert.equal(recorded.payload.appliedBy, "human");
    assert.equal(recorded.payload.mechanism, "manual-reset");
    assert.equal(recorded.payload.note, "reset for the second arm");
    assert.equal(recorded.payload.action, "clear");
    assert.equal(recorded.payload.targetId, "s1");
    assert.equal(recorded.payload.counters, null);
    assert.equal(recorded.payload.countersBefore.s1.messagesAuthored, authored,
      "the event must state what it reset, not only that it reset");
    assert.deepEqual(Object.keys(recorded.payload.countersBefore), ["s1"],
      "the before table covers exactly the scope the intervention named");
    assert.equal(recorded.id, result.interventionId);
    // The derivation moves, and only from the intervention on.
    const after = deriveRelationships({ events: await h.service.eventsFor(h.room.id), roomId: h.room.id });
    assert.equal(after.pairs.find((pair) => pair.target === "s1" && pair.observer === "s1").counters.messagesAuthored, 0);
    assert.equal(after.pairs.find((pair) => pair.target === "s2" && pair.observer === "s2").counters.messagesAuthored, 1,
      "a target the intervention did not name keeps its counters");
  } finally { await h.close(); }
});

test("invalid intervention input is refused with a reason, never silently ignored", async () => {
  const h = await harness();
  try {
    const cases = [
      [{ action: "clear", appliedBy: "human", mechanism: "x", targetId: "nobody" }, /not a member of this room/],
      [{ action: "clear", appliedBy: "human", mechanism: "x", observerId: "nobody" }, /not a member of this room/],
      [{ action: "set", appliedBy: "human", mechanism: "x", targetId: "s1", counters: { messagesAuthored: -1 } }, /non-negative integers/],
      [{ action: "set", appliedBy: "human", mechanism: "x", targetId: "s1", counters: { messagesAuthored: 1.5 } }, /non-negative integers/],
      [{ action: "set", appliedBy: "human", mechanism: "x", targetId: "s1", counters: { notACounter: 1 } }, /non-negative integers/],
      [{ action: "set", appliedBy: "human", mechanism: "x", targetId: "s1", counters: {} }, /non-negative integers/],
      [{ action: "set", appliedBy: "human", mechanism: "x", targetId: "s1" }, /non-negative integers/],
      [{ action: "seed", appliedBy: "human", mechanism: "x", targetId: "s1", counters: { messagesAuthored: 1 } }, null],
      [{ action: "clear", appliedBy: "human", mechanism: "x", counters: { messagesAuthored: 1 } }, /clear takes no counters/],
      [{ action: "clear", appliedBy: "human" }, /mechanism/],
      [{ action: "clear", appliedBy: "human", mechanism: "x", extra: 1 }, /unsupported intervention field: extra/],
      [{ action: "clear", mechanism: "x" }, /appliedBy must be "human"/]
    ];
    for (const [input, pattern] of cases) {
      const call = () => h.service.relationshipIntervention(h.room.id, input);
      if (pattern === null) {
        // The one valid call in the table also proves the table is not passing
        // because everything throws.
        assert.equal((await call()).action, "seed");
        continue;
      }
      await assert.rejects(call, pattern, `expected a refusal for ${JSON.stringify(input)}`);
    }
    // Nothing invalid reached the log: one `seed`, nothing else.
    const recorded = await eventsOfType(h, "relationship.intervention");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].payload.action, "seed");
  } finally { await h.close(); }
});

test("set and seed give the counting window its starting counters", async () => {
  const h = await harness();
  try {
    await runEpisode(h, "第一轮", "回复一");
    await h.service.relationshipIntervention(h.room.id,
      { action: "seed", targetId: "s2", counters: { deliveryFailures: 2, messagesAuthored: 5 },
        appliedBy: "human", mechanism: "initial-condition" });
    const derived = deriveRelationships({ events: await h.service.eventsFor(h.room.id), roomId: h.room.id });
    const row = derived.pairs.find((pair) => pair.observer === "s1" && pair.target === "s2").counters;
    assert.equal(row.deliveryFailures, 2);
    assert.equal(row.messagesAuthored, 5);
    assert.equal(row.deliveriesOffered, 0, "a counter the seed did not name starts the window at zero");
  } finally { await h.close(); }
});

test("a reset changes the projection but the log keeps every earlier record", async () => {
  const h = await harness();
  try {
    await runEpisode(h, "第一轮", "回复一");
    // The projection reports what a snapshot stated and a snapshot is taken as
    // its turn is scheduled, so it takes a second episode for the first one's
    // reply to appear in it.
    await runEpisode(h, "第二轮", "回复二", 2);
    const projectedBefore = await h.service.relationships(h.room.id);
    assert.ok(projectedBefore.s2.s2.messagesAuthored > 0, "the projection must carry a counter to reset");
    await h.service.relationshipIntervention(h.room.id,
      { action: "clear", appliedBy: "human", mechanism: "manual-reset" });
    const third = await runEpisode(h, "第三轮", "回复三", 3);
    assert.ok(third.length > 0, "the post-reset episode must run");
    const projectedAfter = await h.service.relationships(h.room.id);
    assert.equal(projectedAfter.s2.s2.messagesAuthored, 0, "the reset must reach the projection");
    const events = await h.service.eventsFor(h.room.id);
    assert.ok(events.some((event) => event.type === "relationship.snapshot" && event.payload.pairs
      .some((pair) => pair.observer === "s2" && pair.target === "s2" && pair.counters.messagesAuthored > 0)),
      "the pre-reset snapshot stays in the log, byte for byte");
    assert.ok(events.some((event) => event.type === "message.created"
      && event.payload.authorKind === "session"), "the events the reset closed over stay in the log");
  } finally { await h.close(); }
});

// --- Task 5.2: the run manifest ---------------------------------------------

test("a run manifest records the arm, the real models, the state version and the injection config hash", async () => {
  const h = await harness();
  try {
    const manifest = await h.service.startRun(h.room.id, { arm: "persistent", appliedBy: "human" });
    const recorded = (await eventsOfType(h, RUN_MANIFEST_EVENT_TYPE))[0];
    assert.deepEqual(Object.keys(recorded.payload).sort(),
      ["arm", "configHash", "initialStateVersion", "models", "startedAtTick"]);
    assert.equal(recorded.payload.arm, "persistent");
    assert.equal(recorded.payload.initialStateVersion, h.service.stateVersion());
    assert.equal(recorded.payload.startedAtTick, 0);
    assert.match(recorded.payload.configHash, /^[0-9a-f]{64}$/u);
    // The runtime cannot report a model in this harness, and the manifest says
    // exactly that rather than inventing one.
    assert.deepEqual(recorded.payload.models, { s1: { provider: null, model: null }, s2: { provider: null, model: null } });
    assert.equal(manifest.configHash, recorded.payload.configHash);
    assert.deepEqual(manifest.config, injectionConfigFor({ room: h.room, appraisalDigest: true }));
  } finally { await h.close(); }
});

test("the run manifest refuses a caller-supplied model and any unknown field", async () => {
  const h = await harness();
  try {
    await assert.rejects(() => h.service.startRun(h.room.id,
      { arm: "persistent", appliedBy: "human", models: { s1: { provider: "x", model: "y" } } }),
      /unsupported run manifest field: models/);
    await assert.rejects(() => h.service.startRun(h.room.id, { arm: "sideways", appliedBy: "human" }),
      /arm must be one of persistent, reset_per_episode/);
    await assert.rejects(() => h.service.startRun(h.room.id, { arm: "persistent", appliedBy: "agent" }),
      /appliedBy must be "human"/);
    assert.equal((await eventsOfType(h, RUN_MANIFEST_EVENT_TYPE)).length, 0);
  } finally { await h.close(); }
});

test("the config hash covers the injection cap, the gate and the judgement half", async () => {
  const h = await harness();
  try {
    const room = h.room;
    const base = configHashOf(injectionConfigFor({ room, appraisalDigest: true }));
    // The gate, term by term, through the room object the service hashes.
    const gated = { ...room, policy: { ...room.policy, gate: true } };
    assert.notEqual(configHashOf(injectionConfigFor({ room: gated, appraisalDigest: true })), base);
    // The judgement half.
    assert.notEqual(configHashOf(injectionConfigFor({ room, appraisalDigest: false })), base);
    // And the service's own endpoint reports the hash of its own configuration.
    const off = await harness({ appraisalDigest: false });
    try {
      const onManifest = await h.service.startRun(room.id, { arm: "persistent", appliedBy: "human" });
      const offManifest = await off.service.startRun(off.room.id, { arm: "persistent", appliedBy: "human" });
      assert.notEqual(onManifest.configHash, offManifest.configHash,
        "switching the judgement half off must change the hash of a run");
      assert.equal(offManifest.configHash, configHashOf(injectionConfigFor({ room: off.room, appraisalDigest: false })));
    } finally { await off.close(); }
  } finally { await h.close(); }
});

// --- Task 5.3: the two arms --------------------------------------------------

test("reset_per_episode resets at every episode; persistent never does", async () => {
  const persistent = await harness();
  const reset = await harness();
  try {
    for (const h of [persistent, reset]) {
      await h.service.startRun(h.room.id, { arm: h === reset ? "reset_per_episode" : "persistent", appliedBy: "human" });
      await runEpisode(h, "第一轮", "回复一");
      await runEpisode(h, "第二轮", "回复二", 2);
    }
    // The automatic intervention is an intervention like any other: it states
    // what it closed over and it is visibly the arm's, not a human's.
    const automatic = await eventsOfType(reset, "relationship.intervention");
    assert.equal(automatic.length, 2, "one reset at the start of each episode");
    for (const event of automatic) {
      assert.equal(event.payload.action, "clear");
      assert.equal(event.payload.appliedBy, "arm");
      assert.equal(event.payload.mechanism, "arm:reset_per_episode");
      assert.ok(event.payload.countersBefore && typeof event.payload.countersBefore === "object");
    }
    assert.deepEqual(Object.keys(automatic[1].payload.countersBefore).sort(), ["s1", "s2"]);
    // Each reset names the episode it opened, and the two episodes are distinct.
    assert.equal(new Set(automatic.map((event) => event.payload.episodeId)).size, 2);
    assert.equal((await eventsOfType(persistent, "relationship.intervention")).length, 0,
      "the persistent arm must not produce an automatic intervention");
    // Same interaction, different dependent variable: the second episode's own
    // snapshot is the turn's injection sample.
    const secondSnapshot = async (h) => (await eventsOfType(h, "relationship.snapshot"))[1];
    const cell = (snapshot, target) => snapshot.payload.pairs
      .find((pair) => pair.observer === target && pair.target === target).counters;
    assert.ok(cell(await secondSnapshot(persistent), "s2").messagesAuthored > 0,
      "the persistent arm carries the first episode's counter into the second");
    assert.equal(cell(await secondSnapshot(reset), "s2").messagesAuthored, 0,
      "the reset arm starts the second episode from zero");
  } finally { await persistent.close(); await reset.close(); }
});

test("the arm a room is in comes from its own log, not from the process", async () => {
  const h = await harness();
  try {
    // No manifest yet: the arm is the default, and no reset is emitted.
    await runEpisode(h, "第一轮", "回复一");
    assert.equal((await eventsOfType(h, "relationship.intervention")).length, 0);
    await h.service.startRun(h.room.id, { arm: "reset_per_episode", appliedBy: "human" });
    await runEpisode(h, "第二轮", "回复二", 2);
    const automatic = await eventsOfType(h, "relationship.intervention");
    assert.equal(automatic.length, 1, "the arm switched mid-log governs from the manifest on");
    const manifests = await eventsOfType(h, RUN_MANIFEST_EVENT_TYPE);
    assert.ok(automatic[0].tick >= manifests[0].tick);
  } finally { await h.close(); }
});

test("one episode is one reset, even when a failed delivery is retried", async () => {
  // The recovery path runs a second `#runTurn` for the same root message, so a
  // reset appended per turn would fire twice for one human message and the arm
  // would be "reset per attempt" rather than the "reset per episode" its name,
  // mechanism and documentation state. The second attempt is not a new episode.
  let failing = true;
  const h = await harness({}, { onDeliver: async () => {
    if (failing) { failing = false; throw new Error("temporary bridge failure"); }
  } });
  try {
    const room = await h.service.createRoom({ name: "重试房间", autoDeliver: true,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    await h.service.startRun(room.id, { arm: "reset_per_episode", appliedBy: "human" });
    const original = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "重试我" });
    const first = await waitFor(() => h.calls[0], "the first delivery");
    await waitFor(async () => (await h.service.messages(room.id))[0]?.deliveries?.[0]?.status === "failed",
      "the first delivery to fail");
    await waitFor(async () => !["queued", "running"].includes((await h.service.resolveRoom(room.id)).orchestration?.state),
      "the failed turn to finish");
    // The same root message is retried under the same arm.
    await h.service.retryFailedDeliveries(room.id, original.id);
    const retried = await waitFor(() => h.calls.find((call) => call.delivery.id !== first.delivery.id),
      "the retried delivery");
    await replyTo(h, retried, "重试成功");
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration?.state === "idle",
      "the retried turn to end");
    await h.service.settledAudit();
    const events = await h.service.eventsFor(room.id);
    // Two turns really did run: the property is "no second reset", not "the
    // recovery path skipped the turn".
    assert.equal(events.filter((event) => event.type === "turn.scheduled").length, 2);
    const resets = events.filter((event) => event.type === "relationship.intervention"
      && event.payload.appliedBy === "arm");
    assert.equal(resets.length, 1, "one episode is one reset, however many turn attempts it takes");
    assert.equal(resets[0].payload.episodeId, original.id, "the reset names the episode it opened");
    assert.equal(resets[0].payload.mechanism, "arm:reset_per_episode");
  } finally { await h.close(); }
});

// --- Task 5.5: injection cost ------------------------------------------------

/**
 * The gate's unit is a member turn that reached the member, and this is the
 * reproduction that proves it: one healthy episode, then ten restarts whose only
 * delivery the transport refuses. Every refused attempt still writes its
 * `turn.prompt` and `injection.cost` — they are appended before the transport is
 * called — so a gate keyed on the cost record alone counts eleven runs and
 * concludes, which is exactly the "green but false" outcome the ten-run gate
 * exists to prevent. The join to the delivery that reached the member is what
 * makes the count mean "a member turn happened".
 */
test("eleven runs in which one member turn happened are not a sample", async () => {
  let refusing = false;
  const h = await harness({}, { onDeliver: async () => {
    if (refusing) throw new Error("transport refused every delivery");
  } });
  try {
    // A runtime that reports a model, so the eleven runs share one pool key. The
    // shared harness reports none, and a run with unknown models is pooled with
    // nothing at all (see the pool-key rule) — with those this test would refuse
    // for a second reason and could no longer tell the two gates apart.
    h.ctx.sessionQuery = { observeSession: async () => ({
      header: { cwd: "/tmp" },
      projections: { values: { modelSelection: { next: { provider: "test", model: "model" } } } },
      [Symbol.dispose]() {}
    }) };
    await h.service.startRun(h.room.id, { arm: "persistent", appliedBy: "human" });
    await runEpisode(h, "第一轮", "回复一");
    // Ten restarts, each one human message, each delivery refused outright.
    refusing = true;
    for (let index = 1; index <= 10; index += 1) {
      await h.service.startRun(h.room.id, { arm: "persistent", appliedBy: "human" });
      await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: `第 ${index} 次重启` });
      await waitFor(async () => !["queued", "running"].includes((await h.service.resolveRoom(h.room.id)).orchestration?.state),
        "the refused turn to finish");
    }
    await h.service.settledAudit();
    // The writer really did construct an injection for every refused delivery:
    // the defect is not that nothing was recorded.
    const costs = await eventsOfType(h, "injection.cost");
    assert.ok(costs.length >= 11, "the writer constructs an injection for every attempted delivery");
    const settled = await eventsOfType(h, "delivery.settled");
    assert.ok(settled.filter((event) => event.payload.status === "failed").length >= 10,
      "every post-episode delivery failed");
    assert.equal(settled.filter((event) => event.payload.status === "delivered").length, 2,
      "only the healthy episode's two deliveries ever reached a member");
    const manifests = await eventsOfType(h, RUN_MANIFEST_EVENT_TYPE);
    assert.equal(manifests.length, 11);
    assert.ok(manifests.every((event) => event.payload.models.s1.model === "model"),
      "the pool key must be able to certify the models, or this test proves nothing");
    const report = await evaluate({ statePath: join(h.directory, "rooms.json") });
    assert.equal(report.runs.length, 11, "every manifest-bearing segment is still reported");
    assert.equal(report.assertsConclusions, false, "one real member turn is not eleven observations");
    assert.equal(report.status, "insufficient-sample");
    assert.deepEqual(report.runs.map((run) => run.analysable),
      [true, ...Array.from({ length: 10 }, () => false)]);
    assert.ok(report.runs.slice(1).every((run) => run.dependentVariables.unreachedInjections >= 1),
      "each refused run holds constructed injections no member ever received");
    // One pool key for all eleven, so the refusal is the interaction gate: with
    // the join removed, eleven analysable runs would satisfy it.
    assert.equal(report.groups.length, 1);
    const group = report.groups[0];
    assert.equal(group.modelsKnown, true);
    assert.equal(group.runCount, 11);
    assert.equal(group.analysableRunCount, 1, "only the run whose delivery reached the members counts");
    assert.equal(group.sufficient, false);
    assert.equal(group.statistics, null);
  } finally { await h.close(); }
});

test("the injection cost records the characters actually injected", async () => {
  const h = await harness();
  try {
    await runEpisode(h, "第一轮", "回复一");
    const calls = await runEpisode(h, "第二轮", "回复二", 2);
    const events = await h.service.eventsFor(h.room.id);
    const snapshots = events.filter((event) => event.type === "relationship.snapshot");
    // The second episode's snapshot is the sample its own prompts were built
    // from, so the digest a prompt carried can be re-derived exactly.
    const sample = snapshots[1];
    const aliases = new Map([["s1", "甲"], ["s2", "乙"]]);
    const appraisals = effectiveAppraisals(events, h.room.id, sample.payload.asOfTick);
    const digest = relationshipDigest({ derived: { pairs: sample.payload.pairs }, observer: "s1",
      appraisals, labelOf: (sessionId) => aliases.get(sessionId) });
    assert.ok(digest && digest.length > 0, "the fixture must inject a non-empty digest");
    assert.ok(digest.length <= RELATIONSHIP_DIGEST_MAX_CHARS);
    const prompt = events.filter((event) => event.type === "turn.prompt")
      .find((event) => event.payload.memberSessionId === "s1"
        && event.payload.deliveryId === calls.find((call) => call.to === "s1").delivery.id);
    assert.ok(prompt.payload.prompt.includes(digest), "the recorded characters must be of text the member was sent");
    const cost = events.filter((event) => event.type === "injection.cost")
      .find((event) => event.payload.deliveryId === prompt.payload.deliveryId);
    assert.equal(cost.payload.digestChars, digest.length, "the recorded size is the injected text's own length");
    assert.equal(cost.payload.digestHash, createHash("sha256").update(digest).digest("hex"));
    assert.equal(cost.payload.promptChars, prompt.payload.promptChars);
    // The token figure is an estimate and is labelled as one, with the counts it
    // was taken from so a reader can recompute it under another rule.
    assert.equal(cost.payload.tokenEstimateExact, false);
    assert.match(cost.payload.tokenEstimateMethod, /token/u);
    assert.equal(typeof cost.payload.estimatedTokens, "number");
    assert.equal(cost.payload.tokenEstimateCjkChars + cost.payload.tokenEstimateOtherChars, digest.length);
    assert.equal(cost.payload.estimatedTokens,
      Math.ceil(cost.payload.tokenEstimateCjkChars + cost.payload.tokenEstimateOtherChars / 4));
  } finally { await h.close(); }
});

test("switching the judgement half off removes appraisals from the prompt and keeps the counters", async () => {
  for (const appraisalDigest of [true, false]) {
    const h = await harness({ appraisalDigest });
    try {
      await runEpisode(h, "第一轮", "回复一");
      const cited = (await h.service.eventsFor(h.room.id))
        .find((event) => event.type === "message.created" && event.provenance?.actorId === "s2");
      // The appraisal has to be recorded inside an active turn, so the second
      // episode is answered by hand rather than by `runEpisode`.
      const known = new Set(h.calls.map((call) => call.delivery.id));
      await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第二轮" });
      const first = await waitFor(() => h.calls.find((call) => call.to === "s1" && !known.has(call.delivery.id)),
        "the second episode's s1 delivery");
      known.add(first.delivery.id);
      await activate(h, first, 2);
      await h.service.appraise(h.room.id, "s1", { action: "record", aboutAgentId: "s2", stance: "trust",
        confidence: 0.8, claim: "他说清楚了", evidenceEventIds: [cited.payload.messageId] });
      await h.service.observeSessionEvent("s1", { type: "assistant/message", data: { turn: 2, step: 1,
        message: { content: [{ type: "text", text: "回复二" }] } } });
      await h.service.observeSessionEvent("s1", { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } });
      const second = await waitFor(() => h.calls.find((call) => call.to === "s2" && !known.has(call.delivery.id)),
        "the second episode's s2 delivery");
      await replyTo(h, second, "回复二", 2);
      await waitFor(async () => (await h.service.resolveRoom(h.room.id)).orchestration?.state === "idle", "the episode to end");
      await h.service.settledAudit();
      // The third episode is where the statement is injected or not.
      const calls = await runEpisode(h, "第三轮", "回复三", 3);
      const delivery = calls.find((call) => call.to === "s1").delivery.id;
      const events = await h.service.eventsFor(h.room.id);
      const prompt = events.filter((event) => event.type === "turn.prompt")
        .find((event) => event.payload.deliveryId === delivery).payload.prompt;
      assert.ok(prompt.includes(RELATIONSHIP_DIGEST_HEADING), "the counters always travel");
      assert.equal(prompt.includes(RELATIONSHIP_DIGEST_APPRAISAL_HEADING), appraisalDigest,
        `appraisalDigest=${appraisalDigest}: the judgement block is ${appraisalDigest ? "rendered" : "omitted"}`);
      assert.equal(prompt.includes("他说清楚了"), appraisalDigest, "and the claim with it");
      const cost = events.filter((event) => event.type === "injection.cost")
        .find((event) => event.payload.deliveryId === delivery);
      assert.ok(cost.payload.digestChars > 0 && cost.payload.digestChars <= RELATIONSHIP_DIGEST_MAX_CHARS);
    } finally { await h.close(); }
  }
});

test("a turn with no relationship text records a zero cost rather than a ceiling", async () => {
  const h = await harness();
  try {
    // A member the room has recorded nothing about gets no digest at all.
    const calls = await runEpisode(h, "第一轮", "回复一");
    assert.ok(calls.length > 0);
    const costs = await eventsOfType(h, "injection.cost");
    assert.ok(costs.length >= 1, "every delivered turn records its cost");
    for (const cost of costs) {
      assert.ok(cost.payload.digestChars <= RELATIONSHIP_DIGEST_MAX_CHARS);
      if (cost.payload.digestHash === null) assert.equal(cost.payload.digestChars, 0);
    }
  } finally { await h.close(); }
});
