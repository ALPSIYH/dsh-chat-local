import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DshChatLocalService } from '../lib/room-store.js';
import { nativeMemorySource, observedSessionItems } from '../lib/agent-memory.js';

const peer = (id, text, senderId = 'native-child') => ({ type: 'user/message', data: {
  id, role: 'user', source: { kind: 'team-message', teamId: 'lead', messageId: id, senderId, senderName: 'reviewer' },
  content: [{ type: 'text', text: `Team message ${id} from reviewer:` }, { type: 'text', text }]
} });
async function waitFor(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('test timed out');
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dcl-team-memory-'));
  const calls = [];
  const service = new DshChatLocalService({ agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); } },
    get(name) { return this[name]; }
  }, { path: join(dir, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 10000 });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  await service.ready;
  const alice = await service.directory.save({ profile: { alias: 'Alice' }, operationId: 'alice' });
  const bob = await service.directory.save({ profile: { alias: 'Bob' }, operationId: 'bob' });
  const child = await service.directory.save({ profile: { alias: 'Child' }, operationId: 'child' });
  const room = await service.createRoom({ name: 'group', autoDeliver: false, members: [
    { kind: 'session', sessionId: 'lead', alias: 'Alice', agentId: alice.id },
    { kind: 'session', sessionId: 'other', alias: 'Bob', agentId: bob.id }
  ] });
  await service.createRoom({ name: 'other work', autoDeliver: false, members: [
    { kind: 'session', sessionId: 'alice-elsewhere', alias: 'Alice', agentId: alice.id },
    { kind: 'session', sessionId: 'native-child', alias: 'Child', agentId: child.id }
  ] });
  const dispatch = async () => {
    await service.send({ roomId: room.id, author: 'human:test', authorKind: 'human', text: 'group assignment', mentions: ['lead'] });
    return waitFor(() => calls[0]);
  };
  const open = async call => {
    await service.observeSessionEvent('lead', { type: 'turn/start', data: { turn: 1 } });
    await service.observeSessionEvent('lead', { type: 'user/message', data: { id: 'bridge-marker', content: [
      { type: 'text', text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }
    ] } });
  };
  const end = async () => {
    await service.observeSessionEvent('lead', { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '(pass)' }] } } });
    await service.observeSessionEvent('lead', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(async () => (await service.resolveRoom(room.id)).orchestration.state === 'idle');
  };
  return { service, room, alice, bob, child, dispatch, open, end };
}

test('native Team messages during a group turn belong to the receiving person and current reset episode', async t => {
  const h = await setup(t);
  await h.service.observeSessionEvent('native-child', peer('child-private', 'PRIVATE_CHILD_WORK'));
  await h.service.observeSessionEvent('lead', peer('prior', 'PRIOR_EPISODE'));
  await h.service.startRun(h.room.id, { arm: 'reset_per_episode', appliedBy: 'human' });
  const call = await h.dispatch(); await h.open(call);
  await h.service.observeSessionEvent('lead', peer('peer-first', 'SHARED_FINDING'));
  await h.service.observeSessionEvent('lead', peer('peer-second', 'SHARED_FINDING'));
  const memory = await h.service.agentMemory('lead');
  assert.match(JSON.stringify(memory), /SHARED_FINDING/);
  assert.doesNotMatch(JSON.stringify(memory), /PRIVATE_CHILD_WORK|PRIOR_EPISODE/);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('other')), /SHARED_FINDING/);
  const receipts = (await h.service.eventsFor(h.room.id)).filter(event => event.type === 'memory.observed' && event.payload.items?.some(item => item.text.includes('SHARED_FINDING')));
  assert.equal(receipts.length, 2, 'different observed messages are not deduplicated by text');
  assert.ok(receipts.every(event => event.payload.observerAgentId === h.alice.id && event.payload.sessionId === 'lead'));
  assert.notEqual(receipts[0].payload.items[0].id, receipts[1].payload.items[0].id);
  for (const id of ['repeat-one', 'repeat-two']) await h.service.observeSessionEvent('lead', {
    type: 'user/message', data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'IDENTICAL_OBSERVED_TEXT' }] }
  });
  const repeated = (await h.service.eventsFor(h.room.id)).filter(event => event.type === 'memory.observed'
    && event.payload.items?.some(item => item.text === 'IDENTICAL_OBSERVED_TEXT'));
  assert.equal(repeated.length, 2, 'identical visible text still has distinct observation receipts');
  assert.notEqual(repeated[0].payload.items[0].id, repeated[1].payload.items[0].id);
  await h.end();
  assert.match(JSON.stringify(await h.service.agentMemory('alice-elsewhere')), /SHARED_FINDING/);
});

test('queued group delivery does not erase a native message observed before its marker', async t => {
  const h = await setup(t);
  const call = await h.dispatch();
  await h.service.observeSessionEvent('lead', peer('before-marker', 'SEEN_BEFORE_GROUP'));
  assert.match(JSON.stringify(await h.service.agentMemory('alice-elsewhere')), /SEEN_BEFORE_GROUP/);
  const events = await h.service.journal.readEvents(nativeMemorySource(h.alice.id));
  assert.ok(events.some(event => event.payload?.items?.some(item => item.text.includes('SEEN_BEFORE_GROUP'))));
  await h.open(call); await h.end();
});

test('queued delivery preserves a native turn user, tool output and answer but fences late output', async t => {
  const h = await setup(t), call = await h.dispatch();
  const output = (type, turn, text) => ({ type, data: { turn, step: 1, message: {
    id: text, role: type === 'tool/result' ? 'tool' : 'assistant',
    ...(type === 'tool/result' ? { source: { kind: 'tool', callId: text }, toolCallId: text, isError: false } : {}),
    content: [{ type: 'text', text }]
  } } });
  await h.service.observeSessionEvent('lead', { type: 'turn/start', data: { turn: 0 } });
  await h.service.observeSessionEvent('lead', peer('queued-native-input', 'QUEUED_NATIVE_USER'));
  await h.service.observeSessionEvent('lead', output('tool/result', 0, 'QUEUED_NATIVE_TOOL'));
  await h.service.observeSessionEvent('lead', output('assistant/message', 0, 'QUEUED_NATIVE_ANSWER'));
  const memory = JSON.stringify(await h.service.agentMemory('alice-elsewhere'));
  for (const text of ['QUEUED_NATIVE_USER', 'QUEUED_NATIVE_TOOL', 'QUEUED_NATIVE_ANSWER']) assert.ok(memory.includes(text), text);
  await h.service.observeSessionEvent('lead', { type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } });
  const before = h.service.logHealth().memory.coverage.ambiguousIdentityEvents;
  await h.service.observeSessionEvent('lead', output('tool/result', 0, 'LATE_AFTER_END'));
  await h.service.observeSessionEvent('lead', { type: 'turn/start', data: { turn: 2 } });
  await h.service.observeSessionEvent('lead', output('assistant/message', 0, 'LATE_FROM_PRIOR_TURN'));
  await h.service.observeSessionEvent('lead', output('assistant/message', undefined, 'MISSING_TURN'));
  assert.equal(h.service.logHealth().memory.coverage.ambiguousIdentityEvents, before + 3);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('alice-elsewhere')), /LATE_AFTER_END|LATE_FROM_PRIOR_TURN|MISSING_TURN/);
  await h.open(call); await h.end();
});

test('queued native output never guesses among multiple bound identities', async t => {
  const h = await setup(t);
  await h.service.createRoom({ name: 'another identity', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 'lead', alias: 'Bob', agentId: h.bob.id }] });
  const call = await h.dispatch();
  await h.service.observeSessionEvent('lead', { type: 'turn/start', data: { turn: 0 } });
  const before = h.service.logHealth().memory.coverage.ambiguousIdentityEvents;
  await h.service.observeSessionEvent('lead', { type: 'assistant/message', data: { turn: 0, step: 1,
    message: { id: 'ambiguous-output', content: [{ type: 'text', text: 'UNOWNED_NATIVE_OUTPUT' }] } } });
  assert.equal(h.service.logHealth().memory.coverage.ambiguousIdentityEvents, before + 1);
  for (const id of ['alice-elsewhere', 'other']) assert.doesNotMatch(JSON.stringify(await h.service.agentMemory(id)), /UNOWNED_NATIVE_OUTPUT/);
  await h.open(call); await h.end();
});

test('toolCallId compatibility fallback cannot recapture the plugin own recall as new evidence', async t => {
  const h = await setup(t), call = await h.dispatch();
  await h.service.observeSessionEvent('lead', { type: 'turn/start', data: { turn: 0 } });
  const before = h.service.logHealth().memory.coverage.excludedRecallEvents;
  await h.service.observeSessionEvent('lead', { type: 'tool/call', data: { turn: 0, callId: 'compat-recall', name: 'chat_recall' } });
  // Real V4 also carries source.callId. Keep the supported top-level fallback
  // consistent for older/embedded message producers that omit source.
  await h.service.observeSessionEvent('lead', { type: 'tool/result', data: { turn: 0, step: 1, message: {
    id: 'compat-recall-result', role: 'tool', toolCallId: 'compat-recall', isError: false,
    content: [{ type: 'text', text: 'SELF_RECALL_MUST_NOT_BECOME_EVIDENCE' }]
  } } });
  assert.equal(h.service.logHealth().memory.coverage.excludedRecallEvents, before + 1);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('alice-elsewhere')), /SELF_RECALL_MUST_NOT_BECOME_EVIDENCE/);
  await h.open(call); await h.end();
});

test('an active capture selects its receiver without borrowing another historical identity', async t => {
  const h = await setup(t);
  await h.service.createRoom({ name: 'different person in same Session', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 'lead', alias: 'Bob', agentId: h.bob.id }] });
  const call = await h.dispatch(); await h.open(call);
  await h.service.observeSessionEvent('lead', peer('bound-peer', 'ONLY_CURRENT_RECEIVER'));
  assert.match(JSON.stringify(await h.service.agentMemory('lead')), /ONLY_CURRENT_RECEIVER/);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('other')), /ONLY_CURRENT_RECEIVER/);
  await h.end();
});

test('ambiguous, stale and unmatched group captures reject new attribution and count the omission', async t => {
  const h = await setup(t);
  const call = await h.dispatch(); await h.open(call);
  const lock = h.service.policyLocks.get('lead');
  for (const patch of [{ ambiguous: true }, { stale: true }, { captureId: 'missing-capture' }]) {
    h.service.policyLocks.set('lead', { ...lock, ...patch });
    const before = h.service.logHealth().memory.coverage.ambiguousIdentityEvents;
    await h.service.observeSessionEvent('lead', peer(`reject-${before}`, 'UNATTRIBUTABLE_PEER'));
    assert.equal(h.service.logHealth().memory.coverage.ambiguousIdentityEvents, before + 1);
  }
  h.service.policyLocks.set('lead', lock);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('lead')), /UNATTRIBUTABLE_PEER/);
  await h.end();
});

test('group-turn native snapshots still exclude the plugin own recalled context', async t => {
  const h = await setup(t);
  const call = await h.dispatch(); await h.open(call);
  await h.service.observeSessionEvent('lead', { type: 'user/message', data: { id: 'runtime-snapshot',
    content: [{ type: 'text', text: 'SELF_RECALL\nCURRENT_WORKSPACE' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [
      { name: 'dsh-chat-local:person', text: 'SELF_RECALL' }, { name: 'workspace', text: 'CURRENT_WORKSPACE' }
    ] }
  } });
  const memory = JSON.stringify(await h.service.agentMemory('lead'));
  assert.match(memory, /CURRENT_WORKSPACE/); assert.doesNotMatch(memory, /SELF_RECALL/);
  await h.end();
});

test('flat native tool outcome is authoritative while legacy nested results remain readable', () => {
  for (const isError of [true, false]) {
    const item = observedSessionItems({ type: 'tool/result', data: { message: {
      id: 'tool-message', role: 'tool', toolCallId: 'call', source: { kind: 'tool', callId: 'call' },
      isError, content: [{ type: 'text', text: 'result text' }]
    } } })[0];
    assert.equal(item.isError, isError); assert.equal(item.toolCallId, 'call');
  }
  assert.equal(observedSessionItems({ type: 'tool/result', data: { message: { content: [
    { type: 'tool-result', toolCallId: 'legacy', isError: true, content: [{ type: 'text', text: 'legacy error' }] }
  ] } } })[0].isError, true);
  assert.equal(observedSessionItems({ type: 'tool/result', data: { message: { isError: false, content: [
    { type: 'tool-result', toolCallId: 'legacy', isError: true, content: [{ type: 'text', text: 'legacy error' }] }
  ] } } })[0].isError, false, 'the current explicit outcome takes precedence over an old wrapper');
});

const modules = process.env.DSH_MODULES_DIR;
test('installed native message constructors preserve Team observations and failed tool metadata', {
  skip: !modules && 'set DSH_MODULES_DIR to test installed host messages'
}, async t => {
  const { createUserMessage, createToolResultMessage } = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-llm/lib/index.js')).href);
  const h = await setup(t); const call = await h.dispatch(); await h.open(call);
  const input = peer('native-created', 'REAL_HOST_PEER').data;
  await h.service.observeSessionEvent('lead', { type: 'user/message', data: createUserMessage({ source: input.source, content: input.content }) });
  await h.service.observeSessionEvent('lead', { type: 'tool/result', seq: 12, data: { turn: 1, step: 1,
    message: createToolResultMessage({ callId: 'native-failure', isError: true, content: [{ type: 'text', text: 'Native failure' }] })
  } });
  const events = await h.service.eventsFor(h.room.id);
  assert.ok(events.some(event => event.payload?.items?.some(item => item.text.includes('REAL_HOST_PEER'))));
  assert.ok(events.some(event => event.payload?.items?.some(item => item.toolCallId === 'native-failure' && item.isError === true)));
  await h.end();
});
