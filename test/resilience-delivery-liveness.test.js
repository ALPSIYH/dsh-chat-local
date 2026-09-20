import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { DshChatLocalService } from '../lib/room-store.js';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
async function until(predicate, label, milliseconds = 3000) {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) { if (predicate()) return; await immediate(); }
  assert.fail(label);
}
async function fixture(t, deliverExternal = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-delivery-live-'));
  const calls = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) }, dshBridge: { status: async () => ({ state: 'idle' }),
    deliverExternal: async (...args) => { calls.push(args); return deliverExternal(...args); } }, get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 250 });
  await service.ready;
  const room = await service.createRoom({ name: 'delivery lifecycle', autoDeliver: false, members: [{ kind: 'session', sessionId: 'member', alias: 'member' }] });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { service, room, calls, send: () => service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: 'bounded collaboration', mentions: ['member'] }) };
}

test('time spent preparing a Session does not consume its not-yet-started reply timeout', async t => {
  const h = await fixture(t), preparing = deferred(), release = deferred();
  const original = h.service.prepareMember.bind(h.service);
  h.service.prepareMember = async (...args) => { preparing.resolve(); await release.promise; return original(...args); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.send(); await preparing.promise;
  try {
    t.mock.timers.tick(251);
    const capture = [...h.service.pending.values()][0];
    assert.ok(capture, 'preparation must still have an active delivery intent');
    assert.equal(capture.delivery.status, 'queued');
    assert.equal(h.calls.length, 0);
  } finally { release.resolve(); await h.service.close(); }
});

test('durable prompt logging does not consume the recipient reply budget', async t => {
  const h = await fixture(t), logging = deferred(), release = deferred();
  const append = h.service.eventLog.append.bind(h.service.eventLog);
  h.service.eventLog.append = async (roomId, event, operationId) => {
    if (event.type === 'injection.cost') { logging.resolve(); await release.promise; }
    return append(roomId, event, operationId);
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.send(); await logging.promise;
  try {
    t.mock.timers.tick(251);
    const capture = [...h.service.pending.values()][0];
    assert.ok(capture, 'logging must not time out a recipient who has not been sent a prompt');
    assert.equal(capture.delivery.status, 'queued');
    assert.equal(h.calls.length, 0);
  } finally { release.resolve(); await h.service.close(); }
});

test('closing while prompt logging is pending never dispatches that prompt afterward', async t => {
  const h = await fixture(t), logging = deferred(), release = deferred();
  const append = h.service.eventLog.append.bind(h.service.eventLog);
  h.service.eventLog.append = async (roomId, event, operationId) => {
    if (event.type === 'injection.cost') { logging.resolve(); await release.promise; }
    return append(roomId, event, operationId);
  };
  await h.send(); await logging.promise;
  const closing = h.service.close();
  release.resolve();
  await closing;
  assert.equal(h.calls.length, 0, 'closed service must revalidate after its last asynchronous preparation step');
});

test('a reply timeout releases the run and shutdown even when bridge transport never resolves', async t => {
  const entered = deferred(), release = deferred();
  const h = await fixture(t, async () => { entered.resolve(); return release.promise; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.send(); await entered.promise;
  t.mock.timers.tick(251);
  const closing = h.service.close();
  let closed = false; void closing.then(() => { closed = true; });
  try { await until(() => closed, 'close remains trapped behind a timed-out unresolved bridge transport'); }
  finally { release.resolve(); await closing; }
  assert.equal(h.calls.length, 1);
  assert.equal(h.service.pending.size, 0);
});

test('shutdown does not depend on an unresolved external Session preparation promise', async t => {
  const h = await fixture(t), preparing = deferred(), release = deferred();
  const prepare = h.service.prepareMember.bind(h.service);
  h.service.prepareMember = async (...args) => { preparing.resolve(); await release.promise; return prepare(...args); };
  await h.send(); await preparing.promise;
  const closing = h.service.close();
  let closed = false; void closing.then(() => { closed = true; });
  try { await until(() => closed, 'close remains trapped behind unresolved Session preparation'); }
  finally { release.resolve(); await closing; }
  assert.equal(h.calls.length, 0);
});

test('shutdown releases an unresolved model lookup and its late resource is still disposed', async t => {
  const h = await fixture(t), querying = deferred(), release = deferred();
  let disposed = false;
  h.service.ctx.sessionQuery = { observeSession: async () => { querying.resolve(); return release.promise; } };
  await h.send(); await querying.promise;
  const closing = h.service.close();
  let closed = false; void closing.then(() => { closed = true; });
  try { await until(() => closed, 'close remains trapped behind a model configuration lookup'); }
  finally {
    release.resolve({ header: { cwd: tmpdir() }, projections: { values: { modelSelection: { next: { provider: 'p', model: 'm' } } } }, [Symbol.dispose]() { disposed = true; } });
    await closing;
  }
  await until(() => disposed, 'late model cut was not disposed');
  assert.equal(h.calls.length, 0);
});

test('a completed native reply releases a transport whose acknowledgement never arrives', async t => {
  const entered = deferred(), release = deferred();
  const h = await fixture(t, async () => { entered.resolve(); return release.promise; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.send(); await entered.promise;
  const [from, to, , delivery] = h.calls[0];
  try {
    await h.service.observeSessionEvent(to, { type: 'turn/start', data: { turn: 1 } });
    await h.service.observeSessionEvent(to, { type: 'user/message', data: { content: [{ type: 'text', text: `[dsh-bridge dsh-chat-local-room message ${delivery.id} from ${from}]` }] } });
    await h.service.observeSessionEvent(to, { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '(pass)' }] } } });
    await h.service.observeSessionEvent(to, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await until(() => h.service.activeRuns.size === 0, 'completed reply did not release the scheduler');
    assert.equal(h.service.state.rooms[0].messages[0].deliveries[0].status, 'passed');
  } finally { release.resolve(); await h.service.close(); }
});

test('a late rejected transport cannot reopen or overwrite an already timed-out delivery', async t => {
  const entered = deferred(), release = deferred();
  const h = await fixture(t, async () => { entered.resolve(); return release.promise; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.send(); await entered.promise;
  t.mock.timers.tick(251);
  await h.service.close();
  const delivery = h.service.state.rooms[0].messages[0].deliveries[0];
  const before = structuredClone(delivery);
  release.reject(new Error('late transport rejection after shutdown'));
  await immediate(); await immediate();
  assert.deepEqual(delivery, before);
  assert.equal(delivery.status, 'failed');
  assert.match(delivery.error, /timed out/);
  assert.equal(h.service.pending.size, 0);
});

test('a preparation failure releases its capture even when persisting failure also fails', async t => {
  const h = await fixture(t), rename = fs.promises.rename;
  let prepared = false, fail = false, diskFailure = false;
  h.service.prepareMember = async () => { prepared = true; fail = true; throw new Error('native preparation failed'); };
  fs.promises.rename = async (...args) => {
    if (args[1] === h.service.path && fail) { fail = false; diskFailure = true; throw Object.assign(new Error('state save EIO'), { code: 'EIO' }); }
    return rename(...args);
  };
  syncBuiltinESMExports();
  try {
    await h.send();
    await until(() => prepared && h.service.activeRuns.size === 0, 'failed preparation did not release its run');
    assert.equal(diskFailure, true);
    assert.equal(h.service.pending.size, 0, 'no timer exists yet to clean up a failed preparation');
    assert.match(h.service.state.rooms[0].orchestration.error, /state save EIO/);
  } finally { fs.promises.rename = rename; syncBuiltinESMExports(); }
});
