import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DshChatLocalService } from '../lib/room-store.js';
import { eventLogPath } from '../lib/event-log.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-adversarial-memory-'));
  let deliveryReady, turn = 0;
  const ctx = { agents: { get: () => ({ cancel() {} }) }, dshBridge: {
    status: async () => ({ state: 'idle' }), deliverExternal: async (from, to, text, delivery) => {
      deliveryReady?.resolve({ from, to, text, delivery });
    } } };
  const service = new DshChatLocalService(ctx, { path: join(directory, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 30000 });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const alice = await service.directory.save({ operationId: 'alice', profile: { alias: 'Alice' } });
  const bob = await service.directory.save({ operationId: 'bob', profile: { alias: 'Bob' } });
  const room = await service.createRoom({ name: 'Personal authority', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 's', alias: 'Alice', agentId: alice.id }] });
  const send = text => service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text, automaticDelivery: false });
  const activate = async text => {
    deliveryReady = deferred();
    const sent = await service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text, mentions: ['s'] });
    const call = await deliveryReady.promise;
    await service.observeSessionEvent('s', { type: 'turn/start', data: { turn: ++turn } });
    await service.observeSessionEvent('s', { type: 'user/message', data: { content: [{ type: 'text',
      text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
    return sent;
  };
  return { service, room, alice, bob, directory, send, activate };
}

function holdRead(service, roomId, method = 'readEvents') {
  const entered = deferred(), release = deferred(), original = service.journal[method].bind(service.journal);
  let armed = true;
  service.journal[method] = async (id, ...options) => {
    const events = await original(id, ...options);
    if (id === roomId && armed) { armed = false; entered.resolve(); await release.promise; }
    return events;
  };
  return { entered: entered.promise, release: release.resolve, restore() { service.journal[method] = original; } };
}

test('a recall suspended after reading an old log cannot return discarded memory after a completed restore', async t => {
  const h = await fixture(t);
  const snapshot = JSON.parse((await h.service.snapshotRun(h.room.id, 'fixture')).content);
  await h.send('memory discarded by the restore');
  await h.service.roomMemory(h.room.id, 's');
  const held = holdRead(h.service, h.room.id, 'readEventView');
  const recalling = h.service.agentMemory('s', { roomId: h.room.id });
  recalling.catch(() => {});
  try {
    await held.entered;
    await h.service.restoreFromSnapshot(snapshot, { confirm: true });
    held.release();
    await assert.rejects(recalling, /changed|restored|superseded/);
  } finally { held.release(); held.restore(); await Promise.allSettled([recalling]); }
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('s', { roomId: h.room.id })), /memory discarded by the restore/);
});

test('a recall cannot complete after its service closes while a source read is suspended', async t => {
  const h = await fixture(t);
  await h.send('private work before shutdown');
  await h.service.roomMemory(h.room.id, 's');
  const held = holdRead(h.service, h.room.id, 'readEventView');
  const recalling = h.service.agentMemory('s', { roomId: h.room.id });
  recalling.catch(() => {});
  let closing, closed = false;
  try {
    await held.entered;
    closing = h.service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.service.closed, true, 'shutdown invalidates read authority immediately');
    assert.equal(closed, false, 'shutdown waits for the suspended memory refresh to settle');
    held.release();
    await assert.rejects(recalling, /closed|changed|superseded/);
    await closing;
  } finally { held.release(); held.restore(); await Promise.allSettled([recalling, closing]); }
});

for (const transition of ['close', 'reassign']) test(`an identity read suspended at persona IO refuses stale authority after ${transition}`, async t => {
  const h = await fixture(t);
  const entered = deferred(), release = deferred(), original = h.service.personas.read.bind(h.service.personas);
  let armed = true;
  h.service.personas.read = async agent => {
    const result = await original(agent);
    if (armed && agent.id === h.alice.id) { armed = false; entered.resolve(); await release.promise; }
    return result;
  };
  const reading = h.service.agentIdentity('s', h.room.id);
  reading.catch(() => {});
  try {
    await entered.promise;
    if (transition === 'close') await h.service.close();
    else {
      await h.service.removeMember(h.room.id, 's');
      await h.service.addMember(h.room.id, { kind: 'session', sessionId: 's', alias: 'Bob', agentId: h.bob.id });
    }
    release.resolve();
    await assert.rejects(reading, /closed|identity changed|changed|superseded/i);
  } finally { release.resolve(); h.service.personas.read = original; await Promise.allSettled([reading]); }
});

for (const transition of ['close', 'reassign']) test(`an observation waiting before journal registration is refused after ${transition}`, async t => {
  const h = await fixture(t);
  await h.send('material pending observation');
  const entered = deferred(), release = deferred(), original = h.service.journal.appendChecked.bind(h.service.journal);
  let armed = true;
  h.service.journal.appendChecked = async (room, event, validate) => {
    if (armed && event.type === 'memory.observed') { armed = false; entered.resolve(); await release.promise; }
    return original(room, event, validate);
  };
  const reading = h.service.roomMemory(h.room.id, 's');
  reading.catch(() => {});
  try {
    await entered.promise;
    if (transition === 'close') await h.service.close();
    else {
      await h.service.removeMember(h.room.id, 's');
      await h.service.addMember(h.room.id, { kind: 'session', sessionId: 's', alias: 'Bob', agentId: h.bob.id });
    }
    const path = eventLogPath(h.service.path, h.room.id), before = await readFile(path);
    release.resolve();
    await assert.rejects(reading, /closed|identity changed|changed|superseded/i);
    assert.deepEqual(await readFile(path), before, 'the rejected observation must not append a stale receipt');
  } finally { release.resolve(); h.service.journal.appendChecked = original; await Promise.allSettled([reading]); }
});

test('late native observations after close cannot write private history into a disposed service', async t => {
  const h = await fixture(t);
  await h.service.close();
  const before = h.service.eventLog.health().appended;
  await h.service.observeSessionEvent('s', { type: 'user/message', data: { content: [{ type: 'text', text: 'late private native observation' }] } });
  assert.equal(h.service.eventLog.health().appended, before);
});

test('a disposed observer cannot cancel a native session when an old marker callback arrives', async t => {
  const h = await fixture(t);
  let cancelled = 0;
  h.service.ctx.agents.get = () => ({ cancel() { cancelled++; } });
  await h.service.close();
  await h.service.observeSessionEvent('s', { type: 'user/message', data: { content: [{ type: 'text',
    text: `[dsh-bridge dsh-chat-local-room message obsolete from room:${h.room.id}]` }] } });
  assert.equal(cancelled, 0);
  assert.equal(h.service.policyLocks.size, 0);
});

test('an appraisal from a superseded turn cannot borrow the next turn authority after its evidence read resumes', async t => {
  const h = await fixture(t);
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'target', alias: 'Bob', agentId: h.bob.id });
  const evidence = await h.activate('first participant turn evidence');
  const held = holdRead(h.service, h.room.id);
  const writing = h.service.appraise(h.room.id, 's', { aboutAgentId: 'target', stance: 'trust', confidence: .8,
    claim: 'statement belonging only to the superseded turn', evidenceEventIds: [evidence.id] });
  writing.catch(() => {});
  try {
    await held.entered;
    await h.service.stopRoom(h.room.id);
    await h.activate('fresh participant turn');
    held.release();
    await assert.rejects(writing, /changed|superseded|active|turn/i);
    assert.ok(!(await h.service.eventsFor(h.room.id)).some(event => event.type === 'appraisal'
      && event.payload.claim === 'statement belonging only to the superseded turn'));
  } finally { held.release(); held.restore(); await Promise.allSettled([writing]); }
});

test('a suspended revocation cannot borrow a later participant turn authority', async t => {
  const h = await fixture(t);
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'target', alias: 'Bob', agentId: h.bob.id });
  const evidence = await h.activate('initial appraisal evidence');
  const appraisal = await h.service.appraise(h.room.id, 's', { aboutAgentId: 'target', stance: 'trust', confidence: .8,
    claim: 'valid original statement', evidenceEventIds: [evidence.id] });
  await h.service.stopRoom(h.room.id);
  await h.activate('turn requesting revocation');
  const held = holdRead(h.service, h.room.id);
  const revoking = h.service.appraise(h.room.id, 's', { action: 'revoke', aboutAgentId: 'target', appraisalId: appraisal.appraisalId });
  revoking.catch(() => {});
  try {
    await held.entered;
    await h.service.stopRoom(h.room.id);
    await h.activate('successor turn');
    held.release();
    await assert.rejects(revoking, /changed|superseded|active|turn/i);
    assert.ok(!(await h.service.eventsFor(h.room.id)).some(event => event.payload.revokesAppraisalId === appraisal.appraisalId));
  } finally { held.release(); held.restore(); await Promise.allSettled([revoking]); }
});

test('a private relationship read cannot borrow a successor identity after Session reassignment', async t => {
  const h = await fixture(t);
  const carol = await h.service.directory.save({ operationId: 'carol', profile: { alias: 'Carol' } });
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'target', alias: 'Bob', agentId: h.bob.id });
  const evidence = await h.activate('Alice evidence');
  await h.service.appraise(h.room.id, 's', { aboutAgentId: 'target', stance: 'trust', confidence: .8,
    claim: 'PRIVATE_ALICE_JUDGEMENT', evidenceEventIds: [evidence.id] });
  await h.service.stopRoom(h.room.id);
  await h.service.removeMember(h.room.id, 's');
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 's', alias: 'Carol', agentId: carol.id });
  const held = holdRead(h.service, h.room.id);
  const reading = h.service.relationshipRow(h.room.id, 's');
  reading.catch(() => {});
  try {
    await held.entered;
    await h.service.removeMember(h.room.id, 's');
    await h.service.addMember(h.room.id, { kind: 'session', sessionId: 's', alias: 'Alice', agentId: h.alice.id });
    held.release();
    const outcome = await reading.then(value => ({ value }), error => ({ error }));
    t.diagnostic(JSON.stringify({ priorIdentity: carol.id, activeIdentity: h.alice.id,
      leakedSuccessorJudgement: JSON.stringify(outcome.value ?? {}).includes('PRIVATE_ALICE_JUDGEMENT') }));
    assert.ok(outcome.error, 'a private read must reject a changed identity instead of returning its successor appraisal');
    assert.match(outcome.error.message, /changed|superseded|identity/i);
  } finally { held.release(); held.restore(); await Promise.allSettled([reading]); }
});

test('seeded real-service reads and clears match an independent per-person visibility oracle', async t => {
  const h = await fixture(t);
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'b1', alias: 'Bob', agentId: h.bob.id });
  const second = await h.service.createRoom({ name: 'Second work context', autoDeliver: false, members: [
    { kind: 'session', sessionId: 'a2', alias: 'Alice', agentId: h.alice.id },
    { kind: 'session', sessionId: 'b2', alias: 'Bob', agentId: h.bob.id }
  ] });
  const rooms = [h.room.id, second.id], sessions = [['s', 'b1'], ['a2', 'b2']];
  const messages = [[], []], observed = [[new Set(), new Set()], [new Set(), new Set()]];
  let seed = 0x5eed;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
  const send = async (room, index) => {
    const message = await h.service.send({ roomId: rooms[room], author: 'human:me', authorKind: 'human',
      text: `private oracle source ${room}/${index}`, automaticDelivery: false });
    messages[room].push(message.id);
  };
  for (let room = 0; room < 2; room++) await send(room, 'seed');
  for (let step = 0; step < 16; step++) {
    const room = Math.floor(random() * 2), person = Math.floor(random() * 2);
    if (step % 4 === 0) await send(room, step);
    else if (step % 4 === 2) {
      await h.service.relationshipIntervention(rooms[room], { action: 'clear', appliedBy: 'human', mechanism: 'oracle-reset', memoryScope: 'all' });
      for (let who = 0; who < 2; who++) observed[room][who].clear();
    } else {
      await h.service.roomMemory(rooms[room], sessions[room][person]);
      for (const id of messages[room]) observed[room][person].add(id);
    }
    for (let who = 0; who < 2; who++) {
      const memory = await h.service.agentMemory(sessions[0][who], { limit: 100 });
      const actual = memory.experiences.filter(item => item.kind === 'message').map(item => item.messageId).sort();
      const expected = [...new Set([...observed[0][who], ...observed[1][who]])].sort();
      assert.deepEqual(actual, expected, `seed 0x5eed step ${step} person ${who}`);
    }
  }
});
