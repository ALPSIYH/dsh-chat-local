import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryIndex } from '../lib/agent-memory-index.js';
import { memoryContentHash, boundPersonalRecall } from '../lib/memory-lifecycle.js';
import { DshChatLocalService } from '../lib/room-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const event = (roomId, id, type, payload, at) => ({ id, type, payload, at, tick: at, provenance: { roomId } });
const observation = (roomId, id, text, at = 1, agent = 'alice') => event(roomId, `receipt-${id}`, 'memory.observed', {
  observerAgentId: agent, items: [{ id, text, kind: 'user-message' }] }, at);
const control = (source, id, action, at, roomId = 'room', evidenceId = 'e') => event(source, id, 'memory.control', {
  observerAgentId: 'alice', sourceRoomId: roomId, evidenceId, action, contentHash: memoryContentHash('SECRET controlled source') }, at);
const install = (index, roomId, events, revision = 1) => index.syncSource(roomId, { events, revision });
const recall = (index, options = {}) => index.recall({ agentId: 'alice', sourceRoomIds: ['room', 'policy'], now: 1000, decay: false, ...options });

test('independent: fixed observation snapshot cannot bypass suppression stored in another source', () => {
  const index = new AgentMemoryIndex(), history = [observation('room', 'e', 'SECRET controlled source')];
  try {
    install(index, 'room', history);
    install(index, 'policy', [control('policy', 'suppress', 'suppress', 2)]);
    assert.equal(recall(index).experiences.length, 0);
    let result;
    try { result = recall(index, { sourceOverrides: [{ roomId: 'room', events: history }] }); }
    catch (error) { assert.match(error.message, /policy|snapshot|complete index/); return; }
    assert.doesNotMatch(JSON.stringify(result), /SECRET controlled source/, 'snapshot isolation must preserve currently authorized cross-source suppression');
  } finally { index.close(); }
});

test('independent: unavailable suppression source cannot be bypassed through observation-only snapshot', () => {
  const index = new AgentMemoryIndex(), history = [observation('room', 'e', 'SECRET controlled source')];
  try {
    install(index, 'room', history);
    install(index, 'policy', [control('policy', 'suppress', 'suppress', 2)]);
    index.dropSource('policy');
    assert.equal(recall(index).experiences.length, 0);
    let result;
    try { result = recall(index, { sourceOverrides: [{ roomId: 'room', events: history }] }); }
    catch (error) { assert.match(error.message, /policy|snapshot|complete index/); return; }
    assert.doesNotMatch(JSON.stringify(result), /SECRET controlled source/, 'unknown current suppression policy must fail closed in both ordinary and snapshot recall');
  } finally { index.close(); }
});

test('independent: cache eviction releases empty agent containers instead of retaining unbounded identities', () => {
  const index = new AgentMemoryIndex({ maxIndexBytes: 4096, maxAgentIndexBytes: 4096 });
  try {
    for (let n = 0; n < 100; n++) {
      install(index, `source-${n}`, [observation(`source-${n}`, `e-${n}`, 'small cache record', 1, `person-${n}`)]);
      index.flush();
    }
    const stats = index.stats();
    assert.ok(stats.accountedBytes <= 4096);
    assert.ok(stats.agents <= stats.leaves + stats.sources, `empty identity containers leaked across eviction: ${JSON.stringify(stats)}`);
  } finally { index.close(); }
});

test('independent: belief referencing a suppressed observation stays unavailable even with a frozen source', () => {
  const index = new AgentMemoryIndex(), history = [observation('room', 'e', 'SECRET controlled source')];
  try {
    install(index, 'room', history);
    install(index, 'policy', [event('policy', 'belief-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'b', claim: 'derived SECRET conclusion',
      evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('SECRET controlled source') }] }, 2), control('policy', 'suppress', 'suppress', 3)]);
    assert.equal(recall(index).beliefs.length, 0);
    let result;
    try { result = recall(index, { sourceOverrides: [{ roomId: 'room', events: history }] }); }
    catch (error) { assert.match(error.message, /policy|snapshot|complete index/); return; }
    assert.equal(result.beliefs.length, 0);
  } finally { index.close(); }
});

test('independent: byte and item omissions are exposed without inflating available result counts', () => {
  const result = boundPersonalRecall({ coverage: { partial: false }, totals: { experiences: 3 } },
    [1, 2, 3].map(n => ({ kind: 'observation', evidenceId: `${n}`, text: `fact-${n}` })), { limit: 1, maxBytes: 1024 });
  assert.equal(result.experiences.length, 1);
  assert.equal(result.coverage.omittedByBudget, 2);
  assert.equal(result.coverage.returnedItems, 1);
  assert.equal(result.coverage.serializedBytes, Buffer.byteLength(JSON.stringify(result)));
});

test('independent: observing unchanged evidence again does not silently invalidate a supported belief', () => {
  const index = new AgentMemoryIndex(), first = observation('room', 'e', 'stable basis', 1);
  try {
    install(index, 'room', [first]);
    install(index, 'policy', [event('policy', 'belief-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'b', claim: 'supported conclusion',
      evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('stable basis'), observationId: first.id }] }, 2)]);
    assert.equal(recall(index).beliefs.length, 1);
    const reread = { ...observation('room', 'e', 'stable basis', 3), id: 'reread-receipt' };
    index.syncSource('room', { events: [reread], revision: 2, baseRevision: 1, appendOnly: true });
    assert.equal(recall(index).beliefs.length, 1, 'the original receipt still exists; an unchanged re-observation is not a reset or source invalidation');
    assert.equal(index.belief({ agentId: 'alice', beliefId: 'b', sourceRoomIds: ['room', 'policy'] }).validEvidence, true);
  } finally { index.close(); }
});

test('independent: replacement source lacking original observation receipt invalidates a belief even with equal text', () => {
  const index = new AgentMemoryIndex(), first = observation('room', 'e', 'stable basis', 1);
  try {
    install(index, 'room', [first]);
    install(index, 'policy', [event('policy', 'belief-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'b', claim: 'unsupported after replacement',
      evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('stable basis'), observationId: first.id }] }, 2)]);
    assert.equal(recall(index).beliefs.length, 1);
    install(index, 'room', [{ ...observation('room', 'e', 'stable basis', 1), id: 'different-receipt' }], 2);
    assert.equal(recall(index).beliefs.length, 0);
  } finally { index.close(); }
});

test('independent: service response must retain index omissions when applying the final serialized-byte cap', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-independent-index-'));
  const ctx = { agents: { get: () => ({ cancel() {} }) }, dshBridge: { status: async () => ({ state: 'idle' }) }, get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, 'rooms.json') });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const person = await service.directory.save({ profile: { alias: 'Audited person' }, operationId: 'independent-create' });
  await service.createRoom({ name: 'index', autoDeliver: false, members: [{ kind: 'session', sessionId: 'person-session', agentId: person.id, alias: 'Person' }] });
  for (let n = 0; n < 3; n++) await service.observeSessionEvent('person-session', { type: 'user/message', data: { id: `input-${n}`, content: [{ type: 'text', text: `different observed fact ${n}` }] } });
  const result = await service.agentMemory('person-session', { limit: 1 });
  assert.equal(result.totals.experiences, 3);
  assert.equal(result.experiences.length, 1);
  assert.equal(result.coverage.omittedByBudget, 2, 'second bound pass must not reset omissions already applied by index');
});
