import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryIndex } from '../lib/agent-memory-index.js';
import { projectAgentMemory } from '../lib/agent-memory.js';
import { memoryContentHash, normalizeMemoryLifecycle } from '../lib/memory-lifecycle.js';
const event = (id, type, payload, at, roomId = 'room') => ({ id, type, payload, at, tick: at, provenance: { roomId } });
const message = (id, text, at, roomId = 'room') => event(id, 'message.created', { messageId: id, text }, at, roomId);
const receipt = (id, ids, at, agentId = 'alice', roomId = 'room') => event(id, 'memory.observed', { observerAgentId: agentId, messageIds: ids }, at, roomId);
const reset = (at, roomId = 'room') => event(`reset-${at}`, 'relationship.intervention', { action: 'clear', memoryScope: 'all', memoryVersion: 2 }, at, roomId);
const initial = (index, events, roomId = 'room', revision = 1) => index.syncSource(roomId, { events, revision });
const append = (index, events, roomId = 'room') => index.syncSource(roomId, { events, revision: Number(index.revision(roomId)) + 1, baseRevision: index.revision(roomId), appendOnly: true });
const recall = (index, options = {}) => index.recall({ agentId: 'alice', sourceRoomIds: ['room'], now: 1000, decay: false, ...options });
const normalize = memory => ({ experiences: memory.experiences.map(item => [item.evidenceId, item.text]).sort(),
  judgements: memory.judgements.map(item => [item.evidenceId, item.claim]).sort() });

test('incremental source projection agrees with full projection after each observed event and correction', () => {
  const index = new AgentMemoryIndex(), events = [message('old', 'wrong', 1), receipt('r1', ['old'], 2),
    message('private', 'PRIVATE', 3), receipt('other', ['private'], 4, 'bob'),
    event('new', 'message.created', { messageId: 'new', text: 'correct', correctsMessageId: 'old' }, 5), receipt('r2', ['new'], 6),
    reset(7), receipt('r3', ['old'], 8)];
  initial(index, []);
  for (let i = 0; i < events.length; i++) {
    append(index, [events[i]]);
    assert.deepEqual(normalize(recall(index, { consolidation: false })), normalize(projectAgentMemory({ agentId: 'alice', sources: [{ roomId: 'room', events: events.slice(0, i + 1) }] })));
  }
  index.close();
});

test('shared Session appraisal partitions, revocations and target reset equal reference', () => {
  const index = new AgentMemoryIndex(), events = [message('e', 'basis', 1), receipt('receipt', ['e'], 2)];
  for (let i = 0; i < 128; i++) events.push(event(`a${i}`, 'appraisal', { observerAgentId: 'alice', targetAgentId: `person-${i}`,
    observerId: 'reused-session', aboutAgentId: 'reused-target', stance: 'neutral', confidence: 0.4, claim: `claim ${i}`,
    action: 'record', validFrom: 3 + i, evidenceEventIds: ['e'] }, 3 + i));
  initial(index, events);
  const reference = projectAgentMemory({ agentId: 'alice', sources: [{ roomId: 'room', events }], limit: 100 });
  // Request these appraisal targets explicitly: v2 source preference otherwise
  // admits the supporting observation before an equal-score interpretation.
  const actual = recall(index, { limit: 100, targetAgentIds: Array.from({ length: 128 }, (_, i) => `person-${i}`) });
  assert.equal(actual.judgements.length, 100);
  assert.deepEqual(actual.judgements.map(x => x.evidenceId), reference.judgements.map(x => x.evidenceId));
  append(index, [event('revoke', 'appraisal', { ...events.at(-1).payload, action: 'revoke', validFrom: 200 }, 200)]);
  assert.equal(recall(index, { limit: 100 }).judgements.some(x => x.evidenceId === 'a127'), false);
  index.close();
});

test('extractive consolidation is background work and duplicate evidence occupies one recall position', async () => {
  const index = new AgentMemoryIndex();
  initial(index, Array.from({ length: 100 }, (_, i) => event(`r${i}`, 'memory.observed', { observerAgentId: 'alice',
    items: [{ id: `e${i}`, text: 'same exact fact' }] }, i + 1)));
  assert.ok(index.stats().queuedGroups > 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(index.stats().queuedGroups, 0);
  const result = recall(index);
  assert.equal(result.experiences.length, 1); assert.equal(result.experiences[0].consolidatedCount, 100);
  assert.equal(recall(index, { consolidation: false, limit: 100 }).experiences.length, 100);
  index.close();
});

test('dormant memories wake only on relevant explicit query and pinned memory retains current evidence checks', () => {
  const index = new AgentMemoryIndex();
  initial(index, [message('e', 'old volcano evidence', 1), receipt('r', ['e'], 2)]);
  const now = 200 * 86400000;
  assert.equal(recall(index, { now, decay: true }).experiences.length, 0);
  assert.equal(recall(index, { now, decay: true, mode: 'explicit', query: 'volcano' }).experiences.length, 1);
  assert.equal(recall(index, { now, decay: true, mode: 'explicit', query: 'unrelated' }).experiences.length, 0);
  append(index, [event('pin', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'pin' }, 3)]);
  assert.equal(recall(index, { now, decay: true }).experiences.length, 1);
  initial(index, [receipt('without-evidence', ['e'], 4)], 'room', 3);
  assert.equal(recall(index, { now, decay: true, mode: 'explicit', query: 'volcano' }).experiences.length, 0);
  index.close();
});

test('suppression removes text from recall and administrative lookup reveals metadata only', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'SECRET', 1), receipt('r', ['e'], 2)]);
  append(index, [event('s', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'suppress' }, 3)]);
  assert.doesNotMatch(JSON.stringify(recall(index, { mode: 'explicit', query: 'SECRET' })), /SECRET/);
  const request = { agentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', sourceRoomIds: ['room'] };
  assert.equal(index.lookup(request), null);
  assert.deepEqual(index.lookup({ ...request, includeSuppressed: true }), { sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('SECRET'), suppressed: true, pinned: false });
  append(index, [event('s2', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'restore' }, 4)]);
  assert.equal(recall(index).experiences.length, 1); index.close();
});

test('current beliefs remain separate, supersede and revoke, and never revive after a reset with a new exposure', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'basis', 1), receipt('r', ['e'], 2)]);
  initial(index, [event('b', 'memory.belief', { observerAgentId: 'alice', beliefId: 'belief', claim: 'current conclusion', action: 'record',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3, 'native')], 'native');
  const options = { sourceRoomIds: ['room', 'native'] };
  assert.equal(recall(index, options).beliefs.length, 1); assert.equal(recall(index, options).judgements.length, 0);
  append(index, [reset(4), receipt('r2', ['e'], 5)]);
  assert.equal(recall(index, options).beliefs.length, 0);
  append(index, [event('b2', 'memory.belief', { observerAgentId: 'alice', beliefId: 'new', supersedes: 'belief', claim: 'rechecked conclusion', action: 'record',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 6, 'native')], 'native');
  assert.equal(recall(index, options).beliefs[0].beliefId, 'new');
  append(index, [event('revoke', 'memory.belief', { observerAgentId: 'alice', beliefId: 'new', action: 'revoke' }, 7, 'native')], 'native');
  assert.equal(recall(index, options).beliefs.length, 0); index.close();
});

test('fresh authorization, foreign provenance, inaccessible sources and stale delta cannot widen recall', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'visible', 1), receipt('r', ['e'], 2), message('foreign', 'PRIVATE', 3, 'foreign')]);
  assert.equal(recall(index, { sourceRoomIds: [] }).experiences.length, 0);
  assert.equal(recall(index).coverage.excludedProvenanceEvents, 1);
  assert.equal(recall(index, { context: { authority: 'unavailable', roomId: 'room' } }).experiences.length, 0);
  assert.throws(() => index.syncSource('room', { events: [], revision: 4, appendOnly: true, baseRevision: 0 }), /stale/);
  assert.throws(() => index.recall({ agentId: 'alice' }), /authorization/);
  index.close();
});

test('fixed source override cannot leak a newer observation or mutate the shared index', () => {
  const index = new AgentMemoryIndex(), prefix = [message('e', 'old', 1), receipt('r', ['e'], 2)];
  initial(index, [...prefix, message('future', 'FUTURE', 3), receipt('r2', ['future'], 4)]);
  const result = recall(index, { sourceOverrides: [{ roomId: 'room', events: prefix }] });
  assert.deepEqual(result.experiences.map(x => x.text), ['old']);
  assert.equal(recall(index).experiences.length, 2); index.close();
});

test('full JSON response and combined entry count are bounded', () => {
  const index = new AgentMemoryIndex();
  initial(index, Array.from({ length: 200 }, (_, i) => event(`r${i}`, 'memory.observed', { observerAgentId: 'alice', items: [{ id: `e${i}`, text: `${i} ${'字'.repeat(1500)}` }] }, i + 1)));
  const result = recall(index, { limit: 100, maxBytes: 8192 });
  assert.ok(result.experiences.length + result.judgements.length + result.beliefs.length <= 100);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 8192);
  assert.equal(result.coverage.serializedBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.ok(result.coverage.omittedByBudget > 0); index.close();
});

test('warm queries do not reprocess events; unrelated sources cannot consume query candidates', () => {
  const index = new AgentMemoryIndex({ maxCandidateCount: 10 });
  initial(index, [message('e', 'needle', 1), receipt('r', ['e'], 2)]);
  const ownBefore = index.stats().indexedEvents;
  for (let i = 0; i < 5; i++) assert.equal(recall(index).experiences.length, 1);
  assert.equal(index.stats().indexedEvents, ownBefore);
  initial(index, Array.from({ length: 5000 }, (_, i) => event(`x${i}`, 'memory.observed', { observerAgentId: 'alice', items: [{ id: `e${i}`, text: `foreign needle ${i}` }] }, 10000 + i, 'unavailable')), 'unavailable');
  assert.equal(recall(index, { query: 'needle' }).coverage.candidatesExamined, 1);
  assert.equal(recall(index, { query: 'needle' }).experiences[0].text, 'needle'); index.close();
});

test('byte-budget eviction fails closed, marks partial, and source can be rebuilt after capacity frees', () => {
  const index = new AgentMemoryIndex({ maxIndexBytes: 16000, maxAgentIndexBytes: 16000 });
  initial(index, [message('e', 'small', 1), receipt('r', ['e'], 2)]);
  assert.equal(recall(index).experiences.length, 1);
  initial(index, [message('big', 'x'.repeat(10000), 1, 'huge'), receipt('r', ['big'], 2, 'bob', 'huge')], 'huge');
  const result = recall(index, { sourceRoomIds: ['huge'] });
  assert.equal(result.experiences.length, 0); assert.equal(result.coverage.partial, true);
  assert.ok(index.stats().accountedBytes <= 16000);
  initial(index, [message('e', 'small', 1), receipt('r', ['e'], 2)]);
  assert.equal(recall(index).experiences.length, 1); index.close();
});

test('a new index replays canonical sources rather than trusting an unverified persistent cache', () => {
  const events = [message('e', 'persistent original', 1), receipt('r', ['e'], 2)];
  const first = new AgentMemoryIndex(), second = new AgentMemoryIndex(); initial(first, events); initial(second, events);
  assert.deepEqual(recall(first), recall(second)); first.close(); second.close();
});

test('lifecycle normalization has bounded explicit defaults', () => {
  const config = normalizeMemoryLifecycle({ maxRecallBytes: 1e9, maxCandidateCount: 1e9, halfLifeDays: -1, consolidation: false });
  assert.equal(config.maxRecallBytes, 65536); assert.equal(config.maxCandidateCount, 2000); assert.equal(config.halfLifeDays, 1); assert.equal(config.consolidation, false);
});

test('missing policy source cannot revive suppressed content from another cached source', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'SUPPRESSED', 1), receipt('r', ['e'], 2)]);
  const controls = [event('s', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'suppress' }, 3, 'native')];
  initial(index, controls, 'native'); const options = { sourceRoomIds: ['room', 'native'] };
  assert.equal(recall(index, options).experiences.length, 0);
  index.dropSource('native');
  const missing = recall(index, options); assert.equal(missing.coverage.policyUnavailable, true);
  assert.doesNotMatch(JSON.stringify(missing), /SUPPRESSED/);
  initial(index, controls, 'native', 2); assert.equal(recall(index, options).experiences.length, 0);
  initial(index, [], 'native', 3); assert.equal(recall(index, options).experiences.length, 1); index.close();
});

test('oversized source is rejected without evicting another agent healthy source', () => {
  const index = new AgentMemoryIndex({ maxIndexBytes: 16000, maxAgentIndexBytes: 16000 });
  initial(index, [message('e', 'small', 1), receipt('r', ['e'], 2)]);
  initial(index, [message('big', 'x'.repeat(30000), 1, 'huge'), receipt('r', ['big'], 2, 'bob', 'huge')], 'huge');
  assert.equal(recall(index).experiences.length, 1); assert.equal(index.revision('huge'), null); index.close();
});

test('belief administrative lookup is independent of recall limit and hides stale claim', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'basis', 1), receipt('r', ['e'], 2)]);
  initial(index, [event('b', 'memory.belief', { observerAgentId: 'alice', beliefId: 'belief', claim: 'SECRET conclusion', action: 'record',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3, 'native')], 'native');
  const input = { agentId: 'alice', beliefId: 'belief', sourceRoomIds: ['room', 'native'] };
  assert.equal(index.belief(input).validEvidence, true);
  initial(index, [], 'room', 2); const invalid = index.belief(input);
  assert.equal(invalid.current, true); assert.equal(invalid.validEvidence, false); assert.doesNotMatch(JSON.stringify(invalid), /SECRET/);
  index.close();
});

test('fresh source list excludes cached control effects and snapshots revalidate cross-source beliefs', () => {
  const index = new AgentMemoryIndex(), prefix = [message('e', 'old basis', 1), receipt('r', ['e'], 2)];
  initial(index, prefix);
  initial(index, [event('s', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'suppress' }, 3, 'native')], 'native');
  assert.equal(recall(index, { sourceRoomIds: ['room'] }).experiences.length, 1, 'unauthorized control source has no authority');
  assert.equal(recall(index, { sourceRoomIds: ['room', 'native'] }).experiences.length, 0);
  initial(index, [event('b', 'memory.belief', { observerAgentId: 'alice', beliefId: 'b', claim: 'from old evidence',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('old basis') }] }, 4, 'native')], 'native', 2);
  assert.equal(recall(index, { sourceRoomIds: ['room', 'native'] }).beliefs.length, 1);
  const snapshot = recall(index, { sourceRoomIds: ['room', 'native'], sourceOverrides: [{ roomId: 'room', events: [] }] });
  assert.equal(snapshot.beliefs.length, 0); index.close();
});

test('appraisal updates replay only their pair; future intervals activate at later source ticks', () => {
  const index = new AgentMemoryIndex(), events = [message('e', 'basis', 1), receipt('r', ['e'], 2)];
  for (let i = 0; i < 128; i++) events.push(event(`a${i}`, 'appraisal', { observerAgentId: 'alice', targetAgentId: `target${i}`,
    observerId: 'session', aboutAgentId: `session${i}`, stance: 'neutral', confidence: .5, claim: `claim${i}`, evidenceEventIds: ['e'], validFrom: i === 0 ? 1000 : i + 3 }, i + 3));
  initial(index, events); const before = index.stats().appraisalStatementsProcessed;
  append(index, [message('ordinary', 'unrelated message', 200)]);
  assert.equal(index.stats().appraisalStatementsProcessed, before);
  append(index, [message('later', 'time advances', 1000)]);
  assert.equal(index.stats().appraisalStatementsProcessed, before + 1);
  assert.ok(index.lookup({ agentId: 'alice', sourceRoomId: 'room', evidenceId: 'a0', sourceRoomIds: ['room'] })); index.close();
});

test('candidate budget bounds failed substring matches and pre-reset history traversal', () => {
  const index = new AgentMemoryIndex({ maxCandidateCount: 10 });
  initial(index, Array.from({ length: 100 }, (_, i) => event(`r${i}`, 'memory.observed', { observerAgentId: 'alice',
    items: [{ id: `e${i}`, text: `abxxcd ${i}` }] }, i + 1)));
  for (const options of [{ query: 'abcd' }, { context: { roomId: 'room', afterAt: 1000 } }]) {
    const result = recall(index, options); assert.ok(result.coverage.candidatesVisited <= 10); assert.equal(result.coverage.partial, true);
  }
  index.close();
});

test('pinned old evidence and current beliefs are considered before a long recent tail exhausts candidates', () => {
  const index = new AgentMemoryIndex({ maxCandidateCount: 10 });
  initial(index, [message('old', 'pinned promise', 1), receipt('r', ['old'], 2),
    ...Array.from({ length: 100 }, (_, i) => event(`o${i}`, 'memory.observed', { observerAgentId: 'alice', items: [{ id: `e${i}`, text: `later work ${i}` }] }, i + 10))]);
  initial(index, [event('pin', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'old', action: 'pin' }, 120, 'native'),
    event('belief', 'memory.belief', { observerAgentId: 'alice', beliefId: 'belief', claim: 'persistent conclusion', evidence: [{ sourceRoomId: 'room', evidenceId: 'old', contentHash: memoryContentHash('pinned promise') }] }, 121, 'native')], 'native');
  const result = recall(index, { sourceRoomIds: ['room', 'native'], query: 'conclusion', limit: 2 });
  assert.equal(result.experiences[0].evidenceId, 'old'); assert.equal(result.beliefs[0].beliefId, 'belief');
  assert.ok(result.coverage.candidatesVisited <= 10); index.close();
});

test('room-scoped belief can be sampled from a fixed turn prefix', () => {
  const index = new AgentMemoryIndex(), events = [message('e', 'basis', 1), receipt('r', ['e'], 2), event('belief-event', 'memory.belief',
    { observerAgentId: 'alice', beliefId: 'b', claim: 'current room belief', evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3)];
  initial(index, events);
  const result = recall(index, { context: { roomId: 'room', afterAt: 0 }, sourceOverrides: [{ roomId: 'room', events }] });
  assert.equal(result.beliefs[0].beliefId, 'b'); index.close();
});

test('returned beliefs and revision tokens cannot mutate the cached projection', () => {
  const index = new AgentMemoryIndex(), events = [message('e', 'basis', 1), receipt('r', ['e'], 2), event('belief-event', 'memory.belief',
    { observerAgentId: 'alice', beliefId: 'b', claim: 'safe belief', evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3)];
  initial(index, events, 'room', { generation: 'g', count: 3, head: 'h' });
  const first = recall(index); first.beliefs[0].evidence[0].contentHash = 'corrupted by caller';
  const revision = index.revision('room'); revision.count = 999;
  assert.equal(recall(index).beliefs.length, 1); assert.equal(index.revision('room').count, 3); index.close();
});

test('bounded policy-authority diagnostics fail closed if an old missing marker was compacted', () => {
  const index = new AgentMemoryIndex({ maxIndexBytes: 16384, maxAgentIndexBytes: 16384 });
  const observation = [message('e', 'HIDDEN by lost policy', 1), receipt('r', ['e'], 2)];
  initial(index, observation);
  initial(index, [event('suppression', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'suppress' }, 3, 'native')], 'native');
  index.dropSource('native');
  for (let i = 0; i < 30; i++) {
    const roomId = `policy-${i}`;
    initial(index, [event(`p${i}`, 'memory.control', { observerAgentId: `other-${i}`, sourceRoomId: 'absent', evidenceId: 'e', action: 'suppress' }, i + 4, roomId)], roomId);
    index.dropSource(roomId);
  }
  initial(index, observation, 'room', 2);
  assert.ok(index.stats().policyAuthorityMarkers <= 4); assert.equal(index.stats().policyHistoryIncomplete, true);
  assert.doesNotMatch(JSON.stringify(recall(index, { sourceRoomIds: ['room', 'native'] })), /HIDDEN/);
  assert.ok(index.stats().accountedBytes <= 16384); index.close();
});

test('appraisal horizon compatibility excludes other identity partitions from advancing future claims', () => {
  const belief = (id, observerAgentId, targetAgentId, at, validFrom) => event(id, 'appraisal', { observerAgentId, targetAgentId,
    observerId: 'same-session', aboutAgentId: 'same-target-session', stance: 'neutral', confidence: .5, claim: id, evidenceEventIds: ['e'], validFrom }, at);
  const events = [message('e', 'basis', 1), receipt('r', ['e'], 2), belief('own future', 'alice', 'bob', 3, 50), belief('other identity later', 'charlie', 'bob', 100, 100)];
  const index = new AgentMemoryIndex(); initial(index, events);
  assert.deepEqual(normalize(recall(index)), normalize(projectAgentMemory({ agentId: 'alice', sources: [{ roomId: 'room', events }] })));
  assert.equal(recall(index).judgements.length, 0); index.close();
});

test('cross-source belief supersession and revocation follow explicit edges regardless of source load order', () => {
  const a = [message('e', 'basis', 1, 'a'), receipt('r', ['e'], 2, 'alice', 'a'), event('old-event', 'memory.belief',
    { observerAgentId: 'alice', beliefId: 'old', claim: 'old conclusion', evidence: [{ sourceRoomId: 'a', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3, 'a')];
  const b = [event('new-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'new', supersedes: 'old', claim: 'new conclusion',
    evidence: [{ sourceRoomId: 'a', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 4, 'b')];
  const c = [event('revoke-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'new', action: 'revoke' }, 5, 'c')];
  for (const order of [[['a', a], ['b', b]], [['b', b], ['a', a]]]) {
    const index = new AgentMemoryIndex(); for (const [id, events] of order) initial(index, events, id);
    const options = { sourceRoomIds: ['a', 'b'] };
    assert.deepEqual(recall(index, options).beliefs.map(x => x.beliefId), ['new']);
    initial(index, c, 'c'); assert.deepEqual(recall(index, { sourceRoomIds: ['a', 'b', 'c'] }).beliefs, []);
    index.dropSource('c'); assert.equal(recall(index, { sourceRoomIds: ['a', 'b', 'c'] }).coverage.policyUnavailable, true);
    assert.deepEqual(recall(index, options).beliefs.map(x => x.beliefId), ['new']);
    index.dropSource('b'); assert.deepEqual(recall(index, { sourceRoomIds: ['a'] }).beliefs.map(x => x.beliefId), ['old']);
    initial(index, b, 'b', 2); assert.deepEqual(recall(index, options).beliefs.map(x => x.beliefId), ['new']);
    index.close();
  }
});

test('frozen source prefix removes only later belief retirement edges and does not mutate live graph', () => {
  const index = new AgentMemoryIndex();
  initial(index, [message('e', 'basis', 1), receipt('r', ['e'], 2), event('old-event', 'memory.belief', { observerAgentId: 'alice', beliefId: 'old', claim: 'old belief',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis') }] }, 3)]);
  initial(index, [event('revoke', 'memory.belief', { observerAgentId: 'alice', action: 'revoke', beliefId: 'old' }, 4, 'other')], 'other');
  const options = { sourceRoomIds: ['room', 'other'] };
  assert.equal(recall(index, options).beliefs.length, 0);
  assert.deepEqual(recall(index, { ...options, sourceOverrides: [{ roomId: 'other', events: [] }] }).beliefs.map(x => x.beliefId), ['old']);
  assert.equal(recall(index, options).beliefs.length, 0); index.close();
});

test('reset hides claims without undoing cross-source revocations, and old pins cannot cross a new exposure window', () => {
  const index = new AgentMemoryIndex();
  initial(index, [message('e', 'promise', 1), receipt('r', ['e'], 2), event('old', 'memory.belief', { observerAgentId: 'alice', beliefId: 'old', claim: 'old claim',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('promise') }] }, 3)]);
  initial(index, [event('pin', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'pin' }, 4, 'native'),
    event('revoke', 'memory.belief', { observerAgentId: 'alice', beliefId: 'old', action: 'revoke' }, 5, 'native')], 'native');
  append(index, [reset(6, 'native')], 'native');
  const options = { sourceRoomIds: ['room', 'native'] }; assert.equal(recall(index, options).beliefs.length, 0);
  append(index, [reset(7), receipt('new-exposure', ['e'], 8)]);
  assert.equal(recall(index, { ...options, decay: true, now: 200 * 86400000 }).experiences.length, 0);
  index.close();
});

test('pin is tied to the witnessed receipt across reset even when its native logical clock is ahead', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'promise', 1), receipt('old-receipt', ['e'], 2)]);
  initial(index, [event('pin', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'pin', observationId: 'old-receipt' }, 1000000, 'native')], 'native');
  const options = { sourceRoomIds: ['room', 'native'], decay: true, now: 200 * 86400000 };
  assert.equal(recall(index, options).experiences.length, 1);
  append(index, [reset(3), receipt('new-receipt', ['e'], 4)]);
  assert.equal(recall(index, options).experiences.length, 0);
  append(index, [event('pin2', 'memory.control', { observerAgentId: 'alice', sourceRoomId: 'room', evidenceId: 'e', action: 'pin', observationId: 'new-receipt' }, 1000001, 'native')], 'native');
  assert.equal(recall(index, options).experiences.length, 1); index.close();
});

test('explicit receipt provenance outranks unrelated source logical clocks for belief validity', () => {
  const index = new AgentMemoryIndex(); initial(index, [message('e', 'basis', 1), receipt('r', ['e'], 1000000)]);
  initial(index, [event('b', 'memory.belief', { observerAgentId: 'alice', beliefId: 'b', claim: 'derived after reading',
    evidence: [{ sourceRoomId: 'room', evidenceId: 'e', contentHash: memoryContentHash('basis'), observationId: 'r' }] }, 5, 'native')], 'native');
  assert.equal(recall(index, { sourceRoomIds: ['room', 'native'] }).beliefs.length, 1);
  assert.equal(index.belief({ agentId: 'alice', beliefId: 'b', sourceRoomIds: ['room', 'native'] }).validEvidence, true); index.close();
});
