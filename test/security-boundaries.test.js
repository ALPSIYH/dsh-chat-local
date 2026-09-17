// Security and data-integrity boundaries. All writes target newly created fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { DshChatLocalService } from '../lib/room-store.js';
import { apply } from '../lib/index.js';

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('delivery did not start');
}
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-boundary-'));
  const calls = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: {
      status: async () => ({ state: 'idle' }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); }
    },
    get(name) { return this[name]; }
  };
  const path = join(directory, 'rooms.json');
  const service = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = () => service.createRoom({ name: '边界测试', autoDeliver: true,
    members: [{ kind: 'session', sessionId: 's1', alias: '成员' }] });
  // Open the restricted turn that a delivered message starts for the member.
  const activate = async (call) => {
    await service.observeSessionEvent('s1', { type: 'turn/start', data: { turn: 1 } });
    await service.observeSessionEvent('s1', { type: 'user/message', data: { content: [{ type: 'text', text:
      `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] } });
  };
  return { directory, path, service, calls, room, activate };
}

test('a restricted group turn cannot read the group state file or reach a local service', async () => {
  const h = await harness();
  const room = await h.room();
  await h.service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: '开始' });
  await waitFor(() => h.calls.length === 1);
  await h.activate(h.calls[0]);
  const exec = (name, args) => ({ name, arguments: args, agent: { session: { id: 's1' } } });
  // The group's own state file holds every room at once.
  assert.match(h.service.guardToolExecution(exec('read', { path: h.path })), /受限模式/);
  assert.match(h.service.guardToolExecution(exec('read', { path: '~/.dsh/dsh-chat-local/rooms.json' })), /受限模式/);
  // grep/glob are not on the read-only list at all, so they are refused outright.
  assert.match(h.service.guardToolExecution(exec('grep', { path: h.directory, pattern: 'x' })), /非只读工具/);
  // The plugin's own HTTP API answers on loopback without credentials.
  assert.match(h.service.guardToolExecution(exec('web_fetch', { url: 'http://127.0.0.1:3080/api/dsh-chat-local/rooms' })), /受限模式/);
  assert.match(h.service.guardToolExecution(exec('web_fetch', { url: 'http://192.168.1.9:3080/' })), /受限模式/);
  assert.match(h.service.guardToolExecution(exec('fetch', { url: 'http://169.254.169.254/latest/meta-data/' })), /受限模式/);
  // Ordinary reading, and public web reading, stay available.
  const elsewhere = await mkdtemp(join(tmpdir(), 'dcl-notes-'));
  assert.equal(h.service.guardToolExecution(exec('read', { path: join(elsewhere, 'notes.txt') })), undefined);
  assert.equal(h.service.guardToolExecution(exec('web_search', { query: 'journal ranking' })), undefined);
  assert.equal(h.service.guardToolExecution(exec('web_fetch', { url: 'https://example.com/paper' })), undefined);
  // Writing is still refused outright.
  assert.match(h.service.guardToolExecution(exec('bash', { command: 'echo x' })), /Host 已拒绝非只读工具/);
});

test('updating only the charter keeps the room purpose', async () => {
  const h = await harness();
  const room = await h.service.createRoom({ name: '章程', autoDeliver: false,
    members: [{ kind: 'session', sessionId: 's1', alias: '成员' }],
    profile: { purpose: '原始目的', charter: '原始章程' } });
  assert.equal(room.profile.purpose, '原始目的');
  const updated = await h.service.setRoomProfile(room.id, { charter: '新章程', expectedRevision: room.profile.revision });
  assert.equal(updated.profile.charter, '新章程');
  assert.equal(updated.profile.purpose, '原始目的');
});

test('a replayed operation re-persists, so a lost write is not reported as durable', async () => {
  const h = await harness();
  const room = await h.room();
  const entry = await h.service.createLedgerEntry(room.id, { kind: 'task', title: '边界任务' });
  const first = await h.service.triageLedgerEntry(room.id, entry.id, { action: 'archive', expectedRevision: entry.revision, operationId: 'op-1', note: '归档' });
  assert.equal(first.status, 'archived');
  // Simulate the write the first attempt lost.
  await writeFile(h.path, JSON.stringify({ version: 15, rooms: [], groups: [], workspace: {} }));
  const replay = await h.service.triageLedgerEntry(room.id, entry.id, { action: 'archive', expectedRevision: entry.revision, operationId: 'op-1', note: '归档' });
  assert.equal(replay.status, 'archived');
  assert.match(await readFile(h.path, 'utf8'), new RegExp(entry.id), 'the replay must re-persist the applied change');
});

test('correcting the same message twice with one operation id stays idempotent', async () => {
  const h = await harness();
  const room = await h.room();
  const message = await h.service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: '初稿' });
  // The correction's recipients come from the message's live deliveries, so the
  // precondition below only holds once the delivery actually started.
  await waitFor(() => h.calls.length === 1);
  const args = { text: '修正稿', clientOperationId: 'corr-1' };
  const once = await h.service.correctHumanMessage(room.id, message.id, args);
  assert.equal(once.mentions.length, 1);
  const twice = await h.service.correctHumanMessage(room.id, message.id, args);
  assert.equal(twice.id, once.id);
});

test('a state migration keeps the pre-migration file as a backup', async () => {
  const h = await harness();
  await h.room();
  const legacy = JSON.parse(await readFile(h.path, 'utf8'));
  legacy.version = 13;
  await writeFile(h.path, JSON.stringify(legacy));
  const next = new DshChatLocalService({
    agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  }, { path: h.path, maxRounds: 1, replyTimeoutMs: 1000 });
  await next.ready;
  assert.equal(JSON.parse(await readFile(`${h.path}.v13.bak`, 'utf8')).version, 13);
  await next.close();
});

test('the HTTP surface rejects cross-site requests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-csrf-'));
  let handler;
  const disposers = [];
  apply({ effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
    on() {}, tools: { register() {}, guard() {} }, webServer: { register(route) { handler = route.handler; } } },
    { path: join(directory, 'rooms.json') });
  t.after(async () => { for (const dispose of disposers.reverse()) await dispose(); });
  const request = async (headers) => {
    const req = Readable.from([]);
    Object.assign(req, { url: '/api/dsh-chat-local/rooms', method: 'GET', headers: { host: '127.0.0.1:3080', ...headers } });
    const result = {};
    await handler(req, { writeHead(status) { result.status = status; }, end() {} });
    return result.status;
  };
  assert.equal(await request({ origin: 'https://evil.example' }), 403);
  assert.equal(await request({ 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await request({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' }), 200);
  assert.equal(await request({}), 200);
});
