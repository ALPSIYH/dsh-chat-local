import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, eventLogPath, verifyChain } from "../lib/event-log.js";
import { RoomJournal } from "../lib/room-journal.js";
import { DshChatLocalService } from "../lib/room-store.js";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function randomFor(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }; }
// The fallback reproduces the pre-fix caller, which installed each room before
// asking the journal to replace its log. The new entry point owns that staging.
const stagedRestore = (journal, operation) => journal.runRestore ? journal.runRestore(operation) : operation();

test("a later state snapshot cannot inherit a failed restore without its matching log replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-restore-inheritance-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const oldRoom = { id: "restored", facts: ["old"] }, other = { id: "other", facts: [] }, state = { rooms: [oldRoom, other] };
  const journal = new RoomJournal({ path, events, currentRoom: id => state.rooms.find(room => room.id === id) });
  journal.queue(oldRoom, () => ({ type: "old" }), () => true);
  await journal.commit(state);
  const reached = deferred(), release = deferred(), rename = fs.promises.rename;
  let firstRename = true, restoring, saving;
  try {
    fs.promises.rename = async (...args) => {
      if (args[1] === path && firstRename) {
        firstRename = false; reached.resolve(); await release.promise;
        throw Object.assign(new Error("restore state rename interrupted"), { code: "EIO" });
      }
      return rename(...args);
    };
    syncBuiltinESMExports();
    const restored = { id: oldRoom.id, facts: [] };
    state.rooms[0] = restored;
    restoring = journal.restore(restored, [], state, { rollback: () => { state.rooms[0] = oldRoom; } });
    restoring.catch(() => {});
    await reached.promise;
    other.facts.push("new-other");
    journal.queue(other, () => ({ type: "new-other" }), () => true);
    saving = journal.commit(state);
    release.resolve();
    await assert.rejects(restoring, /restore state rename interrupted/);
    await saving;
    const committed = JSON.parse(await readFile(path, "utf8"));
    const actual = (await events.read(oldRoom.id)).map(event => event.type);
    assert.deepEqual(actual, committed.rooms[0].facts,
      "every successful state snapshot must publish the replacement needed by the room version it contains");
    assert.deepEqual(committed.rooms, state.rooms, "rollback must agree with the room version saved by the later commit");
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled([restoring, saving]); await journal.settled();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const seed of [17, 101, 0x5eed]) test(`seed ${seed}: committed room facts survive overlapping writes, IO refusal, restore and cold recovery`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-adversarial-state-model-"));
  const path = join(directory, "rooms.json"), random = randomFor(seed), rename = fs.promises.rename;
  let state = { rooms: Array.from({ length: 3 }, (_, index) => ({ id: `room-${index}`, facts: [] })) };
  let events, journal, failedRenames = 0;
  const reopen = () => {
    events = new EventLog(path);
    journal = new RoomJournal({ path, events, currentRoom: id => state.rooms.find(room => room.id === id) });
  };
  const check = async () => {
    const disk = JSON.parse(await readFile(path, "utf8"));
    for (const room of disk.rooms) {
      const actual = await journal.readEvents(room.id);
      assert.deepEqual(actual.map(event => event.type), room.facts, `seed ${seed}, room ${room.id}: log must exactly match facts from committed state`);
      assert.equal(new Set(actual.map(event => event.id)).size, actual.length);
      assert.deepEqual(verifyChain(actual), { ok: true, brokenAt: null });
    }
  };
  reopen();
  try {
    await journal.commit(state);
    for (let batch = 0; batch < 12; batch++) {
      const mode = batch % 4, failIndex = Math.floor(random() * 3);
      let stateWrites = 0;
      fs.promises.rename = async (...args) => {
        const stateTarget = args[1] === path;
        if (stateTarget && mode === 1 && stateWrites++ === failIndex
          || mode === 2 && state.rooms.some(room => args[1] === `${eventLogPath(path, room.id)}.pending`)) {
          failedRenames++;
          throw Object.assign(new Error("seeded filesystem refusal"), { code: "EIO" });
        }
        return rename(...args);
      };
      syncBuiltinESMExports();
      const writes = [];
      for (let offset = 0; offset < 3; offset++) {
        const room = state.rooms[Math.floor(random() * state.rooms.length)], fact = `fact-${seed}-${batch}-${offset}`;
        room.facts.push(fact);
        journal.queue(room, () => ({ type: fact }), () => room.facts.includes(fact));
        writes.push(journal.commit(state));
      }
      await Promise.allSettled(writes);
      await journal.settled();
      fs.promises.rename = rename; syncBuiltinESMExports();
      // A cold restart discards failed in-memory mutations and recovers only
      // the obligations serialized with the latest successful state snapshot.
      state = JSON.parse(await readFile(path, "utf8"));
      reopen();
      await events.recoverAll(); await journal.recover(state);
      await check();
      if (mode === 3) {
        const index = Math.floor(random() * state.rooms.length), old = state.rooms[index];
        const history = await events.read(old.id), keep = Math.floor(random() * (history.length + 1));
        state.rooms[index] = { id: old.id, facts: old.facts.slice(0, keep) };
        await journal.restore(state.rooms[index], history.slice(0, keep), state, { rollback: () => { state.rooms[index] = old; } });
        await check();
      }
    }
    assert.ok(failedRenames > 0, "the seeded run must exercise real refused filesystem renames");
  } finally {
    fs.promises.rename = rename; syncBuiltinESMExports();
    await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});

test("a restore of another room cannot commit the speculative state of a failed predecessor restore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-two-restore-inheritance-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const oldA = { id: "a", facts: ["old-a"] }, oldB = { id: "b", facts: ["old-b"] }, state = { rooms: [oldA, oldB] };
  const journal = new RoomJournal({ path, events, currentRoom: id => state.rooms.find(room => room.id === id) });
  for (const room of state.rooms) journal.queue(room, () => ({ type: room.facts[0] }), () => true);
  await journal.commit(state);
  const reached = deferred(), release = deferred(), rename = fs.promises.rename;
  let firstRename = true, restoreA, restoreB;
  try {
    fs.promises.rename = async (...args) => {
      if (args[1] === path && firstRename) {
        firstRename = false; reached.resolve(); await release.promise;
        throw Object.assign(new Error("first restore state rename interrupted"), { code: "EIO" });
      }
      return rename(...args);
    };
    syncBuiltinESMExports();
    restoreA = stagedRestore(journal, () => {
      state.rooms[0] = { id: "a", facts: [] };
      return journal.restore(state.rooms[0], [], state, { rollback: () => { state.rooms[0] = oldA; } });
    });
    restoreA.catch(() => {});
    await reached.promise;
    restoreB = stagedRestore(journal, () => {
      state.rooms[1] = { id: "b", facts: [] };
      return journal.restore(state.rooms[1], [], state, { rollback: () => { state.rooms[1] = oldB; } });
    });
    release.resolve();
    await assert.rejects(restoreA, /first restore state rename interrupted/);
    await restoreB;
    const committed = JSON.parse(await readFile(path, "utf8"));
    for (const room of committed.rooms) assert.deepEqual((await events.read(room.id)).map(event => event.type), room.facts);
    assert.deepEqual(committed.rooms, state.rooms, "rollback must agree with the room version saved by the later restore");
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled([restoreA, restoreB]); await journal.settled();
    await rm(directory, { recursive: true, force: true });
  }
});

test("three staged restores and interleaved saves cannot publish a failed successor's speculative room", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-three-restore-inheritance-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const state = { rooms: ["a", "b", "c", "other"].map(id => ({ id, facts: [`old-${id}`] })) };
  const journal = new RoomJournal({ path, events, currentRoom: id => state.rooms.find(room => room.id === id) });
  for (const room of state.rooms) journal.queue(room, () => ({ type: room.facts[0] }), () => true);
  await journal.commit(state);
  const reached = deferred(), release = deferred(), rename = fs.promises.rename, operations = [], committedSnapshots = [];
  let held = false;
  const restore = index => stagedRestore(journal, () => {
    const previous = state.rooms[index], restored = { id: previous.id, facts: [] };
    state.rooms[index] = restored;
    return journal.restore(restored, [], state, { rollback: () => { state.rooms[index] = previous; } });
  });
  try {
    fs.promises.rename = async (...args) => {
      let document;
      if (args[1] === path) {
        document = JSON.parse(await readFile(args[0], "utf8"));
        if (document._journal?.pending.some(operation => operation.kind === "replace" && operation.roomId === "a") && !held) {
          held = true; reached.resolve(); await release.promise;
        }
        if (document._journal?.pending.some(operation => operation.kind === "replace" && operation.roomId === "c")) {
          throw Object.assign(new Error("last restore state rename interrupted"), { code: "EIO" });
        }
      }
      const result = await rename(...args);
      if (document) committedSnapshots.push(document);
      return result;
    };
    syncBuiltinESMExports();
    operations.push(restore(0)); await reached.promise;
    operations.push(restore(1));
    const other = state.rooms[3];
    other.facts.push("first-overlap");
    journal.queue(other, () => ({ type: "first-overlap" }), () => true);
    operations.push(journal.commit(state));
    const restoreC = restore(2); restoreC.catch(() => {}); operations.push(restoreC);
    other.facts.push("second-overlap");
    journal.queue(other, () => ({ type: "second-overlap" }), () => true);
    operations.push(journal.commit(state));
    release.resolve();
    const outcomes = await Promise.allSettled(operations);
    assert.deepEqual(outcomes.map(item => item.status), ["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled"]);
    for (const document of committedSnapshots) assert.deepEqual(document.rooms[2].facts, ["old-c"],
      "even an intermediate durable snapshot must not contain the never-committed successor restore");
    const committed = JSON.parse(await readFile(path, "utf8"));
    for (const room of committed.rooms) assert.deepEqual((await events.read(room.id)).map(event => event.type), room.facts);
    assert.deepEqual(committed.rooms, state.rooms, "a failed queued restore must leave no speculative room in another successful state snapshot");
    assert.deepEqual(state.rooms[3].facts, ["old-other", "first-overlap", "second-overlap"]);
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled(operations); await journal.settled();
    await rm(directory, { recursive: true, force: true });
  }
});

test("public restores stage one room at a time and a failed queued restore stays consistent after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-public-restore-staging-")), path = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path }), snapshots = [], messages = [], operations = [];
  const reached = deferred(), release = deferred(), queued = deferred(), rename = fs.promises.rename;
  const committedSnapshots = [];
  let restarted, first = true, requests = 0;
  try {
    await service.ready;
    for (const name of ["a", "b", "c"]) {
      const room = await service.createRoom({ name, autoDeliver: false });
      snapshots.push(JSON.parse((await service.snapshotRun(room.id, "restore-staging")).content));
      messages.push(await service.send({ roomId: room.id, author: "human:fixture", authorKind: "human", text: `old-${name}`, automaticDelivery: false }));
    }
    const ids = snapshots.map(snapshot => snapshot.room.id), stage = service.journal.runRestore.bind(service.journal);
    service.journal.runRestore = operation => { const result = stage(operation); if (++requests === 3) queued.resolve(); return result; };
    fs.promises.rename = async (...args) => {
      let document;
      if (args[1] === path) {
        document = JSON.parse(await readFile(args[0], "utf8"));
        if (document._journal?.pending.some(operation => operation.kind === "replace" && operation.roomId === ids[0]) && first) {
          first = false; reached.resolve(); await release.promise;
        }
        if (document._journal?.pending.some(operation => operation.kind === "replace" && operation.roomId === ids[2])) {
          throw Object.assign(new Error("third public restore rename interrupted"), { code: "EIO" });
        }
      }
      const result = await rename(...args);
      if (document) committedSnapshots.push(document);
      return result;
    };
    syncBuiltinESMExports();
    operations.push(service.restoreFromSnapshot(snapshots[0], { confirm: true }));
    await reached.promise;
    operations.push(service.restoreFromSnapshot(snapshots[1], { confirm: true }));
    const last = service.restoreFromSnapshot(snapshots[2], { confirm: true }); last.catch(() => {}); operations.push(last);
    await queued.promise;
    assert.ok(service.state.rooms.find(room => room.id === ids[1]).messages.some(message => message.id === messages[1].id));
    assert.ok(service.state.rooms.find(room => room.id === ids[2]).messages.some(message => message.id === messages[2].id));
    release.resolve();
    assert.deepEqual((await Promise.allSettled(operations)).map(item => item.status), ["fulfilled", "fulfilled", "rejected"]);
    for (const document of committedSnapshots) assert.ok(document.rooms.find(room => room.id === ids[2]).messages.some(message => message.id === messages[2].id));
    fs.promises.rename = rename; syncBuiltinESMExports();
    await service.close();
    restarted = new DshChatLocalService({}, { path }); await restarted.ready;
    for (let index = 0; index < 3; index++) {
      const memory = await restarted.readRoomMemory(ids[index]);
      const stateContains = memory.room.messages.some(message => message.id === messages[index].id);
      const logContains = memory.events.some(event => event.type === "message.created" && event.payload.messageId === messages[index].id);
      assert.equal(stateContains, index === 2);
      assert.equal(logContains, stateContains);
      assert.deepEqual(verifyChain(memory.events), { ok: true, brokenAt: null });
    }
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled(operations); await service.close(); await restarted?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing drains an already-staged restore but rejects queued restores before they install state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-close-queued-restore-")), path = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path }), snapshots = [], messages = [], operations = [];
  const reached = deferred(), release = deferred(), queued = deferred(), rename = fs.promises.rename;
  let first = true, requests = 0, closing;
  try {
    await service.ready;
    for (const name of ["a", "b"]) {
      const room = await service.createRoom({ name, autoDeliver: false });
      snapshots.push(JSON.parse((await service.snapshotRun(room.id, "close-staging")).content));
      messages.push(await service.send({ roomId: room.id, author: "human:fixture", authorKind: "human", text: `old-${name}`, automaticDelivery: false }));
    }
    const stage = service.journal.runRestore.bind(service.journal);
    service.journal.runRestore = operation => { const result = stage(operation); if (++requests === 2) queued.resolve(); return result; };
    fs.promises.rename = async (...args) => {
      if (args[1] === path && first) { first = false; reached.resolve(); await release.promise; }
      return rename(...args);
    };
    syncBuiltinESMExports();
    operations.push(service.restoreFromSnapshot(snapshots[0], { confirm: true }));
    await reached.promise;
    const second = service.restoreFromSnapshot(snapshots[1], { confirm: true }); second.catch(() => {}); operations.push(second);
    await queued.promise;
    closing = service.close();
    release.resolve();
    const outcomes = await Promise.allSettled(operations);
    await closing;
    assert.equal(outcomes[0].status, "fulfilled", "already staged state/log replacement is drained to completion");
    assert.equal(outcomes[1].status, "rejected", "queued restore cannot install state after shutdown begins");
    assert.match(String(outcomes[1].reason), /closed|关闭/);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.ok(disk.rooms.find(room => room.id === snapshots[1].room.id).messages.some(message => message.id === messages[1].id));
    await assert.rejects(service.restoreFromSnapshot(snapshots[1], { confirm: true }), /closed|关闭/);
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled([...operations, closing]); await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing during restore backup prevents the unstaged room from being installed afterward", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-close-restore-backup-")), path = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path }), reached = deferred(), release = deferred(), writeFile = fs.promises.writeFile;
  let restoring, closing, closed = false;
  try {
    await service.ready;
    const room = await service.createRoom({ name: "backup", autoDeliver: false });
    const snapshot = JSON.parse((await service.snapshotRun(room.id, "close-backup")).content);
    await service.send({ roomId: room.id, author: "human:fixture", authorKind: "human", text: "must remain", automaticDelivery: false });
    fs.promises.writeFile = async (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith(`${path}.pre-restore.bak.`) && args[0].endsWith(".tmp")) {
        reached.resolve(); await release.promise;
      }
      return writeFile(...args);
    };
    syncBuiltinESMExports();
    restoring = service.restoreFromSnapshot(snapshot, { confirm: true }); restoring.catch(() => {});
    await reached.promise;
    closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.closed, true, "shutdown invalidates the unstaged restore immediately");
    assert.equal(closed, false, "shutdown drains the quota-protected backup write before returning");
    const before = await readFile(path);
    release.resolve();
    await assert.rejects(restoring, /closed|关闭/);
    await closing;
    assert.deepEqual(await readFile(path), before);
  } finally {
    release.resolve(); fs.promises.writeFile = writeFile; syncBuiltinESMExports();
    await Promise.allSettled([restoring, closing]); await service.close(); await rm(directory, { recursive: true, force: true });
  }
});
