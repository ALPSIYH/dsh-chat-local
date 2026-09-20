import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import * as plugin from '../lib/index.js';
import { observedSessionItems } from '../lib/agent-memory.js';

// Optional integration suite: use the actual installed host without making it
// this plugin's dependency. All persistence and execution surfaces are isolated.
const modules = process.env.DSH_MODULES_DIR;
const options = { skip: !modules && 'set DSH_MODULES_DIR to the installed DSH node_modules', timeout: 10_000 };
const host = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')));
async function until(read, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await read()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail(message);
}
async function mount(t, { prompt = true } = {}) {
  const [{ Context }, system, { default: Tools }] = await Promise.all([host('cordis'), host('dsh-system-prompt'), host('dsh-tools')]);
  const ctx = new Context(), directory = await mkdtemp(join(tmpdir(), 'dcl-real-host-'));
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); });
  let handler, registered = new Map(), guards = new Set();
  ctx.provide('webServer', { register(route) { handler = route.handler; return () => { handler = undefined; }; } });
  ctx.provide('sessions', { get(id) { return { id, header: { id, cwd: directory } }; } });
  ctx.provide('agents', { get() {} });
  ctx.provide('sessionTitle', { get() {} });
  ctx.provide('sessionQuery', {});
  ctx.provide('dshBridge', { async status() { return { state: 'idle' }; }, async deliverExternal() { assert.fail('no model delivery authorized in integration fixture'); } });
  if (prompt) { await ctx.plugin(system.default, {}); await ctx.plugin(Tools, {}); }
  else ctx.provide('tools', { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name); },
    guard(fn) { guards.add(fn); return () => guards.delete(fn); } });
  const statePath = join(directory, 'rooms.json');
  const fiber = ctx.plugin(plugin, { path: statePath });
  await fiber;
  t.after(async () => { await fiber.dispose(); });
  const request = async (path, body) => {
    assert.equal(typeof handler, 'function', 'actual Cordis mount registered HTTP route');
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: body === undefined ? 'GET' : 'POST', url: `/api/dsh-chat-local${path}`, headers: {} });
    let status, text;
    await handler(req, { writeHead(code) { status = code; }, end(value) { text = value; } });
    assert.equal(status, 200, text); return JSON.parse(text).value;
  };
  const tool = name => prompt ? ctx.tools.get(name) : registered.get(name);
  const invoke = (name, session, args = {}) => tool(name).execute(args, { agent: { session: { id: session } } });
  const room = await request('/rooms', { name: 'actual-host-only', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 'runtime-a', alias: 'Runtime A' }, { kind: 'session', sessionId: 'runtime-b', alias: 'Runtime B' }] });
  return { ctx, system, fiber, request, invoke, room, statePath, route: () => handler, registered, guards };
}

test('actual Cordis + ToolRuntime + SystemPrompt mount, literal persona, and complete effect disposal', options, async t => {
  const h = await mount(t);
  const identity = await h.invoke('chat_identity', 'runtime-a');
  const markdown = '# Runtime persona\nRetain literal {{secret}} and {{not_registered}}.';
  await h.request(`/agents/${identity.agentId}/persona`, { markdown, expectedHash: identity.persona.hash });
  const context = { agent: { session: { id: 'runtime-a' } } };
  const assembly = await h.ctx.systemPrompt.assemble(context);
  assert.ok(assembly.tools.some(tool => tool.name === 'chat_recall'), 'real tools contribute schemas to host');
  assert.match(h.system.renderContextSnapshot(assembly), /Retain literal \{\{secret\}\} and \{\{not_registered\}\}/);
  const unknown = await h.ctx.systemPrompt.assemble({ agent: { session: { id: 'unbound-session' } } });
  assert.ok(!unknown.contexts.some(item => item.name === 'dsh-chat-local:person'));
  await h.fiber.dispose();
  assert.equal(h.route(), undefined, 'owned route is removed');
  const after = await h.ctx.systemPrompt.assemble(context);
  assert.ok(!after.tools.some(tool => tool.name.startsWith('chat_')), 'real tool registry has no leaked tools');
  assert.ok(!after.contexts.some(item => item.name === 'dsh-chat-local:person'), 'native hook is disposed');
  const stateBefore = await readFile(h.statePath, 'utf8');
  const eventFiles = () => readdir(join(dirname(h.statePath), 'events')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const eventsBefore = await eventFiles();
  h.ctx.emit('session/event', { id: 'runtime-a' }, { type: 'user/message', data: { content: [{ type: 'text', text: 'after disposal' }] } });
  await new Promise(r => setTimeout(r, 15));
  assert.equal(await readFile(h.statePath, 'utf8'), stateBefore);
  assert.deepEqual(await eventFiles(), eventsBefore, 'disposed session listener cannot create a native observation source');
});

test('actual Cordis mounts without optional SystemPrompt and disposes route/guard', options, async t => {
  const h = await mount(t, { prompt: false });
  assert.equal((await h.invoke('chat_memory', 'runtime-a', { room: h.room.id })).roomId, h.room.id);
  assert.ok(h.registered.size > 10); assert.equal(h.guards.size, 1);
  await h.fiber.dispose();
  assert.equal(h.route(), undefined); assert.equal(h.guards.size, 0);
  // This absent-service host substitutes a plain registry, which does not own
  // effects like real ToolRuntime. Actual registry cleanup is verified above.
});

test('installed DSH message builders travel through actual session/event into private recall', options, async t => {
  const h = await mount(t);
  const { createUserMessage, createAssistantMessage, createToolResultMessage } = await host('dsh-llm');
  const events = [
    { type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: 'runtime user fact' }] }) },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'runtime own answer' }] }) } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: createToolResultMessage({ callId: 'runtime-call', content: [{ type: 'text', text: 'runtime visible tool output' }], isError: false }), meta: { secret: 'opaque metadata must remain absent' } } }
  ];
  for (const [index, event] of events.entries()) {
    assert.ok(observedSessionItems(event).length, `${event.type} real host shape is readable`);
    h.ctx.emit('session/event', { id: 'runtime-a' }, { ...event, seq: index + 1 });
  }
  await until(async () => (await h.invoke('chat_recall', 'runtime-a')).experiences.length === 3, 'real event listener must persist all three observed types');
  const recall = JSON.stringify(await h.invoke('chat_recall', 'runtime-a'));
  assert.match(recall, /runtime user fact/); assert.match(recall, /runtime own answer/); assert.match(recall, /runtime visible tool output/);
  assert.doesNotMatch(recall, /opaque metadata must remain absent/);
  assert.equal((await h.invoke('chat_recall', 'runtime-b')).experiences.length, 0);
});


test('optional SystemPrompt arrival, removal and reappearance owns exactly one hook', options, async t => {
  const h = await mount(t, { prompt: false });
  const identity = await h.invoke('chat_identity', 'runtime-a');
  await h.request(`/agents/${identity.agentId}/persona`, { markdown: '# Dynamic persona', expectedHash: identity.persona.hash });
  const context = { agent: { session: { id: 'runtime-a' } } };
  for (let cycle = 0; cycle < 2; cycle++) {
    const promptFiber = h.ctx.plugin(h.system.default, {}); await promptFiber;
    await until(async () => (await h.ctx.systemPrompt.assemble(context)).contexts.some(x => x.name === 'dsh-chat-local:person'), 'hook activates after optional service arrives');
    const assembly = await h.ctx.systemPrompt.assemble(context);
    assert.equal(assembly.contexts.filter(x => x.name === 'dsh-chat-local:person').length, 1);
    assert.match(h.system.renderContextSnapshot(assembly), /Dynamic persona/);
    await promptFiber.dispose();
    assert.equal(h.ctx.get('systemPrompt'), undefined);
    assert.equal((await h.request('/health')).status, 'ok', 'main plugin survives optional service removal');
  }
});
