import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, eventLogPath, verifyChain } from "../lib/event-log.js";
import { DshChatLocalService } from "../lib/room-store.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a public event read includes an append already registered, even while its disk write is held", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-log-read-order-"));
  const statePath = join(directory, "rooms.json");
  const log = new EventLog(statePath);
  const original = fs.promises.appendFile;
  const reachedWrite = deferred();
  const releaseWrite = deferred();
  let appending, reading;
  try {
    await log.append("room", { type: "first" });
    fs.promises.appendFile = async (...args) => {
      if (args[0] === eventLogPath(statePath, "room")) {
        reachedWrite.resolve();
        await releaseWrite.promise;
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    appending = log.append("room", { type: "second" });
    await reachedWrite.promise;
    reading = log.read("room");
    // Let an incorrectly unqueued read finish while the append remains held.
    // Correct readers are allowed to wait; releasing the write finishes both.
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseWrite.resolve();
    const events = await reading;
    await appending;
    assert.deepEqual(events.map((event) => event.type), ["first", "second"]);
    assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  } finally {
    releaseWrite.resolve();
    fs.promises.appendFile = original;
    syncBuiltinESMExports();
    await Promise.allSettled([appending, reading]);
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("persistence fixture did not reach its boundary");
}

async function activeRoom() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-appraise-restore-"));
  const deliveries = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { deliveries.push({ to, text, delivery }); } },
    get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 30000 });
  await service.ready;
  const room = await service.createRoom({ name: "Persisted judgement", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "One" }, { kind: "session", sessionId: "s2", alias: "Two" }] });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "fixture")).content);
  const message = await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "Original evidence", mentions: ["s1"] });
  await waitFor(() => deliveries.length > 0);
  await service.observeSessionEvent("s1", { type: "turn/start", data: { turn: 1 } });
  await service.observeSessionEvent("s1", { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${deliveries[0].delivery.id} from room:${room.id}]` }] } });
  await service.settledAudit();
  return { service, directory, room, snapshot, message, deliveries };
}

test("a suspended appraisal cannot write old evidence into a completed restore or the next prompt", async () => {
  const h = await activeRoom();
  const original = h.service.eventLog.read.bind(h.service.eventLog);
  const readFinished = deferred();
  const releaseRead = deferred();
  let armed = true;
  h.service.eventLog.read = async (...args) => {
    const events = await original(...args);
    if (armed) { armed = false; readFinished.resolve(); await releaseRead.promise; }
    return events;
  };
  let appraising;
  try {
    const claim = "Judgement belonging only to the discarded history";
    appraising = h.service.appraise(h.room.id, "s1", { aboutAgentId: "s2", stance: "trust",
      confidence: 0.7, claim, evidenceEventIds: [h.message.id] });
    appraising.catch(() => {});
    await readFinished.promise;
    await h.service.restoreFromSnapshot(h.snapshot, { confirm: true });
    releaseRead.resolve();
    await assert.rejects(appraising, /superseded|restored|active/);
    assert.ok(!(await h.service.eventsFor(h.room.id)).some((event) => event.type === "appraisal"));
    const previous = h.deliveries.length;
    await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "New history", mentions: ["s1"] });
    await waitFor(() => h.deliveries.length > previous);
    assert.ok(!h.deliveries[previous].text.includes(claim));
  } finally {
    releaseRead.resolve();
    await Promise.allSettled([appraising]);
    h.service.eventLog.read = original;
    await h.service.close();
    await rm(h.directory, { recursive: true, force: true });
  }
});

test("a run snapshot waits for the state and audit of a message already being saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snapshot-commit-"));
  const service = new DshChatLocalService({}, { path: join(directory, "rooms.json") });
  const held = deferred();
  let sending, exporting;
  try {
    await service.ready;
    const room = await service.createRoom({ name: "Commit boundary", autoDeliver: false });
    service.journal.writeTail = held.promise;
    sending = service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "Must have an audit" });
    await waitFor(() => service.journal.writeTail !== held.promise);
    exporting = service.snapshotRun(room.id, "fixture");
    await new Promise((resolve) => setTimeout(resolve, 20));
    held.resolve();
    const snapshot = JSON.parse((await exporting).content);
    await sending;
    const message = snapshot.room.messages.find((item) => item.text === "Must have an audit");
    assert.ok(message, "the registered save must be included");
    assert.ok(snapshot.events.some((event) => event.type === "message.created" && event.payload.messageId === message.id),
      "the exported message must have its committed audit event");
  } finally {
    held.resolve();
    await Promise.allSettled([sending, exporting]);
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a suspended revocation cannot be committed into a restored history", async () => {
  const h = await activeRoom();
  const releaseRead = deferred();
  const readFinished = deferred();
  const original = h.service.eventLog.read.bind(h.service.eventLog);
  let revoking;
  try {
    const recorded = await h.service.appraise(h.room.id, "s1", { aboutAgentId: "s2", stance: "trust",
      confidence: 0.7, claim: "A judgement to revoke later", evidenceEventIds: [h.message.id] });
    await h.service.observeSessionEvent("s1", { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    await waitFor(() => h.service.state.rooms[0].orchestration.state === "idle");
    const previous = h.deliveries.length;
    await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "Reconsider", mentions: ["s1"] });
    await waitFor(() => h.deliveries.length > previous);
    await h.service.observeSessionEvent("s1", { type: "turn/start", data: { turn: 2 } });
    await h.service.observeSessionEvent("s1", { type: "user/message", data: { content: [{ type: "text",
      text: `[dsh-bridge dsh-chat-local-room message ${h.deliveries[previous].delivery.id} from room:${h.room.id}]` }] } });
    await h.service.settledAudit();
    let armed = true;
    h.service.eventLog.read = async (...args) => {
      const events = await original(...args);
      if (armed) { armed = false; readFinished.resolve(); await releaseRead.promise; }
      return events;
    };
    revoking = h.service.appraise(h.room.id, "s1", { action: "revoke", aboutAgentId: "s2", appraisalId: recorded.appraisalId });
    revoking.catch(() => {});
    await readFinished.promise;
    await h.service.restoreFromSnapshot(h.snapshot, { confirm: true });
    releaseRead.resolve();
    await assert.rejects(revoking, /superseded|restored|active/);
    assert.ok(!(await h.service.eventsFor(h.room.id)).some((event) => event.type === "appraisal"));
  } finally {
    releaseRead.resolve();
    await Promise.allSettled([revoking]);
    h.service.eventLog.read = original;
    await h.service.close();
    await rm(h.directory, { recursive: true, force: true });
  }
});

test("a public read waits for an already registered replacement and validates its new anchor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-log-replace-read-"));
  const statePath = join(directory, "rooms.json");
  const log = new EventLog(statePath);
  const original = fs.promises.rename;
  const reachedRename = deferred();
  const releaseRename = deferred();
  let replacing, reading;
  try {
    const first = await log.append("room", { type: "first" });
    await log.append("room", { type: "discarded" });
    fs.promises.rename = async (...args) => {
      if (args[1] === eventLogPath(statePath, "room")) {
        reachedRename.resolve();
        await releaseRename.promise;
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    replacing = log.replace("room", [first]);
    await reachedRename.promise;
    reading = log.read("room");
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseRename.resolve();
    const events = await reading;
    await replacing;
    assert.deepEqual(events.map((event) => event.type), ["first"]);
    assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  } finally {
    releaseRename.resolve();
    fs.promises.rename = original;
    syncBuiltinESMExports();
    await Promise.allSettled([replacing, reading]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a snapshot after a failed state write exports committed state, never the unsaved message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snapshot-durable-"));
  const service = new DshChatLocalService({}, { path: join(directory, "rooms.json") });
  const original = fs.promises.rename;
  try {
    await service.ready;
    const room = await service.createRoom({ name: "Durable snapshot", autoDeliver: false });
    fs.promises.rename = async (...args) => {
      if (args[1] === service.path) throw Object.assign(new Error("injected state rename failure"), { code: "EIO" });
      return original(...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "Unsaved message" }), /injected/);
    fs.promises.rename = original;
    syncBuiltinESMExports();
    const snapshot = JSON.parse((await service.snapshotRun(room.id, "fixture")).content);
    assert.ok(!snapshot.room.messages.some((message) => message.text === "Unsaved message"));
    assert.ok(!snapshot.events.some((event) => event.type === "message.created" && event.payload.text === "Unsaved message"));
    assert.deepEqual(verifyChain(snapshot.events), { ok: true, brokenAt: null });
  } finally {
    fs.promises.rename = original;
    syncBuiltinESMExports();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
