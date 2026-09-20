import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshChatLocalService } from '../lib/room-store.js';
import { AgentMemoryIndex } from '../lib/agent-memory-index.js';
import { memoryContentHash, normalizeMemoryLifecycle, MEMORY_LIFECYCLE_VERSION } from '../lib/memory-lifecycle.js';

async function fixture(t, maxRecallBytes = 65536) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-retrieval-priority-'));
  const context = { agents: { get: () => ({ cancel() {} }) }, dshBridge: { status: async () => ({ state: 'idle' }) }, get(name) { return this[name]; } };
  const service = new DshChatLocalService(context, { path: join(directory, 'rooms.json'), memoryLifecycle: { decay: false, maxRecallBytes } });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const person = await service.directory.save({ profile: { alias: 'Retrieval auditor' }, operationId: 'create' });
  await service.createRoom({ name: 'Observed workspace', autoDeliver: false, members: [{ kind: 'session', sessionId: 'reader', agentId: person.id, alias: 'Reader' }] });
  const observe = (type, id, text) => service.observeSessionEvent('reader', { type, data: { id, message: { id, content: [{ type: 'text', text }] } } });
  return { service, observe };
}

test('retrieval: equal lexical relevance retains observed source ahead of later self-authored repetition', async t => {
  const { service, observe } = await fixture(t);
  await observe('tool/result', 'original-instrument', 'Kestrel pressureLimit = 37; pressure limit confirmed by instrument.');
  await observe('assistant/message', 'later-paraphrase', 'Kestrel pressureLimit remains 37; pressure limit was in my earlier plan.');
  const memory = await service.agentMemory('reader', { query: 'Kestrel pressureLimit', limit: 1 });
  assert.equal(memory.experiences.length, 1);
  assert.match(memory.experiences[0].evidenceId, /original-instrument/, JSON.stringify(memory.experiences.map(x => ({ kind: x.kind, id: x.evidenceId }))));
});

test('retrieval: a small byte budget cannot become only the agents own repeated answers while an equally relevant source fits', async t => {
  const { service, observe } = await fixture(t, 3072);
  await observe('tool/result', 'original-report', 'Cobalt batchCount = 23; batch count checked.');
  for (let n = 0; n < 5; n++) await observe('assistant/message', `repeated-answer-${n}`, `Cobalt batchCount = 23; batch count in my plan ${n}. ${'Unverified explanatory prose. '.repeat(15)}`);
  const memory = await service.agentMemory('reader', { query: 'Cobalt batchCount', limit: 24 });
  assert.ok(memory.experiences.some(x => x.evidenceId.includes('original-report')), JSON.stringify(memory.experiences.map(x => ({ kind: x.kind, id: x.evidenceId }))));
  assert.ok(Buffer.byteLength(JSON.stringify(memory)) <= 3072);
});

test('retrieval: source preference must not displace a substantially more relevant authored item', async t => {
  const { service, observe } = await fixture(t);
  await observe('tool/result', 'unrelated-raw', 'Nimbus unrelated environmental report.');
  await observe('assistant/message', 'relevant-calculation', 'Nimbus checksum saltLength = 19.');
  const memory = await service.agentMemory('reader', { query: 'Nimbus checksum saltLength', limit: 1 });
  assert.match(memory.experiences[0].evidenceId, /relevant-calculation/);
});

const event = (roomId, id, type, payload, at) => ({ id, type, payload, at, tick: at, provenance: { roomId } });
const observation = (roomId, id, text, kind, at) => event(roomId, `receipt-${id}`, 'memory.observed', { observerAgentId: 'alice', items: [{ id, text, kind }] }, at);

test('retrieval: fixed source snapshots use the same relevance and authored tie-break as ordinary reads', () => {
  const index = new AgentMemoryIndex();
  const raw = [observation('raw', 'source', 'Jasper batchSize = 14.', 'tool-result', 1)];
  const own = [observation('own', 'answer', 'Jasper batchSize = 14 from my plan.', 'authored', 2)];
  try {
    index.syncSource('raw', { events: raw, revision: 1 }); index.syncSource('own', { events: own, revision: 1 });
    for (const sourceOverrides of [[], [{ roomId: 'raw', events: raw }], [{ roomId: 'own', events: own }]]) {
      const memory = index.recall({ agentId: 'alice', sourceRoomIds: ['raw', 'own'], query: 'Jasper batchSize', limit: 1, decay: false, sourceOverrides });
      assert.equal(memory.experiences[0].evidenceId, 'source');
    }
  } finally { index.close(); }
});

test('retrieval: exact token relevance is consistent through snapshot merge and outranks source preference', () => {
  const index = new AgentMemoryIndex();
  const raw = [observation('raw', 'partial-source', 'Forklift inspection.', 'tool-result', 3)];
  const own = [observation('own', 'exact-answer', 'Fork inspection.', 'authored', 2)];
  try {
    index.syncSource('raw', { events: raw, revision: 1 }); index.syncSource('own', { events: own, revision: 1 });
    for (const sourceOverrides of [[], [{ roomId: 'raw', events: raw }]]) {
      const memory = index.recall({ agentId: 'alice', sourceRoomIds: ['raw', 'own'], query: 'Fork', limit: 1, decay: false, sourceOverrides });
      assert.equal(memory.experiences[0].evidenceId, 'exact-answer');
    }
  } finally { index.close(); }
});

test('retrieval: group authorship is relative to the observer and identical other-person evidence is not consolidated into self repetition', () => {
  const index = new AgentMemoryIndex(), room = 'group';
  const events = [
    event(room, 'bob-original', 'message.created', { messageId: 'bob-original', authorKind: 'session', authorAgentId: 'bob', text: 'Opal torque = 11.' }, 1),
    event(room, 'alice-repeat', 'message.created', { messageId: 'alice-repeat', authorKind: 'session', authorAgentId: 'alice', text: 'Opal torque = 11.' }, 2),
    ...['alice', 'bob'].map((agent, i) => event(room, `seen-${agent}`, 'memory.observed', { observerAgentId: agent, messageIds: ['bob-original', 'alice-repeat'] }, 3 + i))
  ];
  try {
    index.syncSource(room, { events, revision: 1 });
    for (const sourceOverrides of [[], [{ roomId: room, events }]]) {
      const read = agentId => index.recall({ agentId, sourceRoomIds: [room], query: 'Opal torque', decay: false, sourceOverrides });
      const alice = read('alice'), bob = read('bob');
      assert.equal(alice.experiences.length, 2, 'do not collapse a peer source and self-authored repetition');
      assert.equal(alice.experiences[0].evidenceId, 'bob-original');
      assert.equal(alice.experiences[1].authoredByObserver, true);
      assert.equal(bob.experiences[0].evidenceId, 'alice-repeat');
      assert.equal(bob.experiences[1].authoredByObserver, true);
      assert.notEqual(alice.experiences[0].authoredByObserver, true);
      assert.notEqual(bob.experiences[0].authoredByObserver, true);
    }
  } finally { index.close(); }
});

test('retrieval: personal beliefs are interpretations, not external sources for tie-breaking', () => {
  const index = new AgentMemoryIndex();
  const evidence = observation('room', 'original', 'Willow flux = 41.', 'tool-result', 1);
  const belief = event('room', 'belief-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'belief', claim: 'Willow flux = 41 in my interpretation.',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'original', contentHash: memoryContentHash('Willow flux = 41.'), observationId: evidence.id }] }, 2);
  const events = [evidence, belief];
  try {
    index.syncSource('room', { events, revision: 1 });
    for (const sourceOverrides of [[], [{ roomId: 'room', events }]]) {
      const memory = index.recall({ agentId: 'alice', sourceRoomIds: ['room'], query: 'Willow flux', limit: 1, decay: false, sourceOverrides });
      assert.equal(memory.experiences[0]?.evidenceId, 'original');
      assert.equal(memory.beliefs.length, 0);
    }
  } finally { index.close(); }
});

test('retrieval: missing group author identity is not inferred from text or display metadata', () => {
  const index = new AgentMemoryIndex();
  const events = [event('room', 'legacy', 'message.created', { messageId: 'legacy', author: 'alice', authorKind: 'session', text: 'I wrote this Pine capacity = 8.' }, 1),
    event('room', 'receipt', 'memory.observed', { observerAgentId: 'alice', messageIds: ['legacy'] }, 2)];
  try {
    index.syncSource('room', { events, revision: 1 });
    const memory = index.recall({ agentId: 'alice', sourceRoomIds: ['room'], decay: false });
    assert.equal(memory.experiences[0].kind, 'message');
    assert.equal(memory.experiences[0].authoredByObserver, undefined);
  } finally { index.close(); }
});

test('retrieval: raw observations keep individual pin priority and metadata within one equivalent-content group', () => {
  const index = new AgentMemoryIndex(), text = 'Amber temperature = 32.';
  const first = observation('room', 'first', text, 'tool-result', 1), second = observation('room', 'second', text, 'tool-result', 2);
  const pin = event('room', 'pin-first', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'first', action: 'pin', contentHash: memoryContentHash(text), observationId: first.id }, 3);
  try {
    index.syncSource('room', { events: [first, second, pin], revision: 1 });
    const memory = index.recall({ agentId: 'alice', sourceRoomIds: ['room'], decay: false, consolidation: false });
    assert.equal(memory.experiences.length, 2);
    assert.equal(memory.experiences[0].evidenceId, 'first');
    assert.equal(memory.experiences[0].pinned, true);
    assert.equal(memory.experiences[1].evidenceId, 'second');
    assert.equal(memory.experiences[1].pinned, false);
  } finally { index.close(); }
});

test('retrieval: normalized policy and recall declare the same lifecycle version', () => {
  const index = new AgentMemoryIndex();
  try {
    index.syncSource('room', { events: [], revision: 1 });
    assert.equal(normalizeMemoryLifecycle().version, MEMORY_LIFECYCLE_VERSION);
    assert.equal(index.recall({ agentId: 'alice', sourceRoomIds: ['room'] }).lifecycleVersion, MEMORY_LIFECYCLE_VERSION);
  } finally { index.close(); }
});
