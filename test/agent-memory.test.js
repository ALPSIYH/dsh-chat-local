import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { projectAgentMemory, renderPersonalMemory, personalRecallContext, observedSessionItems } from '../lib/agent-memory.js';

test('native surface extraction records visible tool text and rejects private non-surface fields', () => {
  const result = observedSessionItems({ type: 'tool/result', seq: 8, data: { turn: 2, step: 3,
    meta: { text: 'PRIVATE_META' }, message: { id: 'tool-message', source: { kind: 'tool', callId: 'call-1' },
      content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true, content: [
        { type: 'text', text: 'visible result' }, { type: 'reasoning', text: 'PRIVATE_REASONING' },
        { type: 'image', data: 'IMAGE_BYTES' }, { type: 'tool-call', arguments: 'PRIVATE_ARGS' }] }] } } });
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'visible result');
  assert.equal(result[0].id, 'tool-message');
  assert.equal(result[0].toolCallId, 'call-1');
  assert.equal(result[0].isError, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|IMAGE_BYTES/);
  assert.deepEqual(observedSessionItems({ type: 'tool/call', data: { arguments: 'PRIVATE_ARGS' } }), []);
});

test('native surface extraction accepts real and compatibility message shapes with bounded Unicode text', () => {
  for (const event of [
    { type: 'user/message', seq: 4, data: { id: 'user-id', content: [{ type: 'text', text: 'user text' }] } },
    { type: 'user/message', data: { message: { id: 'user-id', content: [{ type: 'text', text: 'user text' }] } } }
  ]) assert.equal(observedSessionItems(event)[0].text, 'user text');
  const long = 'x'.repeat(19998) + '😀tail';
  const item = observedSessionItems({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: long }] } } })[0];
  assert.equal(item.kind, 'authored');
  assert.equal(item.id, undefined);
  assert.equal(item.sourceChars, long.length);
  assert.equal(item.storedChars, item.text.length);
  assert.equal(item.truncated, true);
  assert.ok(item.text.length <= 20000);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(item.text));
});

test('native context extraction excludes its own recalled personality and memory while retaining other sections', () => {
  const event = { type: 'user/message', data: { id: 'snapshot', content: [{ type: 'text', text: 'SELF_RECALL\nexternal current state' }],
    source: { kind: 'plugin', form: 'snapshot', plugin: 'system-prompt', sections: [
      { name: 'dsh-chat-local:person', text: 'SELF_RECALL' }, { name: 'workspace', text: 'external current state' }] } } };
  const items = observedSessionItems(event);
  assert.equal(items[0].text, 'external current state');
  assert.equal(items[0].kind, 'context');
  event.data.source.sections.pop();
  assert.deepEqual(observedSessionItems(event), []);
});

const event = (id, type, payload, at = 1) => ({ id, type, payload, at, tick: at });
const source = (roomId, events) => ({ roomId, events: events.map(item => ({ ...item, provenance: { roomId, ...item.provenance } })) });
const message = (id, text, at = 1) => event(id, 'message.created', { messageId: id, text }, at);
const seen = (id, agentId, messageIds, at = 2) => event(id, 'memory.observed', { observerAgentId: agentId, messageIds }, at);

test('missing authority and a readable empty log have different recall scopes', () => {
  const sources = [source('other', [message('m', 'other work'), seen('receipt', 'person', ['m'])])];
  const context = personalRecallContext({ roomId: 'current' });
  assert.equal(context.authority, 'unavailable');
  assert.deepEqual(projectAgentMemory({ agentId: 'person', sources, context }).experiences, []);
  assert.equal(personalRecallContext({ roomId: 'current', events: [], arm: 'persistent' }), undefined);
  assert.equal(projectAgentMemory({ agentId: 'person', sources }).experiences.length, 1);
  assert.equal(personalRecallContext(), undefined, 'native work without a room has no room authority to resolve');
});

test('reset scope requires a valid clear from its own room and unknown authority always yields no recall', () => {
  const reset = { type: 'relationship.intervention', at: 10, provenance: { roomId: 'current' },
    payload: { action: 'clear', appliedBy: 'arm', memoryScope: 'all', memoryVersion: 2 } };
  assert.deepEqual(personalRecallContext({ roomId: 'current', events: [reset], arm: 'reset_per_episode' }),
    { roomId: 'current', afterAt: 10 });
  const foreign = { ...reset, at: 99, provenance: { roomId: 'other' } };
  assert.deepEqual(personalRecallContext({ roomId: 'current', events: [reset, foreign], arm: 'reset_per_episode' }),
    { roomId: 'current', afterAt: 10 });
  const sources = [source('current', [message('m', 'must remain unavailable', 1e20), seen('r', 'person', ['m'], 1e20)])];
  assert.deepEqual(projectAgentMemory({ agentId: 'person', sources,
    context: personalRecallContext({ roomId: 'current' }) }).experiences, []);
});

test('personal memory follows stable identity across sessions and contains only observed content', () => {
  const sources = [source('room-a', [message('a', 'observed work'), message('hidden', 'never delivered'), seen('s1', 'person-a', ['a'])]),
    source('room-b', [message('b', 'second workspace'), seen('s2', 'person-a', ['b'])]),
    source('room-c', [message('c', 'other person private work'), seen('s3', 'person-b', ['c'])])];
  const memory = projectAgentMemory({ agentId: 'person-a', sources });
  assert.deepEqual(memory.experiences.map(x => x.text).sort(), ['observed work', 'second workspace']);
  assert.equal(JSON.stringify(memory).includes('never delivered'), false);
  assert.equal(JSON.stringify(memory).includes('other person private work'), false);
  assert.equal(memory.experiences.every(x => x.sourceRoomId && x.evidenceId), true);
});

test('personal recall distinguishes corrections, own beliefs and removed evidence', () => {
  const sources = [source('room-a', [message('old', 'wrong claim'), seen('s1', 'a', ['old']),
    event('new', 'message.created', { messageId: 'new', text: 'corrected claim', correctsMessageId: 'old' }, 3), seen('s2', 'a', ['new'], 4),
    event('belief', 'appraisal', { observerId:'s1', aboutAgentId:'s2', observerAgentId:'a', targetAgentId:'b', stance:'trust', confidence:0.8, claim:'my view', evidenceEventIds:['new'], validFrom:4, validTo:null, action:'record' }, 4),
    event('private', 'appraisal', { observerId:'s2', aboutAgentId:'s1', observerAgentId:'b', targetAgentId:'a', stance:'distrust', confidence:0.8, claim:'their private view', evidenceEventIds:['new'], validFrom:4, validTo:null, action:'record' }, 4)])];
  const memory = projectAgentMemory({ agentId:'a', sources });
  assert.equal(memory.experiences.some(x => x.text === 'wrong claim'), false);
  assert.equal(memory.experiences.some(x => x.text === 'corrected claim'), true);
  assert.equal(memory.judgements.length, 1);
  assert.equal(memory.judgements[0].claim, 'my view');
  assert.equal(JSON.stringify(memory).includes('their private view'), false);
  sources[0].events = sources[0].events.filter(e => e.id !== 'new');
  assert.equal(projectAgentMemory({agentId:'a',sources}).judgements.length,0);
});

test('reset context excludes earlier personal memory without deleting its history', () => {
  const sources=[source('prior-room',[message('a','past'),seen('x','person',['a'])]),
    source('current',[message('b','current episode',6),seen('y','person',['b'],7)])];
  const memory=projectAgentMemory({agentId:'person',sources,context:{roomId:'current',afterAt:5}});
  assert.deepEqual(memory.experiences.map(x=>x.text),['current episode']);
  assert.equal(projectAgentMemory({agentId:'person',sources}).experiences.length,2);
});

test('personal injection is bounded and identifies selected evidence and omitted count', () => {
  const memory={experiences:Array.from({length:30},(_,i)=>({text:'x'.repeat(500),sourceRoomId:`r${i}`,evidenceId:`e${i}`})),judgements:[]};
  const digest=renderPersonalMemory(memory);
  assert.ok(digest.text.length<=600);
  assert.ok(digest.metadata.omitted>0);
  assert.ok(digest.metadata.selected.length>0);
  assert.match(digest.text,/個人經歷/);
});


test('personal sources reject foreign and missing event provenance before indexing evidence', () => {
  const room = source('allowed', [message('allowed', 'seen here'),
    { ...message('foreign', 'OTHER_ROOM_SECRET'), provenance: { roomId: 'other' } },
    seen('receipt', 'a', ['allowed', 'foreign', 'legacy'])]);
  room.events.push(message('legacy', 'UNKNOWN_ORIGIN'));
  room.events.push({ ...seen('foreign-receipt', 'a', []), provenance: { roomId: 'other' },
    payload: { observerAgentId: 'a', items: [{ id: 'x', text: 'FOREIGN_RECEIPT' }] } });
  const memory = projectAgentMemory({ agentId: 'a', sources: [room] });
  assert.deepEqual(memory.experiences.map(item => item.text), ['seen here']);
  assert.equal(memory.coverage.excludedProvenanceEvents, 3);
});

test('personal recall bounds source text and states exactly what was shortened', () => {
  const long = 'x'.repeat(1998) + '😀' + 'tail'.repeat(1000);
  const receipts = source('room', [message('message', long), seen('seen', 'a', ['message']),
    event('item-receipt', 'memory.observed', { observerAgentId: 'a', items: [{ id: 'item', kind: 'tool', text: long }] }, 3)]);
  const memory = projectAgentMemory({ agentId: 'a', sources: [receipts] });
  assert.equal(memory.experiences.length, 2);
  for (const item of memory.experiences) {
    assert.ok(item.text.length <= 2000);
    assert.equal(item.truncated, true);
    assert.equal(item.sourceChars, long.length);
    assert.equal(item.recalledChars, item.text.length);
    assert.ok(item.evidenceId && item.sourceRoomId);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(item.text));
  }
});

test('personal judgment injection retains its target, confidence and dated provenance', () => {
  const memory = { judgements: [{ kind: 'judgement', targetAgentId: 'agent-bob', claim: 'reliable', stance: 'trust',
    confidence: 0.2, evidenceIds: ['evidence'], evidenceId: 'appraisal-id', sourceRoomId: 'old-room', at: 1234 }], experiences: [] };
  const result = renderPersonalMemory(memory);
  for (const text of ['agent-bob', '0.2', 'old-room', '1234', 'appraisal-id']) assert.ok(result.text.includes(text), text);
  assert.equal(result.metadata.selected[0].targetAgentId, 'agent-bob');
  assert.equal(result.metadata.selected[0].confidence, 0.2);
  assert.equal(result.metadata.selected[0].at, 1234);
});

test('personal renderer preserves Unicode boundaries and enforces its maximum budget', () => {
  const memory = { experiences: Array.from({ length: 10 }, (_, i) => ({ kind: 'message', text: 'x'.repeat(138) + '😀tail',
    evidenceId: `e${i}`, sourceRoomId: 'room', at: i })), judgements: [] };
  const result = renderPersonalMemory(memory, { maxChars: 100000 });
  assert.ok(result.text.length <= 600);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(result.text));
});

test('recall ranking does not depend on the host locale', () => {
  const moduleUrl = new URL('../lib/agent-memory.js', import.meta.url).href;
  const script = `import {projectAgentMemory} from ${JSON.stringify(moduleUrl)};
    const nativeLocaleCase = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function() { return nativeLocaleCase.call(this, process.env.RECALL_TEST_LOCALE); };
    const source={roomId:'r',events:[
      {id:'a',type:'message.created',at:1,payload:{messageId:'a',text:'Istanbul'},provenance:{roomId:'r'}},
      {id:'b',type:'message.created',at:2,payload:{messageId:'b',text:'other'},provenance:{roomId:'r'}},
      {id:'s',type:'memory.observed',at:3,payload:{observerAgentId:'me',messageIds:['a','b']},provenance:{roomId:'r'}}]};
    console.log(JSON.stringify(projectAgentMemory({agentId:'me',sources:[source],query:'istanbul'}).experiences.map(x=>x.evidenceId)));`;
  const invoke = locale => execFileSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, RECALL_TEST_LOCALE: locale } }).trim();
  assert.equal(invoke('en-US'), '["a","b"]');
  assert.equal(invoke('tr'), '["a","b"]');
});


test('another identity reusing a Session cannot replace this identity own prior belief', () => {
  const belief = (id, observerAgentId, claim, at) => event(id, 'appraisal', { observerId: 'reused-session', aboutAgentId: 'target-session',
    observerAgentId, targetAgentId: 'target', stance: 'neutral', confidence: 0.5, claim, evidenceEventIds: ['e'], validFrom: at, validTo: null, action: 'record' }, at);
  const input = source('room', [message('e', 'evidence'), belief('old', 'alice', 'Alice view', 2), belief('new', 'bob', 'Bob view', 3)]);
  assert.deepEqual(projectAgentMemory({ agentId: 'alice', sources: [input] }).judgements.map(item => item.claim), ['Alice view']);
});

test('target Session reuse keeps views of separate identities and revokes only its named identity', () => {
  const belief = (id, targetAgentId, at, action = 'record') => event(id, 'appraisal', { observerId: 'session', aboutAgentId: 'reused-target',
    observerAgentId: 'alice', targetAgentId, stance: 'neutral', confidence: 0.5, claim: id, evidenceEventIds: ['e'],
    validFrom: at, validTo: null, action, ...(action === 'revoke' ? { revokesAppraisalId: 'view of charlie' } : {}) }, at);
  const input = source('room', [message('e', 'evidence'), belief('view of bob', 'bob', 2), belief('view of charlie', 'charlie', 3),
    belief('charlie revoked', 'charlie', 4, 'revoke')]);
  assert.deepEqual(projectAgentMemory({ agentId: 'alice', sources: [input] }).judgements.map(item => item.claim), ['view of bob']);
});

test('personal digest accounts for recall-limit omissions as well as rendering omissions', () => {
  const memory = { experiences: [{ kind: 'message', text: 'visible', evidenceId: 'e', sourceRoomId: 'r', at: 1 }], judgements: [],
    totals: { experiences: 30, judgements: 0 } };
  const digest = renderPersonalMemory(memory);
  assert.equal(digest.metadata.selected.length, 1);
  assert.equal(digest.metadata.omitted, 29);
  assert.equal(digest.metadata.omittedByRecallLimit, 29);
});

test('personal reset clears source observations but retains later reobservations of older messages', () => {
  const reset = event('reset', 'relationship.intervention', { action: 'clear', memoryScope: 'all', memoryVersion: 2 }, 5);
  const input = source('room', [message('old', 'old message newly seen'), message('forgotten', 'old receipt only'),
    seen('before', 'a', ['old', 'forgotten'], 2), reset, seen('after', 'a', ['old'], 6)]);
  const otherRoom = source('other', [message('unaffected', 'another source'), seen('other-receipt', 'a', ['unaffected'], 2)]);
  assert.deepEqual(projectAgentMemory({ agentId: 'a', sources: [input, otherRoom] }).experiences.map(item => item.text).sort(),
    ['another source', 'old message newly seen']);
  assert.deepEqual(projectAgentMemory({ agentId: 'a', sources: [input, otherRoom], context: { roomId: 'room', afterAt: 5 } })
    .experiences.map(item => item.text), ['old message newly seen']);
  assert.equal(input.events.length, 5);
});

test('legacy counter-only and unknown future reset versions do not clear personal observations', () => {
  for (const payload of [{ action: 'clear' }, { action: 'clear', memoryScope: 'all', memoryVersion: 3 }]) {
    const input = source('room', [message('old', 'retained'), seen('before', 'a', ['old'], 2),
      event('reset', 'relationship.intervention', payload, 5)]);
    assert.deepEqual(projectAgentMemory({ agentId: 'a', sources: [input] }).experiences.map(item => item.text), ['retained']);
  }
});

test('own observed item ids can support personal judgments without borrowing another observers receipt', () => {
  const belief = (id, evidenceEventIds, at) => event(id, 'appraisal', { observerId: 'session', aboutAgentId: 'target-session',
    observerAgentId: 'a', targetAgentId: 'target', stance: 'neutral', confidence: 0.5, claim: id, evidenceEventIds,
    validFrom: at, validTo: null, action: 'record' }, at);
  const input = source('room', [event('receipt', 'memory.observed', { observerAgentId: 'a', items: [{ id: 'document', text: 'read document' }] }, 2),
    event('private-receipt', 'memory.observed', { observerAgentId: 'b', items: [{ id: 'private-document', text: 'private' }] }, 2),
    belief('own document view', ['document'], 3)]);
  assert.deepEqual(projectAgentMemory({ agentId: 'a', sources: [input] }).judgements.map(item => item.claim), ['own document view']);
  input.events.push({ ...belief('private document view', ['private-document'], 4), provenance: { roomId: 'room' } });
  assert.equal(projectAgentMemory({ agentId: 'a', sources: [input] }).judgements.length, 0);
});

test('disabled appraisal injection applies to personal judgments too, with policy omissions separate from budget', () => {
  const memory={judgements:[{kind:'judgement',claim:'SHOULD_NOT_INJECT',targetAgentId:'person',confidence:0.9,sourceRoomId:'r',evidenceId:'a',at:1}],experiences:[],totals:{judgements:1,experiences:0}};
  const digest=renderPersonalMemory(memory,{includeJudgements:false});
  assert.equal(digest.text,null);assert.equal(digest.metadata.omittedByPolicy,1);
  assert.equal(digest.metadata.omittedByRecallLimit,0);assert.equal(digest.metadata.omittedByBudget,0);
});
