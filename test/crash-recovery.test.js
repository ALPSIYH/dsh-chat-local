import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";
import { eventLogHeadPath, eventLogPath, verifyChain } from "../lib/event-log.js";

// Every probe uses a fresh process. A barrier is reported only after the real
// filesystem call has completed; the parent then sends SIGKILL without allowing
// close(), queued continuations, or finally blocks to repair the interrupted IO.
const childProgram = String.raw`
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const config = JSON.parse(process.env.DCL_CRASH_PROBE);
let armed = config.action === "recover";
let stopped = false;
async function barrier(point) {
  if (!armed || stopped || config.point !== point) return;
  stopped = true;
  process.send({ kind: "barrier", point });
  await new Promise(() => {});
}
const originalRename = fs.promises.rename;
fs.promises.rename = async (...args) => {
  const result = await originalRename(...args);
  if (String(args[1]) === config.statePath) {
    const matches = !config.requiredOperationId || JSON.parse(fs.readFileSync(config.statePath, "utf8"))
      .rooms.some(room => room.messages.some(message => message.clientOperationId === config.requiredOperationId));
    if (matches) await barrier("state-renamed");
  }
  return result;
};
const originalAppend = fs.promises.appendFile;
fs.promises.appendFile = async (...args) => {
  if (armed && config.holdAppends && String(args[0]) === config.logPath) await new Promise(() => {});
  const result = await originalAppend(...args);
  if (String(args[0]) === config.logPath) await barrier("event-appended");
  return result;
};
syncBuiltinESMExports();
const { DshChatLocalService } = await import(config.serviceUrl);
const service = new DshChatLocalService({}, { path: config.statePath });
try {
  await service.ready;
  armed = true;
  let result;
  if (config.action === "send") result = await service.send(config.input);
  else if (config.action === "batch-send") result = await Promise.all(config.inputs.map(input => service.send(input)));
  else if (config.action === "restore") result = await service.restoreFromSnapshot(config.snapshot, { confirm: true });
  else if (config.action !== "recover" && config.action !== "inspect-failure") throw new Error("unknown crash fixture action");
  await service.settledAudit();
  await barrier("response-lost");
  const room = await service.readRoomMemory(config.roomId);
  await service.close();
  process.send({ kind: "complete", result, room, health: service.logHealth() });
  process.disconnect();
} catch (error) {
  if (config.action === "inspect-failure") {
    process.send({ kind: "complete", startupError: String(error?.message ?? error), health: service.logHealth() });
    process.disconnect();
  } else {
  process.send({ kind: "error", message: String(error?.stack ?? error) });
  process.exitCode = 1;
  process.disconnect();
  }
}
`;

async function probe(fixture, config) {
  const payload = { statePath: fixture.statePath, roomId: fixture.room.id,
    logPath: eventLogPath(fixture.statePath, fixture.room.id),
    serviceUrl: new URL("../lib/room-store.js", import.meta.url).href, ...config };
  const child = spawn(process.execPath, ["--input-type=module", "-e", childProgram], {
    env: { ...process.env, DCL_CRASH_PROBE: JSON.stringify(payload) },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let diagnostics = "", result, checkpoint;
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`crash probe timed out at ${config.action}/${config.point ?? "complete"}: ${diagnostics}`));
    }, 15000);
    child.on("message", message => {
      if (message.kind === "barrier") {
        checkpoint = message.point;
        child.kill("SIGKILL");
      } else if (message.kind === "complete") result = message;
      else if (message.kind === "error") diagnostics += message.message;
    });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (config.point && checkpoint === config.point && signal === "SIGKILL") resolve({ checkpoint });
      else if (!config.point && code === 0 && result) resolve(result);
      else reject(new Error(`crash probe ${config.action}/${config.point ?? "complete"} did not satisfy its boundary (exit ${code}, signal ${signal}, reached ${checkpoint}): ${diagnostics}`));
    });
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-crash-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path: statePath });
  await service.ready;
  const room = await service.createRoom({ name: "Crash recovery fixture", autoDeliver: false });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "Earlier committed evidence", automaticDelivery: false });
  const snapshot = JSON.parse((await service.snapshotRun(room.id, "crash-fixture")).content);
  await service.close();
  const input = { roomId: room.id, author: "human:me", authorKind: "human", text: "Durable crash-boundary message",
    clientOperationId: "crash-operation", automaticDelivery: false };
  return { directory, statePath, room, snapshot, input };
}

function assertMessageExactlyOnce(recovered, input) {
  const messages = recovered.room.room.messages.filter(item => item.clientOperationId === input.clientOperationId);
  assert.equal(messages.length, 1, "the committed operation has exactly one message");
  const matching = recovered.room.events.filter(event => event.type === "message.created" && event.payload.messageId === messages[0].id);
  assert.equal(matching.length, 1, "cold startup must publish the committed message audit exactly once");
  assert.deepEqual(verifyChain(recovered.room.events), { ok: true, brokenAt: null });
  assert.equal(recovered.health.journal.pendingOperations, 0);
  assert.equal(recovered.health.journal.checkpointPending, false);
  return messages[0];
}

test("SIGKILL after state rename recovers the committed message audit before serving reads", async t => {
  const h = await fixture(t);
  await probe(h, { action: "send", point: "state-renamed", input: h.input });
  const disk = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.ok(disk.rooms[0].messages.some(item => item.clientOperationId === h.input.clientOperationId), "the fault is after the state commit");
  const recovered = await probe(h, { action: "recover" });
  assertMessageExactlyOnce(recovered, h.input);
});

test("SIGKILL after append but before anchor publication recovers one event and its head", async t => {
  const h = await fixture(t);
  const previousHead = await readFile(eventLogHeadPath(h.statePath, h.room.id), "utf8");
  await probe(h, { action: "send", point: "event-appended", input: h.input });
  const beforeRecovery = (await readFile(eventLogPath(h.statePath, h.room.id), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(await readFile(eventLogHeadPath(h.statePath, h.room.id), "utf8"), previousHead);
  assert.notEqual(beforeRecovery.at(-1).hash, previousHead, "the fault is between the event write and its anchor");
  const recovered = await probe(h, { action: "recover" });
  assertMessageExactlyOnce(recovered, h.input);
  assert.equal(await readFile(eventLogHeadPath(h.statePath, h.room.id), "utf8"), recovered.room.events.at(-1).hash,
    "startup must repair the interrupted head publication");
});

test("SIGKILL after restore state rename finishes the matching log replacement on cold startup", async t => {
  const h = await fixture(t);
  await probe(h, { action: "send", input: h.input });
  await probe(h, { action: "restore", point: "state-renamed", snapshot: h.snapshot });
  const disk = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.equal(disk.rooms[0].messages.length, h.snapshot.room.messages.length, "restored state is already committed");
  const recovered = await probe(h, { action: "recover" });
  assert.deepEqual(recovered.room.room.messages, h.snapshot.room.messages);
  assert.deepEqual(recovered.room.events, h.snapshot.events, "the old log must not be paired with restored state");
  assert.deepEqual(verifyChain(recovered.room.events), { ok: true, brokenAt: null });
});

test("two crashes during audit recovery remain idempotent on the third cold startup", async t => {
  const h = await fixture(t);
  await probe(h, { action: "send", point: "state-renamed", input: h.input });
  await probe(h, { action: "recover", point: "event-appended" });
  // The next restart must finish the same pending commit. Interrupt it after a
  // real state rewrite so its durable completion is itself restart-tested.
  await probe(h, { action: "recover", point: "state-renamed" });
  const recovered = await probe(h, { action: "recover" });
  assertMessageExactlyOnce(recovered, h.input);
  const again = await probe(h, { action: "recover" });
  assert.deepEqual(again.room, recovered.room, "another cold restart must not duplicate or revise recovered facts");
});

test("a lost response retried after restart returns the same message and one audit", async t => {
  const h = await fixture(t);
  await probe(h, { action: "send", point: "response-lost", input: h.input });
  const recovered = await probe(h, { action: "recover" });
  const original = assertMessageExactlyOnce(recovered, h.input);
  const replayed = await probe(h, { action: "send", input: h.input });
  assert.equal(replayed.result.id, original.id);
  assertMessageExactlyOnce(replayed, h.input);
  assert.deepEqual(replayed.room.events, recovered.room.events);
});

test("an obstructed recovery refuses startup, retains its pending audit, then recovers after repair", async t => {
  const h = await fixture(t);
  await probe(h, { action: "send", point: "state-renamed", input: h.input });
  const interrupted = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.ok(interrupted._journal?.pending.length > 0, "the incomplete commit must be durable, not process-local health");
  const path = eventLogPath(h.statePath, h.room.id);
  const saved = `${path}.fixture-backup`;
  await rename(path, saved);
  await mkdir(path);
  const failed = await probe(h, { action: "inspect-failure" });
  assert.match(failed.startupError ?? "", /audit recovery incomplete/i);
  assert.ok(failed.health.journal.pendingOperations > 0);
  assert.match(failed.health.journal.lastError, /audit recovery pending/i);
  const afterFailure = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.deepEqual(afterFailure._journal.pending.map(item => item.id), interrupted._journal.pending.map(item => item.id),
    "failed startup must not erase the evidence needed by another restart");
  await rm(path, { recursive: true });
  await rename(saved, path);
  const recovered = await probe(h, { action: "recover" });
  assertMessageExactlyOnce(recovered, h.input);
});

test("a later state commit carries an earlier still-unpublished message through a crash", async t => {
  const h = await fixture(t);
  const second = { ...h.input, clientOperationId: "crash-operation-second", text: "Later overlapping message" };
  await probe(h, { action: "batch-send", inputs: [h.input, second], point: "state-renamed",
    requiredOperationId: second.clientOperationId, holdAppends: true });
  const disk = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.equal(disk.rooms[0].messages.filter(item => [h.input.clientOperationId, second.clientOperationId].includes(item.clientOperationId)).length, 2);
  const recovered = await probe(h, { action: "recover" });
  assertMessageExactlyOnce(recovered, h.input);
  assertMessageExactlyOnce(recovered, second);
});
