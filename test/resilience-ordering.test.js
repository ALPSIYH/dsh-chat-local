import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, eventLogPath, verifyChain } from "../lib/event-log.js";
import { RoomJournal } from "../lib/room-journal.js";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("reading during a healthy multi-event publication waits for its committed facts without waiting for future state writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-publication-read-"));
  const events = new EventLog(join(directory, "rooms.json"));
  const room = { id: "room" }, journal = new RoomJournal({ path: join(directory, "rooms.json"), events, currentRoom: () => room });
  const entered = deferred(), release = deferred(), append = events.appendOnce.bind(events);
  let saving, reading;
  try {
    events.appendOnce = async (id, event, operation) => {
      if (event.type === "B") { entered.resolve(); await release.promise; }
      return append(id, event, operation);
    };
    for (const type of ["A", "B"]) journal.queue(room, () => ({ type }), () => true);
    saving = journal.commit({ rooms: [room] });
    await entered.promise;
    let finished = false;
    reading = journal.readEvents(room.id).then(value => { finished = true; return value; });
    reading.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    release.resolve();
    assert.deepEqual((await reading).map(event => event.type), ["A", "B"]);
    await saving;
  } finally {
    release.resolve(); await Promise.allSettled([saving, reading]);
    await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});

test("a later committed fact cannot overtake an in-flight predecessor that fails before its intent is published", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-recovery-order-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const room = { id: "room", messages: [] }, state = { rooms: [room] };
  const journal = new RoomJournal({ path, events, currentRoom: id => id === room.id ? room : undefined });
  const rename = fs.promises.rename, reached = deferred(), release = deferred();
  let fail = true, first, second;
  try {
    fs.promises.rename = async (...args) => {
      if (args[1] === `${eventLogPath(path, room.id)}.pending` && fail) {
        reached.resolve(); await release.promise;
        throw Object.assign(new Error("predecessor intent publication unavailable"), { code: "EIO" });
      }
      return rename(...args);
    };
    syncBuiltinESMExports();
    room.messages.push("A");
    journal.queue(room, () => ({ type: "A", payload: { messageId: "A" } }), () => true);
    first = journal.commit(state);
    await reached.promise;
    room.messages.push("B");
    journal.queue(room, () => ({ type: "B", payload: { messageId: "B" } }), () => true);
    second = journal.commit(state);
    await journal.writeTail;
    await new Promise(resolve => setImmediate(resolve));
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(await events.read(room.id), [], "B cannot pass A while A has no durable log event");
    assert.equal(journal.health().pendingOperations, 2);
    fail = false;
    await journal.commit(state);
    const published = await events.read(room.id);
    assert.deepEqual(published.map(event => event.type), ["A", "B"]);
    assert.equal(new Set(published.map(event => event.provenance.operationId)).size, 2);
    assert.deepEqual(verifyChain(published), { ok: true, brokenAt: null });
    assert.equal(journal.health().pendingOperations, 0);
    await journal.commit(state);
    assert.deepEqual(await events.read(room.id), published, "another checkpoint cannot duplicate either fact");
  } finally {
    release.resolve(); fs.promises.rename = rename; syncBuiltinESMExports();
    await Promise.allSettled([first, second]); await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});

test("a direct observation cannot bypass an older committed outbox fact awaiting storage repair", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-observation-order-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const room = { id: "room", messages: ["A"] }, state = { rooms: [room] };
  const journal = new RoomJournal({ path, events, currentRoom: id => id === room.id ? room : undefined });
  const rename = fs.promises.rename;
  let fail = true;
  try {
    fs.promises.rename = async (...args) => {
      if (args[1] === `${eventLogPath(path, room.id)}.pending` && fail) {
        const intent = JSON.parse(await fs.promises.readFile(args[0], "utf8"));
        if (intent.event?.type === "A") throw Object.assign(new Error("older fact cannot yet be written"), { code: "EIO" });
      }
      return rename(...args);
    };
    syncBuiltinESMExports();
    journal.queue(room, () => ({ type: "A", payload: { messageId: "A" } }), () => true);
    await journal.commit(state);
    assert.equal(journal.health().pendingOperations, 1);
    await journal.record(room, { type: "B", payload: { messageId: "B" } }).catch(() => null);
    assert.deepEqual(await events.read(room.id), [], "direct B must not be published before the pending A");
    fail = false;
    await journal.commit(state);
    let published = await events.read(room.id);
    if (!published.some(event => event.type === "B")) {
      await journal.record(room, { type: "B", payload: { messageId: "B" } });
      published = await events.read(room.id);
    }
    assert.deepEqual(published.map(event => event.type), ["A", "B"]);
    assert.deepEqual(verifyChain(published), { ok: true, brokenAt: null });
  } finally {
    fs.promises.rename = rename; syncBuiltinESMExports(); await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});

test("a renamed state exposes its committed obligations before directory sync returns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-rename-publication-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const room = { id: "room", messages: ["A"] }, journal = new RoomJournal({ path, events, currentRoom: () => room });
  const reachedSync = deferred(), releaseSync = deferred(), releaseAppend = deferred();
  const open = fs.promises.open, append = events.appendOnce.bind(events);
  let firstSync = true, appendStarted = false, saving, reading, direct;
  try {
    fs.promises.open = async (...args) => {
      const file = await open(...args);
      if (args[0] === directory && firstSync) {
        firstSync = false;
        const sync = file.sync.bind(file);
        file.sync = async () => { reachedSync.resolve(); await releaseSync.promise; return sync(); };
      }
      return file;
    };
    syncBuiltinESMExports();
    events.appendOnce = async (...args) => {
      if (args[1].type === "A") { appendStarted = true; await releaseAppend.promise; }
      return append(...args);
    };
    journal.queue(room, () => ({ type: "A" }), () => true);
    saving = journal.commit({ rooms: [room] });
    await reachedSync.promise;
    const disk = JSON.parse(await fs.promises.readFile(path, "utf8"));
    assert.equal(disk._journal.pending.length, 1);
    assert.equal(journal.health().pendingOperations, 1, "the renamed document is already authoritative, including its outbox");
    let readFinished = false, directFinished = false;
    reading = journal.readEvents(room.id).then(value => { readFinished = true; return value; });
    direct = journal.record(room, { type: "B" }).then(value => { directFinished = true; return value; });
    reading.catch(() => {}); direct.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readFinished, false, "read cannot acknowledge a history missing committed A");
    assert.equal(directFinished, false, "B cannot pass the committed A");
    assert.equal(appendStarted, false, "event publication must wait for the state's directory durability boundary");
    releaseAppend.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(appendStarted, false);
    assert.equal(readFinished, false);
    assert.equal(directFinished, false);
    releaseSync.resolve();
    const deadline = performance.now() + 3000;
    while (!(readFinished && directFinished) && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.ok(readFinished && directFinished, "read and direct publication must complete when state durability and event publication finish");
    assert.equal((await reading)[0].type, "A");
    assert.equal((await direct).type, "B");
    assert.deepEqual((await events.read(room.id)).map(event => event.type), ["A", "B"]);
    await saving;
  } finally {
    releaseAppend.resolve(); releaseSync.resolve(); fs.promises.open = open; syncBuiltinESMExports();
    await Promise.allSettled([saving, reading, direct]); await journal.settled();
    await rm(directory, { recursive: true, force: true });
  }
});
