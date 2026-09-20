import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, createEvent, eventLogPath, eventLogHeadPath, verifyChain } from "../lib/event-log.js";
import { RoomJournal } from "../lib/room-journal.js";
import { DshChatLocalService } from "../lib/room-store.js";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }; }

for (const seed of [1, 42, 0x5eed]) test(`seed ${seed}: mixed concurrent log reads, appends and replacements match a serial reference`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-seeded-journal-"));
  const log = new EventLog(join(directory, "rooms.json"));
  const random = rng(seed), expected = new Map(), pending = [];
  try {
    for (let step = 0; step < 180; step += 1) {
      const room = `r${Math.floor(random() * 3)}`, operation = random();
      const state = expected.get(room) ?? [];
      if (operation < .56) {
        const id = `append-${seed}-${step}`;
        expected.set(room, [...state, id]);
        pending.push(log.append(room, { type: id, payload: { step }, provenance: { roomId: room } }).then(event => assert.ok(event)));
      } else if (operation < .77) {
        const id = `restore-${seed}-${step}`;
        const events = random() < .3 ? [] : [createEvent({ type: id, at: step + 1, provenance: { roomId: room } })];
        expected.set(room, events.map(event => event.type));
        pending.push(log.replace(room, events));
      } else {
        const captured = [...state];
        pending.push(log.read(room).then(events => {
          assert.deepEqual(events.map(event => event.type), captured);
          assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
        }));
      }
    }
    await Promise.all(pending);
    await log.drain();
    const restarted = new EventLog(join(directory, "rooms.json"));
    for (const [room, state] of expected) {
      const events = await restarted.read(room);
      assert.deepEqual(events.map(event => event.type), state);
      assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
      const appended = await restarted.append(room, { type: "after-restart" });
      assert.ok(appended);
      assert.equal(appended.prev, events.at(-1)?.hash ?? null);
    }
    assert.equal(log.health().failed, 0);
  } finally { await Promise.allSettled(pending); await rm(directory, { recursive: true, force: true }); }
});

test("a successful queued save inherits audit obligations from a failed predecessor, including after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-audit-recovery-"));
  const path = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path });
  const original = fs.promises.rename, reached = deferred(), held = deferred();
  let first, second, reopened, injected = false;
  try {
    await service.ready;
    const room = await service.createRoom({ name: "Audit recovery", autoDeliver: false });
    fs.promises.rename = async (...args) => {
      if (args[1] === path && !injected) { injected = true; reached.resolve(); await held.promise; throw Object.assign(new Error("injected state rename failure"), { code: "EIO" }); }
      return original(...args);
    };
    syncBuiltinESMExports();
    first = service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit", expectedRevision: 1, gate: true });
    first.catch(() => {});
    await reached.promise;
    second = service.setRoomDetails(room.id, { name: "Saved despite earlier failure", expectedRevision: service.state.rooms[0].revision });
    await new Promise(resolve => setImmediate(resolve));
    held.resolve();
    await assert.rejects(first, /injected state rename failure/);
    await second;
    const snapshot = JSON.parse((await service.snapshotRun(room.id, "fixture")).content);
    const notice = snapshot.room.messages.find(message => message.authorKind === "system");
    assert.ok(notice, "the successful later state write contains the policy notice");
    assert.equal(snapshot.events.filter(event => event.type === "message.created" && event.payload.messageId === notice.id).length, 1,
      "the durable notice must have exactly one audit even if its original save failed");
    assert.equal(service.journal.pendingAudits.length, 0);
    await service.close();
    reopened = new DshChatLocalService({}, { path });
    await reopened.ready;
    assert.ok((await reopened.eventsFor(room.id)).some(event => event.payload.messageId === notice.id));
  } finally {
    held.resolve(); fs.promises.rename = original; syncBuiltinESMExports();
    await Promise.allSettled([first, second]); await service.close(); await reopened?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an actual anchor filesystem failure is visible and a repaired restart preserves the durable line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-anchor-failure-restart-"));
  const path = join(directory, "rooms.json"), log = new EventLog(path);
  try {
    await log.append("room", { type: "before" });
    const anchor = eventLogHeadPath(path, "room");
    await rm(anchor); await mkdir(anchor);
    assert.equal(await log.append("room", { type: "line-with-failed-anchor" }), null);
    assert.equal(log.health().failed, 1);
    await assert.rejects(log.read("room"), /not a regular file/);
    await rm(anchor, { recursive: true });
    const reopened = new EventLog(path);
    const appended = await reopened.append("room", { type: "after-repair" });
    assert.ok(appended);
    const events = await reopened.read("room");
    assert.deepEqual(events.map(event => event.type), ["before", "after-repair"]);
    assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
    assert.equal(await readFile(anchor, "utf8"), appended.hash);
  } finally { await log.drain(); await rm(directory, { recursive: true, force: true }); }
});


test("a send blocked by another room audit cannot publish into a completed restore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-send-restore-journal-"));
  const service = new DshChatLocalService({}, { path: join(directory, "rooms.json") });
  const rename = fs.promises.rename, appendFile = fs.promises.appendFile;
  const reached = deferred(), release = deferred();
  let sending;
  try {
    await service.ready;
    const a = await service.createRoom({ name: "Restored room", autoDeliver: false });
    const b = await service.createRoom({ name: "Unrelated room", autoDeliver: false });
    const snapshot = JSON.parse((await service.snapshotRun(a.id, "fixture")).content);
    fs.promises.rename = async (...args) => {
      if (args[1] === service.path) throw Object.assign(new Error("injected save failure"), { code: "EIO" });
      return rename(...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(service.setRoomPolicy(b.id, { defaultActionMode: "read_only_audit", expectedRevision: 1, gate: true }), /injected/);
    fs.promises.rename = rename;
    fs.promises.appendFile = async (...args) => {
      if (args[0] === eventLogPath(service.path, b.id)) { reached.resolve(); await release.promise; }
      return appendFile(...args);
    };
    syncBuiltinESMExports();
    sending = service.send({ roomId: a.id, author: "human:me", authorKind: "human", text: "Discarded history" });
    sending.catch(() => {});
    await reached.promise;
    await service.restoreFromSnapshot(snapshot, { confirm: true });
    release.resolve();
    await assert.rejects(sending, /superseded|restored/);
    const restored = JSON.parse((await service.snapshotRun(a.id, "fixture")).content);
    assert.deepEqual(restored.room.messages, snapshot.room.messages);
    assert.deepEqual(restored.events, snapshot.events);
    assert.equal(service.pendingSends.size, 0, "a restored-away send must not stay available for retry");
  } finally {
    release.resolve(); fs.promises.rename = rename; fs.promises.appendFile = appendFile; syncBuiltinESMExports();
    await Promise.allSettled([sending]); await service.close(); await rm(directory, { recursive: true, force: true });
  }
});


test("overlapping successful and failed state commits publish each durable audit exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-commit-batch-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const room = { id: "room", tick: 0, messages: [] }, state = { rooms: [room] };
  const journal = new RoomJournal({ path, events, currentRoom: id => id === room.id ? room : undefined });
  const rename = fs.promises.rename;
  let writes = 0;
  const pending = [];
  try {
    fs.promises.rename = async (...args) => {
      if (args[1] === path && ++writes % 4 === 1) throw Object.assign(new Error("batch state write failure"), { code: "EIO" });
      return rename(...args);
    };
    syncBuiltinESMExports();
    for (let index = 0; index < 24; index += 1) {
      const message = { id: `m-${index}`, text: `message ${index}` };
      room.messages.push(message);
      journal.queue(room, () => ({ type: "message.created", payload: { messageId: message.id } }),
        () => room.messages.includes(message));
      const saving = journal.commit(state);
      saving.catch(() => {});
      pending.push(saving);
    }
    const results = await Promise.allSettled(pending);
    assert.equal(results.filter(result => result.status === "rejected").length, 6);
    const snapshot = await journal.readRoomMemory(room.id);
    assert.deepEqual(snapshot.room.messages.map(message => message.id), snapshot.events.map(event => event.payload.messageId));
    assert.equal(new Set(snapshot.events.map(event => event.payload.messageId)).size, 24);
    assert.equal(journal.pendingAudits.length, 0);
    assert.deepEqual(verifyChain(snapshot.events), { ok: true, brokenAt: null });
  } finally {
    fs.promises.rename = rename; syncBuiltinESMExports(); await Promise.allSettled(pending);
    await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});

test("a later snapshot cannot cancel an earlier committed delivery audit while its flush is blocked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eligible-claims-"));
  const path = join(directory, "rooms.json"), events = new EventLog(path);
  const roomA = { id: "a", tick: 0, delivery: "sent" }, roomB = { id: "b", tick: 0 };
  const state = { rooms: [roomA, roomB] };
  const journal = new RoomJournal({ path, events, currentRoom: id => state.rooms.find(room => room.id === id) });
  const appendFile = fs.promises.appendFile, reached = deferred(), release = deferred();
  let first, second;
  try {
    fs.promises.appendFile = async (...args) => {
      if (args[0] === eventLogPath(path, roomB.id)) { reached.resolve(); await release.promise; }
      return appendFile(...args);
    };
    syncBuiltinESMExports();
    journal.queue(roomB, () => ({ type: "blocking" }), () => true);
    journal.queue(roomA, () => ({ type: "delivery.sent" }), () => true, () => roomA.delivery === "sent");
    first = journal.commit(state);
    await reached.promise;
    roomA.delivery = "delivered";
    journal.queue(roomA, () => ({ type: "delivery.delivered" }), () => true);
    second = journal.commit(state);
    await second;
    release.resolve();
    await first;
    const snapshot = await journal.readRoomMemory(roomA.id);
    assert.equal(snapshot.events.filter(event => event.type === "delivery.sent").length, 1,
      "the earlier committed sent state is an audit fact even after later state changes");
    assert.equal(snapshot.events.filter(event => event.type === "delivery.delivered").length, 1);
    assert.deepEqual(snapshot.events.map(event => event.type), ["delivery.sent", "delivery.delivered"],
      "the helper flush publishes the earlier durable transition before the later one");
  } finally {
    release.resolve(); fs.promises.appendFile = appendFile; syncBuiltinESMExports();
    await Promise.allSettled([first, second]); await journal.settled(); await rm(directory, { recursive: true, force: true });
  }
});
