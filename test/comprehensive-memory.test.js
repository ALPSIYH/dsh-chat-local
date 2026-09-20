import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentPersonas } from '../lib/agent-persona.js';
import { projectAgentMemory, renderPersonalMemory, observedSessionItems } from '../lib/agent-memory.js';
import { DshChatLocalService } from '../lib/room-store.js';

function rng(seed) { let value = seed >>> 0; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 2 ** 32; }; }
const sorted = xs => [...xs].sort();
const event = (roomId, id, type, payload, at) => ({ id, type, payload, at, tick: at, actor: { kind: 'system', id: 'system' }, provenance: { roomId, originClass: 'system' } });
const message = (roomId, id, text, at) => event(roomId, `event-${id}`, 'message.created', { messageId: id, text }, at);
const receipt = (roomId, id, agentId, messageIds, at) => event(roomId, id, 'memory.observed', { observerAgentId: agentId, messageIds }, at);
const reset = (roomId, at) => event(roomId, `reset-${at}`, 'relationship.intervention', { action: 'clear', memoryScope: 'all', memoryVersion: 2 }, at);

async function harness(t) {
  const path = await mkdtemp(join(tmpdir(), 'dcl-comprehensive-person-'));
  const ctx = { agents: { get: () => ({ cancel() {} }) }, dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async () => {} }, get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(path, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 5000 });
  await service.ready;
  t.after(async () => { await service.close(); await rm(path, { force: true, recursive: true }); });
  const person = await service.directory.save({ operationId: 'alice', profile: { alias: 'Identical alias' } });
  const other = await service.directory.save({ operationId: 'bob', profile: { alias: 'Identical alias' } });
  const room = await service.createRoom({ name: 'A', autoDeliver: false, members: [{ kind: 'session', sessionId: 'a1', agentId: person.id, alias: 'Old alias' }] });
  const second = await service.createRoom({ name: 'B', autoDeliver: false, members: [{ kind: 'session', sessionId: 'a2', agentId: person.id, alias: 'New alias' }] });
  return { service, person, other, room, second, path };
}
const nativeMessage = (id, text) => ({ type: 'user/message', data: { id, content: [{ type: 'text', text }] } });

// Independent oracle is a simple receipt set: no room/member/session label may
// admit an unobserved message. Test seeds remain reproducible on failure.
test('seeded privacy/reset oracle: 200 histories, 3 identities and 4 sources', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = rng(seed), agents = ['person-a', 'person-b', 'person-c'];
    const sources = [], oracle = new Map(agents.map(id => [id, new Set()]));
    for (let roomNo = 0; roomNo < 4; roomNo++) {
      const roomId = `room-${roomNo}`, events = [], seen = new Map(agents.map(id => [id, new Set()]));
      for (let n = 1; n <= 15; n++) {
        const id = `${roomId}-m${n}`, text = `seed:${seed}/room:${roomNo}/material:${n}`;
        events.push(message(roomId, id, text, 4 * n));
        for (const [index, agentId] of agents.entries()) {
          if (random() < 0.43) { events.push(receipt(roomId, `r-${n}-${index}`, agentId, [id], 4 * n + index + 1)); seen.get(agentId).add(text); }
        }
        if (random() < 0.12) { events.push(reset(roomId, 4 * n + 3.5)); for (const bag of seen.values()) bag.clear(); }
      }
      // An event copied into the wrong source is never a valid receipt.
      events.push({ ...receipt('wrong-room', 'foreign', 'person-a', [`${roomId}-m1`], 1000) });
      for (const agentId of agents) for (const item of seen.get(agentId)) oracle.get(agentId).add(item);
      sources.push({ roomId, events });
    }
    const before = JSON.stringify(sources);
    for (const agentId of agents) {
      const result = projectAgentMemory({ agentId, sources, limit: 100 });
      assert.deepEqual(sorted(result.experiences.map(item => item.text)), sorted(oracle.get(agentId)), `seed ${seed}, ${agentId}`);
      assert.deepEqual(projectAgentMemory({ agentId, sources: [...sources].reverse(), limit: 100 }), result, `source permutation seed ${seed}`);
      assert.equal(result.coverage.excludedProvenanceEvents, 4);
    }
    assert.equal(JSON.stringify(sources), before, `immutable input seed ${seed}`);
  }
});

test('seeded Unicode rendering conserves coverage and stays within every budget', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = rng(seed);
    const experiences = Array.from({ length: 16 }, (_, n) => ({ kind: 'message', text: `${n}:` + '😀中\n\t'.repeat(Math.floor(random() * 170)), sourceRoomId: `room-${seed}`, evidenceId: `id-${n}`, at: n }));
    const memory = { experiences, judgements: [], totals: { experiences: 28, judgements: 0 } };
    for (const maxChars of [0, 1, 59, 180, 600, 2000]) {
      const result = renderPersonalMemory(memory, { maxChars });
      assert.ok((result.text?.length ?? 0) <= Math.min(maxChars, 600), `budget ${maxChars} seed ${seed}`);
      assert.equal(result.metadata.selected.length + result.metadata.omitted, 28);
      assert.equal(result.metadata.omittedByBudget + result.metadata.omittedByPolicy + result.metadata.omittedByRecallLimit, result.metadata.omitted);
      assert.ok((result.text ?? '').isWellFormed(), `UTF-16 seed ${seed}`);
      if (result.text) for (const selected of result.metadata.selected) assert.ok(result.text.includes(selected.evidenceId));
    }
  }
});

test('nested tool outputs preserve visible fragments and never parameters, reasoning or own context', () => {
  const text = 'visible nested result';
  const result = observedSessionItems({ type: 'tool/result', data: { private: 'SECRET_META', message: { id: 'nested', content: [
    { type: 'tool-result', content: [{ type: 'tool-result', content: [{ type: 'text', text }, { type: 'reasoning', text: 'SECRET_REASONING' }] }, { type: 'tool-call', arguments: 'SECRET_ARGS' }] }
  ] } } });
  assert.equal(result[0].text, text);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  assert.deepEqual(observedSessionItems({ type: 'user/message', data: { content: [{ type: 'text', text: 'SELF_REPLAY' }], source: { kind: 'plugin', form: 'snapshot', sections: [{ name: 'dsh-chat-local:person', text: 'SELF_REPLAY' }] } } }), []);
});

test('20 contending personality saves across 4 instances yield one winner and recover after conflicts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-comprehensive-persona-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const instances = Array.from({ length: 4 }, () => new AgentPersonas(join(directory, 'rooms.json')));
  const agent = { id: 'one-person', alias: 'same alias' }, initial = await instances[0].read(agent);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => instances[n % 4].save(agent, { markdown: `# Person\nvalue-${n}`, expectedHash: initial.hash })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 409));
  const current = await instances[3].read(agent);
  const next = await instances[2].save(agent, { markdown: '# Person\nrecovered after conflict', expectedHash: current.hash });
  assert.equal(await readFile(next.path, 'utf8'), next.markdown);
  const history = join(next.path, '..', 'history');
  assert.equal(await readFile(join(history, `${initial.hash}.md`), 'utf8'), initial.markdown);
  assert.equal(await readFile(join(history, `${current.hash}.md`), 'utf8'), current.markdown);
  assert.ok(!(await readdir(join(next.path, '..'))).some(name => name.endsWith('.tmp')));
});

test('session reassignment preserves old person history and refuses unqualified native identity', async t => {
  const h = await harness(t);
  await h.service.observeSessionEvent('a1', nativeMessage('before', 'ALICE_OLD_NATIVE'));
  await h.service.removeMember(h.room.id, 'a1');
  await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'a1', agentId: h.other.id, alias: 'Old alias' });
  assert.equal(await h.service.nativeAgentContext('a1'), null);
  await assert.rejects(h.service.agentMemory('a1'), /unambiguous/);
  await h.service.observeSessionEvent('a1', nativeMessage('after', 'AMBIGUOUS_NATIVE'));
  const old = JSON.stringify(await h.service.agentMemory('a2'));
  const next = JSON.stringify(await h.service.agentMemory('a1', { roomId: h.room.id }));
  assert.match(old, /ALICE_OLD_NATIVE/);
  assert.doesNotMatch(old, /AMBIGUOUS_NATIVE/);
  assert.doesNotMatch(next, /ALICE_OLD_NATIVE|AMBIGUOUS_NATIVE/);
});

test('native persona is sampled once within a turn and refreshed for the next turn', async t => {
  const h = await harness(t);
  const first = await h.service.directory.persona(h.person.id);
  const saved = await h.service.directory.savePersona(h.person.id, { markdown: 'ORIGINAL_PERSONALITY', expectedHash: first.hash });
  await h.service.observeSessionEvent('a1', { type: 'turn/start', data: { turn: 1 } });
  const oldContext = await h.service.nativeAgentContext('a1');
  await h.service.directory.savePersona(h.person.id, { markdown: 'UPDATED_PERSONALITY', expectedHash: saved.hash });
  assert.equal(await h.service.nativeAgentContext('a1'), oldContext);
  await h.service.observeSessionEvent('a1', { type: 'turn/end', data: { turn: 1 } });
  await h.service.observeSessionEvent('a1', { type: 'turn/start', data: { turn: 2 } });
  const newContext = await h.service.nativeAgentContext('a1');
  assert.match(newContext, /UPDATED_PERSONALITY/);
  assert.doesNotMatch(newContext, /ORIGINAL_PERSONALITY/);
});

test('native memory tool call ids cannot leak a different persons excluded recall result', async t => {
  const h = await harness(t);
  const third = await h.service.createRoom({ name: 'other person', autoDeliver: false, members: [{ kind: 'session', sessionId: 'b1', agentId: h.other.id, alias: 'Same alias' }] });
  assert.ok(third.id);
  await h.service.observeSessionEvent('a1', { type: 'tool/call', data: { callId: 'same', name: 'chat_recall' } });
  await h.service.observeSessionEvent('b1', { type: 'tool/call', data: { callId: 'same', name: 'read_file' } });
  const result = text => ({ type: 'tool/result', data: { message: { id: 'shared-message-id', source: { callId: 'same', kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'same', content: [{ type: 'text', text }] }] } } });
  await h.service.observeSessionEvent('b1', result('BOB_VISIBLE_FILE'));
  await h.service.observeSessionEvent('a1', result('ALICE_RECALL_FEEDBACK'));
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('a2')), /BOB_VISIBLE_FILE|ALICE_RECALL_FEEDBACK/);
  assert.match(JSON.stringify(await h.service.agentMemory('b1')), /BOB_VISIBLE_FILE/);
});

test('seeded subjective histories retain the latest view of each stable person across reused Sessions', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = rng(seed), roomId = `belief-room-${seed}`, people = ['alice', 'bob'], targets = ['charlie', 'dana', 'erin'];
    const expected = new Map(people.map(person => [person, new Map()]));
    const events = [message(roomId, 'basis', 'shared evidence that both actually read', 0), ...people.map((person, n) => receipt(roomId, `saw-${person}`, person, ['basis'], n + 0.2))];
    for (let n = 1; n <= 40; n++) {
      if (random() < 0.09) { events.push(reset(roomId, n + 1)); for (const views of expected.values()) views.clear(); continue; }
      const person = people[Math.floor(random() * people.length)], targetAgentId = targets[Math.floor(random() * targets.length)];
      const previous = expected.get(person).get(targetAgentId), revoke = previous && random() < 0.25, id = `belief-${n}`;
      const payload = { observerId: 'reused-observer-session', aboutAgentId: 'reused-target-session', observerAgentId: person, targetAgentId,
        stance: 'neutral', confidence: 0.5, claim: `view-${seed}-${n}`, evidenceEventIds: ['basis'], validFrom: n + 1, validTo: null, action: revoke ? 'revoke' : 'record',
        ...(revoke ? { revokesAppraisalId: previous.id } : {}) };
      events.push(event(roomId, id, 'appraisal', payload, n + 1));
      if (revoke) expected.get(person).delete(targetAgentId); else expected.get(person).set(targetAgentId, { id, claim: payload.claim });
    }
    for (const person of people) {
      const actual = projectAgentMemory({ agentId: person, sources: [{ roomId, events }], limit: 100 });
      assert.deepEqual(sorted(actual.judgements.map(item => `${item.targetAgentId}:${item.claim}`)),
        sorted([...expected.get(person)].map(([target, item]) => `${target}:${item.claim}`)), `belief seed ${seed}, ${person}`);
    }
  }
});

for (const transition of ['end', 'next-turn', 'close', 'rebind']) test(`a suspended native assembly is discarded after ${transition}`, async t => {
  const h = await harness(t);
  const original = h.service.personas.read.bind(h.service.personas);
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { started = resolve; });
  h.service.personas.read = async agent => { const value = await original(agent); started(); await blocked; return value; };
  await h.service.observeSessionEvent('a1', { type: 'turn/start', data: { turn: 1 } });
  const pending = h.service.nativeAgentContext('a1');
  pending.catch(() => {});
  try {
    await reached;
    if (transition === 'end' || transition === 'next-turn') await h.service.observeSessionEvent('a1', { type: 'turn/end', data: { turn: 1 } });
    if (transition === 'next-turn') await h.service.observeSessionEvent('a1', { type: 'turn/start', data: { turn: 2 } });
    if (transition === 'close') await h.service.close();
    if (transition === 'rebind') {
      await h.service.removeMember(h.room.id, 'a1');
      await h.service.addMember(h.room.id, { kind: 'session', sessionId: 'a1', agentId: h.other.id, alias: 'Replacement person' });
    }
    release();
    assert.equal(await pending, null);
  } finally { release(); h.service.personas.read = original; }
});

test('native assembly still reports current-sample I/O failures and a later request can recover', async t => {
  const h = await harness(t), original = h.service.personas.read.bind(h.service.personas);
  await h.service.observeSessionEvent('a1', { type: 'turn/start', data: { turn: 10 } });
  h.service.personas.read = async () => { throw new Error('injected current persona read failure'); };
  try {
    await assert.rejects(h.service.nativeAgentContext('a1'), /injected current persona read failure/);
    assert.equal(h.service.nativeContextSamples.has('a1'), false);
  } finally { h.service.personas.read = original; }
  assert.match(await h.service.nativeAgentContext('a1'), /持續 Agent 身分/);
});
