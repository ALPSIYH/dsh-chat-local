import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshChatLocalService } from '../lib/room-store.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-model-adversarial-')), path = join(directory, 'rooms.json');
  let nativeModel = { provider: 'p', model: 'initial' };
  const calls = [], agent = { status: 'idle', session: { async flush() {} } };
  const ctx = { get(name) { return this[name]; }, agents: { get: () => agent },
    llm: { resolveCallConfig: async selection => selection },
    permissionPresets: { resolve: preset => ({ sandbox: preset, approval: preset === 'danger-full-access' ? 'never' : 'ask' }), current: session => session.preset ?? 'read-only', set(session, preset) { session.preset = preset; } },
    sessionController: { create: async ({ sessionId }) => ({ sessionId }), resolveAgent: async () => ({ agent }),
      agents: { selectForNextRequest(_agent, selection) { calls.push(selection.model); nativeModel = structuredClone(selection); } } },
    dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async () => {} } };
  const service = new DshChatLocalService(ctx, { path }); await service.ready;
  const room = await service.createRoom({ name: 'model lifecycle', autoDeliver: false, members: [{ kind: 'session', sessionId: 'member', alias: 'Member', ownership: 'provisioned', nativeSetup: { state: 'ready', config: { cwd: directory, model: nativeModel } } }] });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { service, room, path, ctx, agent, calls, get nativeModel() { return nativeModel; }, select: model => service.selectMemberModel(room.id, 'member', { provider: 'p', model }) };
}

for (const transition of ['restore', 'stop', 'close', 'rebind']) test(`model selection cannot resume after ${transition} while model resolution was pending`, async t => {
  const h = await fixture(t), reached = deferred(), release = deferred();
  const snapshot = JSON.parse((await h.service.snapshotRun(h.room.id, 'lifecycle')).content);
  h.ctx.llm.resolveCallConfig = async selection => { reached.resolve(); await release.promise; return selection; };
  const operation = h.select('obsolete'), outcome = operation.then(value => ({ value }), error => ({ error }));
  try {
    await reached.promise;
    if (transition === 'restore') await h.service.restoreFromSnapshot(snapshot, { confirm: true });
    if (transition === 'stop') await h.service.stopRoom(h.room.id);
    if (transition === 'close') await h.service.close();
    if (transition === 'rebind') {
      await h.service.removeMember(h.room.id, 'member');
      await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'member', alias: 'Another person' });
    }
    const bytes = await readFile(h.path);
    release.resolve();
    assert.ok((await outcome).error, 'obsolete configuration request must reject');
    assert.deepEqual(h.calls, [], 'a completed lifecycle transition must invalidate old native side effects');
    assert.deepEqual(await readFile(h.path), bytes);
  } finally { release.resolve(); await outcome; }
});

test('shared Session preparation must finish each room\'s own pending permission sync', async t => {
  const h = await fixture(t), reached = deferred(), release = deferred();
  const rooms = [];
  for (const mode of ['workspace_write', 'full_access']) {
    const room = await h.service.createRoom({ name: mode, autoDeliver: false, members: [{ kind: 'session', sessionId: 'shared', alias: 'Shared', ownership: 'attached', nativePermissionSync: { mode, state: 'pending' } }] });
    await h.service.setRoomPolicy(room.id, { defaultActionMode: mode, expectedRevision: room.policy.revision, confirmRisk: true });
    rooms.push(room);
  }
  let first = true;
  h.agent.session.flush = async () => { if (first) { first = false; reached.resolve(); await release.promise; } };
  const preparation = h.service.prepareMember(rooms[0].id, 'shared');
  await reached.promise;
  const overlapping = h.service.prepareMember(rooms[1].id, 'shared');
  release.resolve();
  const [one, two] = await Promise.all([preparation, overlapping]);
  assert.equal(one.nativePermissionSync.state, 'ready');
  assert.equal(two.nativePermissionSync.state, 'ready', 'another room\'s completed work does not complete this room\'s pending setup');
  assert.equal(h.agent.session.preset, 'danger-full-access');
});

test('overlapping model selections cannot leave stored configuration different from the native selection', async t => {
  const h = await fixture(t), reached = deferred(), release = deferred();
  let first = true;
  h.agent.session.flush = async () => { if (first) { first = false; reached.resolve(); await release.promise; } };
  const firstOperation = h.select('first'), firstOutcome = firstOperation.then(value => ({ value }), error => ({ error }));
  await reached.promise;
  const secondOperation = h.select('second'), secondOutcome = secondOperation.then(value => ({ value }), error => ({ error }));
  try {
    const second = await secondOutcome;
    assert.ok(second.error, 'a second configuration edit must conflict while the first native flush is pending');
    assert.equal(second.error.status, 409);
  } finally { release.resolve(); }
  const outcomes = await Promise.all([firstOutcome, secondOutcome]);
  assert.ok(outcomes.some(result => result.value));
  assert.equal(h.service.state.rooms[0].members[0].nativeSetup.config.model.model, h.nativeModel.model);
  assert.equal(JSON.parse(await readFile(h.path)).rooms[0].members[0].nativeSetup.config.model.model, h.nativeModel.model);
  await h.select('second');
  assert.equal(h.nativeModel.model, 'second', 'completed selection must release the conflict guard for retry');
  assert.equal(h.service.state.rooms[0].members[0].nativeSetup.config.model.model, 'second');
});
