import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";
import { eventLogPath, verifyChain } from "../lib/event-log.js";

const ioError = label => Object.assign(new Error(label), { code: "EIO" });
const checksum = pending => createHash("sha256").update(JSON.stringify(pending)).digest("hex");
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-journal-fault-"));
  const statePath = join(directory, "rooms.json");
  const services = [];
  const open = async () => {
    const service = new DshChatLocalService({}, { path: statePath });
    services.push(service);
    await service.ready;
    return service;
  };
  t.after(async () => {
    await Promise.allSettled(services.map(service => service.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const service = await open();
  const room = await service.createRoom({ name: "Journal fault fixture", autoDeliver: false });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "Earlier durable message", automaticDelivery: false });
  const input = { roomId: room.id, author: "human:me", authorKind: "human", text: "Message with a durable audit obligation",
    automaticDelivery: false, clientOperationId: "journal-operation" };
  return { directory, statePath, service, room, input, open };
}

async function withFs(overrides, operation) {
  const originals = Object.fromEntries(Object.keys(overrides).map(key => [key, fs.promises[key]]));
  try {
    for (const [key, override] of Object.entries(overrides)) fs.promises[key] = override(originals[key]);
    syncBuiltinESMExports();
    return await operation();
  } finally {
    Object.assign(fs.promises, originals);
    syncBuiltinESMExports();
  }
}

function refuseCheckpoint(statePath, seen = () => {}) {
  return original => async (from, to) => {
    if (to === statePath) {
      const candidate = JSON.parse(await readFile(from, "utf8"));
      if (!candidate._journal?.pending.length) { seen(candidate); throw ioError("checkpoint rename interrupted"); }
    }
    return original(from, to);
  };
}

test("replaying an outbox event uses the same JSON value as its first publication", async t => {
  const h = await fixture(t);
  const room = h.service.state.rooms[0];
  h.service.journal.queue(room, () => ({ type: "optional.contract", payload: {
    optional: undefined, nested: { value: undefined }, list: [undefined, { omitted: undefined }] } }), () => true);
  await withFs({ rename: refuseCheckpoint(h.statePath) }, () => h.service.journal.commit(h.service.state));
  const persisted = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.ok(persisted._journal.pending.length > 0);
  const before = await h.service.eventsFor(h.room.id);
  assert.equal(before.filter(event => event.type === "optional.contract").length, 1);
  await h.service.close();
  const restarted = await h.open();
  assert.deepEqual(await restarted.eventsFor(h.room.id), before, "restart must recognize the already published operation without a conflict or duplicate");
  assert.equal(restarted.logHealth().journal.pendingOperations, 0);
});

test("a runtime audit IO failure retains durable obligations and blocks partial memory until restart repairs it", async t => {
  const h = await fixture(t);
  const path = eventLogPath(h.statePath, h.room.id), backup = `${path}.fixture-backup`;
  await rename(path, backup);
  await mkdir(path);
  const message = await h.service.send(h.input);
  const disk = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.ok(disk.rooms[0].messages.some(item => item.id === message.id));
  assert.ok(disk._journal.pending.some(item => item.event?.payload.messageId === message.id));
  assert.equal(disk._journal.checksum, checksum(disk._journal.pending));
  const health = h.service.logHealth();
  assert.ok(health.failed > 0);
  assert.ok(health.journal.pendingOperations > 0);
  assert.match(health.journal.lastError, /audit recovery pending/);
  // Repair the path before reading. A readable but stale log must still be
  // refused because its committed audit is missing, not merely because IO fails.
  await rm(path, { recursive: true });
  await rename(backup, path);
  await assert.rejects(h.service.eventsFor(h.room.id), /committed audit recovery is incomplete/);
  await assert.rejects(h.service.readRoomMemory(h.room.id), /committed audit recovery is incomplete/);
  await h.service.close();
  const restarted = await h.open();
  const events = await restarted.eventsFor(h.room.id);
  assert.equal(events.filter(event => event.type === "message.created" && event.payload.messageId === message.id).length, 1);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  assert.equal(restarted.logHealth().journal.pendingOperations, 0);
  assert.equal(restarted.logHealth().journal.checkpointPending, false);
  const replay = await restarted.send(h.input);
  assert.equal(replay.id, message.id);
  assert.deepEqual(await restarted.eventsFor(h.room.id), events);
});

test("failed checkpoints preserve the latest overlapping state and replay both completed audits exactly once", async t => {
  const h = await fixture(t), reachedAppend = deferred(), releaseAppend = deferred(), secondCommitted = deferred();
  const second = { ...h.input, text: "Second state while first audit is held", clientOperationId: "journal-operation-second" };
  const candidates = [];
  let firstAppend = true, first, later;
  try {
    await withFs({
      appendFile: original => async (...args) => {
        if (args[0] === eventLogPath(h.statePath, h.room.id) && firstAppend) {
          firstAppend = false;
          reachedAppend.resolve();
          await releaseAppend.promise;
        }
        return original(...args);
      },
      rename: original => async (from, to) => {
        if (to !== h.statePath) return original(from, to);
        const candidate = JSON.parse(await readFile(from, "utf8"));
        if (!candidate._journal?.pending.length) {
          candidates.push(candidate);
          throw ioError("checkpoint rename interrupted");
        }
        const result = await original(from, to);
        if (candidate.rooms[0].messages.some(item => item.clientOperationId === second.clientOperationId)) secondCommitted.resolve();
        return result;
      }
    }, async () => {
      first = h.service.send(h.input);
      await reachedAppend.promise;
      later = h.service.send(second);
      await secondCommitted.promise;
      releaseAppend.resolve();
      await Promise.all([first, later]);
    });
  } finally {
    releaseAppend.resolve();
    await Promise.allSettled([first, later]);
  }
  assert.ok(candidates.length > 0, "a real checkpoint rename was refused");
  for (const candidate of candidates) assert.ok(candidate.rooms[0].messages.some(item => item.clientOperationId === second.clientOperationId),
    "checkpoint must use the latest durable state, never the earlier commit's snapshot");
  const disk = JSON.parse(await readFile(h.statePath, "utf8"));
  assert.ok(disk.rooms[0].messages.some(item => item.clientOperationId === second.clientOperationId));
  assert.ok(disk._journal.pending.length > 0);
  assert.equal(h.service.logHealth().journal.pendingOperations, 0);
  assert.equal(h.service.logHealth().journal.checkpointPending, true);
  assert.match(h.service.logHealth().journal.lastError, /audit checkpoint pending/);
  const before = await h.service.eventsFor(h.room.id);
  await h.service.close();
  const restarted = await h.open();
  assert.deepEqual(await restarted.eventsFor(h.room.id), before);
  const memory = await restarted.readRoomMemory(h.room.id);
  for (const input of [h.input, second]) {
    const messages = memory.room.messages.filter(item => item.clientOperationId === input.clientOperationId);
    assert.equal(messages.length, 1);
    assert.equal(memory.events.filter(event => event.payload.messageId === messages[0].id).length, 1);
  }
  assert.equal(restarted.logHealth().journal.checkpointPending, false);
});

for (const corruption of ["checksum", "duplicate-id", "foreign-room", "invalid-replacement"]) {
  test(`startup refuses ${corruption} outbox without changing state or publishing any of its operations`, async t => {
    const h = await fixture(t);
    await h.service.close();
    const state = JSON.parse(await readFile(h.statePath, "utf8"));
    const valid = { id: "valid-first", kind: "append", roomId: h.room.id,
      event: { type: "must.not.publish", payload: {}, provenance: { roomId: h.room.id } } };
    const invalid = structuredClone(valid);
    invalid.id = "invalid-second";
    if (corruption === "duplicate-id") invalid.id = valid.id;
    if (corruption === "foreign-room") invalid.roomId = "room-not-in-state";
    if (corruption === "invalid-replacement") {
      invalid.kind = "replace";
      invalid.events = [{ v: 1, id: "invalid", prev: null, hash: "invalid" }];
      delete invalid.event;
    }
    const pending = [valid, invalid];
    state._journal = { version: 1, pending, checksum: corruption === "checksum" ? "changed" : checksum(pending) };
    const bytes = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(h.statePath, bytes);
    const log = await readFile(eventLogPath(h.statePath, h.room.id));
    await assert.rejects(h.open(), /invalid audit recovery|unsupported.*audit recovery/);
    assert.equal(await readFile(h.statePath, "utf8"), bytes);
    assert.deepEqual(await readFile(eventLogPath(h.statePath, h.room.id)), log);
  });
}

test("state-directory fsync failure remains visible after successful audit publication", async t => {
  const h = await fixture(t);
  let refused = 0;
  await withFs({ open: original => async (...args) => {
    const file = await original(...args);
    if (args[0] === h.directory) {
      file.sync = async () => { refused += 1; throw ioError("directory sync interrupted"); };
    }
    return file;
  } }, () => h.service.send(h.input));
  assert.ok(refused > 0);
  const health = h.service.logHealth();
  assert.equal(health.journal.pendingOperations, 0);
  assert.equal(health.journal.checkpointPending, false);
  assert.equal(health.journal.lastError, null);
  assert.match(health.journal.syncError, /state directory sync: EIO/);
  const events = await h.service.eventsFor(h.room.id);
  assert.ok(events.some(event => event.type === "message.created" && event.payload.clientOperationId === h.input.clientOperationId));
  await h.service.send({ ...h.input, clientOperationId: "after-directory-repair", text: "Later synced state" });
  assert.equal(h.service.logHealth().journal.syncError, null, "a later successful directory sync clears the warning");
});
