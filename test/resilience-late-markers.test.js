import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DshChatLocalService } from '../lib/room-store.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const marker = (deliveryId, roomId) => `[dsh-bridge dsh-chat-local-room message ${deliveryId} from room:${roomId}]`;
const message = text => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } });
const execution = { name: 'bash', agent: { session: { id: 's' } } };

async function fixture(t, { holdTransport = false, cancelThrows = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-late-marker-'));
  const reached = deferred(), release = deferred(), cancellations = [];
  let delivered;
  const ctx = { agents: { get: () => ({ cancel(reason) { cancellations.push(reason); if (cancelThrows) throw new Error('cancel unavailable'); } }) },
    dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async (from, to, text, delivery) => {
      delivered = { from, to, text, delivery }; reached.resolve(delivered); if (holdTransport) await release.promise;
    } } };
  const service = new DshChatLocalService(ctx, { path: join(directory, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 30000 });
  t.after(async () => { release.resolve(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const room = await service.createRoom({ name: 'Marker authority', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 's', alias: 'Member' }] });
  const dispatch = async () => {
    await service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: 'group request', mentions: ['s'] });
    return reached.promise;
  };
  return { service, room, dispatch, cancellations, release };
}

test('a transport marker arriving after restore erased its delivery cannot run tools or publish a reply', async t => {
  const h = await fixture(t, { holdTransport: true });
  const snapshot = JSON.parse((await h.service.snapshotRun(h.room.id, 'fixture')).content);
  const call = await h.dispatch();
  await h.service.restoreFromSnapshot(snapshot, { confirm: true });
  assert.ok(!h.service.state.rooms[0].messages.some(item => item.deliveries.some(delivery => delivery.id === call.delivery.id)));
  await h.service.observeSessionEvent('s', { type: 'turn/start', data: { turn: 99 } });
  await h.service.observeSessionEvent('s', message(marker(call.delivery.id, h.room.id)));
  assert.match(h.service.guardToolExecution(execution) ?? '', /失效|超时/);
  assert.equal(h.cancellations.length, 1);
  await assert.rejects(h.service.send({ roomId: h.room.id, author: 's', authorKind: 'session', text: 'obsolete reply' }), /失效/);
  assert.deepEqual(await h.service.eventsFor(h.room.id), snapshot.events, 'the obsolete marker must not manufacture a fresh delivery receipt');
  await h.service.observeSessionEvent('s', { type: 'turn/end', data: { turn: 99 } });
  await h.service.observeSessionEvent('s', { type: 'turn/start', data: { turn: 100 } });
  assert.equal(h.service.guardToolExecution(execution), undefined, 'a later unrelated native turn is unrestricted');
});

test('an unknown own-plugin marker is denied without a tracked turn even if cancellation fails', async t => {
  const h = await fixture(t, { cancelThrows: true });
  await h.service.observeSessionEvent('s', message(marker('unknown-delivery', 'unknown-room')));
  assert.equal(h.service.policyLocks.get('s')?.active, true);
  assert.equal(h.service.policyLocks.get('s')?.stale, true);
  assert.match(h.service.guardToolExecution(execution) ?? '', /失效|超时/);
  assert.equal(h.cancellations.length, 1);
  await h.service.observeSessionEvent('s', { type: 'turn/end', data: {} });
  assert.equal(h.service.guardToolExecution(execution), undefined);
});

test('a current delivery id with a mismatched room is denied and a later marker cannot relax that turn', async t => {
  const h = await fixture(t);
  await h.service.setRoomPolicy(h.room.id, { defaultActionMode: 'inherit_dsh', expectedRevision: 1, confirmRisk: true });
  const call = await h.dispatch();
  await h.service.observeSessionEvent('s', { type: 'turn/start', data: { turn: 1 } });
  await h.service.observeSessionEvent('s', message(marker(call.delivery.id, 'different-room')));
  assert.match(h.service.guardToolExecution(execution) ?? '', /失效|超时/);
  assert.ok(!(await h.service.eventsFor(h.room.id)).some(event => event.type === 'memory.observed' && event.payload.deliveryId === call.delivery.id));
  await h.service.observeSessionEvent('s', message(marker(call.delivery.id, h.room.id)));
  assert.match(h.service.guardToolExecution(execution) ?? '', /失效|超时/, 'a restrictive marker decision lasts for the whole turn');
});

test('ordinary native text and another plugin marker do not acquire a group policy lock', async t => {
  const h = await fixture(t);
  await h.service.observeSessionEvent('s', { type: 'turn/start', data: { turn: 1 } });
  for (const text of ['ordinary native instruction', '[dsh-bridge other-plugin message unknown from room:other]']) {
    await h.service.observeSessionEvent('s', message(text));
    assert.equal(h.service.guardToolExecution(execution), undefined);
    assert.equal(h.service.policyLocks.has('s'), false);
  }
  assert.equal(h.cancellations.length, 0);
});

test('one message cannot hide an unknown marker behind an authenticated permissive marker', async t => {
  const h = await fixture(t);
  await h.service.setRoomPolicy(h.room.id, { defaultActionMode: 'inherit_dsh', expectedRevision: 1, confirmRisk: true });
  const call = await h.dispatch();
  await h.service.observeSessionEvent('s', { type: 'turn/start', data: { turn: 1 } });
  await h.service.observeSessionEvent('s', message(`${marker(call.delivery.id, h.room.id)}\n${marker('unknown', 'missing')}`));
  assert.match(h.service.guardToolExecution(execution) ?? '', /失效|超时/);
  assert.equal(h.cancellations.length, 1);
});
