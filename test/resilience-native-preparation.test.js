import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshChatLocalService } from '../lib/room-store.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function fixture(t, { phase = 'permission', attached = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-prepare-live-')), path = join(directory, 'rooms.json');
  const entered = deferred(), release = deferred(), calls = [];
  let flushes = 0;
  const wait = async () => { entered.resolve(); await release.promise; };
  const agent = { status: 'idle', session: { async flush() { flushes++; if (flushes === (attached || phase === 'model' ? 1 : 2)) await wait(); } } };
  const ctx = {
    get(name) { return this[name]; }, agents: { get: () => agent },
    llm: { async resolveCallConfig(selection) { if (phase === 'resolve') await wait(); return selection; } },
    permissionPresets: { resolve: preset => ({ sandbox: preset, approval: 'ask' }), current: session => session.preset ?? 'read-only', set(session, preset) { calls.push('permission'); session.preset = preset; } },
    sessionController: { async create({ sessionId }) { calls.push('create'); return { sessionId }; }, async resolveAgent() { return { agent }; }, async rename() { calls.push('rename'); }, agents: { selectForNextRequest() { calls.push('model'); } } },
    dshBridge: { status: async () => ({ state: 'idle' }), async deliverExternal() { calls.push('dispatch'); } }
  };
  const service = new DshChatLocalService(ctx, { path, maxRounds: 1 });
  await service.ready;
  const member = { kind: 'session', sessionId: 'member', alias: 'member', ...(attached
    ? { ownership: 'attached', nativePermissionSync: { mode: 'workspace_write', state: 'pending' } }
    : { ownership: 'provisioned', nativeSetup: { state: 'pending', config: { cwd: directory, model: { provider: 'p', model: 'm' } } } }) };
  const room = await service.createRoom({ name: 'preparation lifecycle', autoDeliver: false, members: [member] });
  if (attached) await service.setRoomPolicy(room.id, { defaultActionMode: 'workspace_write', expectedRevision: room.policy.revision, confirmRisk: true });
  t.after(async () => { release.resolve(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { service, path, room, entered, release, calls, preparation: () => service.prepareMember(room.id, 'member'), pending: () => service.state.rooms[0].members[0][attached ? 'nativePermissionSync' : 'nativeSetup'].state };
}

for (const attached of [false, true]) {
  for (const action of ['close', 'restore']) {
    test(`${attached ? 'attached permission' : 'provisioned permission'} flush cannot publish ready after ${action}`, async t => {
      const h = await fixture(t, { attached }), snapshot = action === 'restore' ? JSON.parse((await h.service.snapshotRun(h.room.id, 'preparation-test')).content) : null;
      const preparing = h.preparation(), outcome = preparing.then(value => ({ value }), error => ({ error }));
      await h.entered.promise;
      if (action === 'close') await h.service.close();
      else await h.service.restoreFromSnapshot(snapshot, { confirm: true });
      const before = await readFile(h.path), calls = [...h.calls];
      h.release.resolve();
      const result = await outcome;
      assert.ok(result.error, 'superseded preparation must reject its acknowledgement');
      assert.equal(h.pending(), 'pending');
      assert.deepEqual(await readFile(h.path), before, 'late continuation must not rewrite rooms.json');
      assert.deepEqual(h.calls, calls, 'late continuation must not invoke another native side effect');
    });
  }
}

for (const phase of ['model', 'resolve']) {
  test(`closing during native ${phase} preparation prevents later native side effects`, async t => {
    const h = await fixture(t, { phase }), preparing = h.preparation();
    const outcome = preparing.then(value => ({ value }), error => ({ error }));
    await h.entered.promise; await h.service.close();
    const calls = [...h.calls], before = await readFile(h.path);
    h.release.resolve();
    assert.ok((await outcome).error);
    assert.deepEqual(h.calls, calls, 'closed preparation must not create, rename or reconfigure a Session');
    assert.equal(h.pending(), 'pending');
    assert.deepEqual(await readFile(h.path), before);
  });
}
