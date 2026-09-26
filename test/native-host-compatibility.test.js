import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../lib/index.js';
import { NativeHostCompatibility } from '../lib/host-compatibility.js';
import { classifyToolExecution } from '../lib/gate.js';

const modules = process.env.DSH_MODULES_DIR;
const native = { skip: !modules && 'set DSH_MODULES_DIR to test installed scoped Host capabilities', timeout: 10000 };
const host = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')));
async function until(read, message) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail(message);
}
async function fixture(t, { ptc = false, ownPtc = false, replyTimeoutMs = 3000 } = {}) {
  const [{ Context }, system, { default: Tools }, { createScope }, { agentEvents }, llm, persona] = await Promise.all([
    host('cordis'), host('dsh-system-prompt'), host('dsh-tools'), host('dsh-scope'), host('dsh-agent'), host('dsh-llm'), host('dsh-persona')
  ]);
  const ctx = new Context(), directory = await mkdtemp(join(tmpdir(), 'dcl-scoped-host-'));
  const calls = [], canceled = [];
  const agent = { id: 'scope-person', session: { id: 'scope-person', header: { cwd: directory } },
    status: 'idle', cancel(cause) { canceled.push(cause); } };
  ctx.provide('webServer', { register() { return () => {}; } });
  ctx.provide('sessions', { get(id) { return id === agent.id ? agent.session : undefined; } });
  ctx.provide('agents', { get(id) { return id === agent.id ? agent : undefined; } });
  ctx.provide('sessionTitle', { get() {} }); ctx.provide('sessionQuery', {});
  ctx.provide('dshBridge', { async status() { return { state: 'idle' }; },
    async deliverExternal(from, to, text, delivery) {
      calls.push({ to, delivery, message: llm.createUserMessage({ content: [{ type: 'text',
        text: `[dsh-bridge ${delivery.transport} message ${delivery.id} from ${from}]\n${text}` }], source: { kind: 'plugin', plugin: 'dsh-bridge', form: 'relay' } }) });
    } });
  await ctx.plugin(system.default, {}); await ctx.plugin(Tools, {});
  let writes = 0;
  ctx.tools.register({ name: 'write', description: 'isolated write sentinel', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute() { writes++; return 'unexpected write'; } });
  ctx.provide('ptcRuntime', { language: 'typescript', isolation: 'fixture', executionInstructions: '',
    resolve() { throw Error('arbitrary code must never execute in this fixture'); },
    run() { throw Error('arbitrary code must never execute in this fixture'); } });
  let scope, parent;
  const preset = {};
  await ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(scopedCtx) {
    parent = createScope(scopedCtx, preset);
    if (ptc && !ownPtc) parent.ctx.tools.presentAs('ptc');
    scope = createScope(scopedCtx, agent, { parent: preset }); agent.ctx = scope.ctx;
    if (ownPtc) agent.ctx.tools.presentAs('ptc');
  } });
  let service;
  const fiber = ctx.plugin({ name: 'scoped-chat-fixture', inject: plugin.inject,
    apply(mountCtx, config) { service = plugin.apply(mountCtx, config); } }, { path: join(directory, 'store', 'rooms.json'), replyTimeoutMs });
  await fiber;
  t.after(async () => { await fiber.dispose(); await scope.dispose(); await parent.dispose(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); });
  const room = await service.createRoom({ name: 'Scoped fixture', autoDeliver: true,
    members: [{ kind: 'session', sessionId: agent.id, alias: 'Person' }] });
  const dispatch = agentEvents(ctx, agent);
  const sessionEvent = async event => {
    ctx.emit('session/event', agent.session, event);
    await Promise.resolve(); await Promise.resolve();
  };
  const send = async () => { await service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: 'Read the provided material.' });
    await until(() => calls.length > 0, 'delivery queued'); return calls.at(-1); };
  const claim = async call => {
    await sessionEvent({ type: 'turn/start', data: { turn: 1 } });
    await until(() => service.turnBySession.get(agent.id) === 1, 'turn start observed');
    dispatch.emit('agent/inbox/claimed', { message: call.message, turn: 1 });
  };
  const consume = async call => { await sessionEvent({ type: 'user/message', data: call.message });
    await until(() => service.policyLocks.get(agent.id)?.active, 'group guard armed'); };
  return { ctx, service, agent, room, directory, calls, canceled, system, persona, scope, parent, fiber, dispatch, writes: () => writes,
    sessionEvent, send, claim, consume, assemble: () => ctx.systemPrompt.assemble({ agent, scope: agent }),
    execute: (name, args = {}) => ctx.tools.execute({ callId: `fixture-${name}`, name, arguments: args, agent, signal: new AbortController().signal }) };
}

test('actual Host minimal policy is reported without bypassing suppression and restores after preset disposal', native, async t => {
  const h = await fixture(t);
  const identity = await h.service.agentIdentity(h.agent.id);
  await h.service.directory.savePersona(identity.agentId, { markdown: '# Person\nKeep {{literal}} and PRIVATE_PERSON_MARKER.', expectedHash: identity.persona.hash });
  assert.equal(h.service.nativeContextStatus(h.agent.id).state, 'not_observed');
  let assembly = await h.assemble();
  assert.match(h.system.renderContextSnapshot(assembly), /PRIVATE_PERSON_MARKER/);
  assert.equal((await h.service.agentIdentity(h.agent.id)).nativeContext.state, 'available');
  const minimal = h.agent.ctx.plugin(h.persona, { prefix: 'You are a helpful software engineer assistant.', complete: true, includeRuntimeContext: false }); await minimal;
  assembly = await h.assemble();
  assert.equal(h.system.renderContextSnapshot(assembly), '');
  assert.equal(assembly.variables.dsh_chat_person_context, undefined, 'do not generate a discarded injection');
  assert.equal((await h.service.listParticipants(h.room.id))[0].nativeContext.state, 'suppressed');
  assert.equal(h.service.logHealth().memory.nativeContext.suppressed, 1);
  const own = await h.ctx.tools.get('chat_identity', h.agent).execute({}, { agent: h.agent });
  assert.match(own.persona.markdown, /PRIVATE_PERSON_MARKER/, 'explicit reads remain available');
  await minimal.dispose();
  assembly = await h.assemble();
  assert.match(h.system.renderContextSnapshot(assembly), /PRIVATE_PERSON_MARKER/);
  assert.equal(h.service.nativeContextStatus(h.agent.id).state, 'available');
});

test('actual PTC Host exposes native group tools only after exact inbox claim and restores after turn end', native, async t => {
  const h = await fixture(t, { ptc: true });
  const call = await h.send();
  assert.equal(h.ctx.tools.modeFor(h.agent), 'ptc', 'queued delivery must not change an unrelated native turn');
  h.dispatch.emit('agent/inbox/claimed', { message: { content: [{ type: 'text', text: 'unrelated native input' }] }, turn: 1 });
  assert.equal(h.ctx.tools.modeFor(h.agent), 'ptc');
  await h.claim(call);
  assert.equal(h.ctx.tools.modeFor(h.agent), 'native', 'switch occurs before prompt assembly');
  assert.ok((await h.assemble()).tools.some(tool => tool.name === 'chat_memory'));
  await h.consume(call);
  const read = await h.execute('chat_memory', { room: h.room.id });
  assert.equal(read.isError, false, JSON.stringify(read));
  const code = await h.execute('run_code', { code: 'return 1;' });
  assert.equal(code.isError, true);
  const write = await h.execute('write', { file_path: join(h.directory, 'unsafe.txt'), content: 'not allowed' });
  assert.equal(write.isError, true, 'native presentation does not widen permissions');
  assert.match(JSON.stringify(write), /非只读工具 write/);
  assert.equal(h.writes(), 0);
  for (const name of ['team_task_list', 'team_task_get', 'wait_agent']) {
    assert.equal(h.service.guardToolExecution({ name, arguments: {}, agent: h.agent }), undefined);
    assert.equal(classifyToolExecution(name, {}).action, 'read');
  }
  await h.sessionEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(h.ctx.tools.modeFor(h.agent), 'ptc');
  await until(() => h.service.pending.size === 0, 'capture settled');
  assert.deepEqual((await h.assemble()).tools.map(tool => tool.name), ['run_code']);
});

for (const ending of ['abort', 'dispose', 'supersede', 'timeout', 'agent-disposed']) test(`scoped PTC override restores on ${ending}`, native, async t => {
  const h = await fixture(t, { ptc: true, replyTimeoutMs: ending === 'timeout' ? 500 : 3000 }); const call = await h.send(); await h.claim(call); await h.consume(call);
  assert.equal(h.ctx.tools.modeFor(h.agent), 'native');
  if (ending === 'abort') await h.sessionEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'fixture cancel' } } } });
  else if (ending === 'dispose') await h.fiber.dispose();
  else if (ending === 'timeout') await until(() => h.service.pending.size === 0, 'reply deadline settles capture');
  else if (ending === 'agent-disposed') h.ctx.emit('agent/disposed', { agent: h.agent });
  else await h.service.send({ roomId: h.room.id, author: 'human:me', authorKind: 'human', text: 'New context' });
  assert.equal(h.ctx.tools.modeFor(h.agent), 'ptc');
});

test('conflicting own-scope PTC presentation fails before a model request rather than silently entering a tool deadlock', native, async t => {
  const h = await fixture(t, { ptc: true, ownPtc: true }); const call = await h.send(); await h.claim(call);
  assert.equal(h.ctx.tools.modeFor(h.agent), 'ptc', 'the Host-owned own-scope selection is preserved');
  assert.ok(h.canceled.length > 0);
  await assert.rejects(h.assemble(), /無法為受限群聊準備/);
});

test('context capability cache is bounded and unavailable is distinct from not yet observed', () => {
  const compatibility = new NativeHostCompatibility({});
  assert.equal(compatibility.contextStatus('first').state, 'unavailable');
  compatibility.contextService(true);
  assert.equal(compatibility.contextStatus('first').state, 'not_observed');
  for (let index = 0; index < 1000; index++) compatibility.observeContext(`s${index}`, index % 2 === 0);
  assert.equal(compatibility.health().trackedSessions, 512);
  compatibility.contextService(false);
  assert.equal(compatibility.contextStatus('s999').state, 'unavailable');
});


test('actual Host accepts normalized identity/memory outputs and retains tool failure semantics', native, async t => {
  const h = await fixture(t);
  const identity = await h.execute('chat_identity');
  assert.equal(identity.isError, false, JSON.stringify(identity));
  assert.equal(identity.value.agentId, (await h.service.agentIdentity(h.agent.id)).agentId);
  const memory = await h.execute('chat_memory', { room: h.room.id });
  assert.equal(memory.isError, false, JSON.stringify(memory));
  h.service.roomMemory = async () => ({ nested: { omitted: undefined, kept: 'evidence' }, entries: [{ omitted: undefined, confirmed: false }], absent: null });
  const nested = await h.execute('chat_memory', { room: h.room.id });
  assert.equal(nested.isError, false, JSON.stringify(nested));
  assert.deepEqual(nested.value, { nested: { kept: 'evidence' }, entries: [{ confirmed: false }], absent: null });
  h.service.roomMemory = async () => undefined;
  const missing = await h.execute('chat_memory', { room: h.room.id });
  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing), /returned no JSON value/);
  for (const value of [{ unsafe: NaN }, { entries: [undefined] }]) {
    h.service.roomMemory = async () => value;
    assert.equal((await h.execute('chat_memory', { room: h.room.id })).isError, true, 'invalid evidence is not normalized into null');
  }
  h.service.roomMemory = async () => { throw new Error('fixture authorization failure'); };
  const refused = await h.execute('chat_memory', { room: h.room.id });
  assert.equal(refused.isError, true);
  assert.match(JSON.stringify(refused), /fixture authorization failure/);
});
