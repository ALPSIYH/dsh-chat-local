import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshChatLocalService } from '../lib/room-store.js';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dcl-identity-boundary-'));
  const calls = [];
  const ctx = { agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: 'idle' }), deliverExternal: async (from, to, text, delivery) => calls.push({ from, to, text, delivery }) },
    get(name) { return this[name]; } };
  const service = new DshChatLocalService(ctx, { path: join(dir, 'rooms.json'), maxRounds: 1, replyTimeoutMs: 5000 });
  await service.ready;
  t.after(async () => { await service.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  const people = await Promise.all(['Alice', 'Bob', 'Carol'].map(alias => service.directory.save({ operationId: alias, profile: { alias } })));
  const member = (sessionId, agent = people[0]) => ({ kind: 'session', sessionId, alias: sessionId, agentId: agent.id });
  const room = await service.createRoom({ name: 'Main', autoDeliver: false, members: [member('owner'), member('reviewer', people[1])] });
  let turn = 0;
  const activate = async sessionId => {
    const index = calls.length;
    const message = await service.send({ roomId: room.id, author: 'human:me', authorKind: 'human', text: 'Review the evidence', mentions: [sessionId] });
    const deadline = Date.now() + 5000;
    while (!calls[index] && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    const call = calls[index]; assert.ok(call); turn++;
    await service.observeSessionEvent(sessionId, { type: 'turn/start', data: { turn } });
    await service.observeSessionEvent(sessionId, { type: 'user/message', data: { content: [{ type: 'text', text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
    return message;
  };
  const finish = async sessionId => {
    await service.observeSessionEvent(sessionId, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
    await service.stopRoom(room.id);
  };
  return { service, people, member, room, activate, finish };
}

test('all room creation and join paths reject a second seat for the same stable person before mutation', async t => {
  const h = await setup(t);
  await assert.rejects(h.service.createRoom({ name: 'Duplicate', members: [h.member('a'), h.member('b')] }), /duplicate Agent identity/u);
  assert.equal((await h.service.listRooms()).length, 1);
  const before = await readFile(h.service.path);
  await assert.rejects(h.service.addMember(h.room.id, h.member('second-owner')), /duplicate Agent identity/u);
  assert.deepEqual(await readFile(h.service.path), before);
  assert.deepEqual((await h.service.resolveRoom(h.room.id)).members.map(x => x.sessionId), ['owner', 'reviewer']);
  const live = h.service.state.rooms[0];
  const previous = live.members[1].agentId;
  live.members[1].agentId = live.members[0].agentId;
  await assert.rejects(h.service.setRoomDetails(h.room.id, { name: 'Cannot persist duplicate', expectedRevision: live.revision }), /duplicate Agent identity/u);
  assert.deepEqual(await readFile(h.service.path), before, 'save boundary also refuses invalid identity state');
  live.members[1].agentId = previous;
});

test('load refuses explicit and migration-inferred duplicate identities without rewriting source data', async t => {
  const h = await setup(t);
  await h.service.close();
  const original = JSON.parse(await readFile(h.service.path, 'utf8'));
  for (const inferred of [false, true]) {
    const state = structuredClone(original);
    const room = state.rooms[0];
    if (inferred) {
      delete room.members[1].agentId;
      for (const participation of state.workspace.participations) if (participation.sessionId === 'reviewer') participation.agentId = h.people[0].id;
    } else room.members[1].agentId = room.members[0].agentId;
    const source = JSON.stringify(state);
    await writeFile(h.service.path, source);
    const service = new DshChatLocalService(h.service.ctx, { path: h.service.path });
    await assert.rejects(service.ready, /duplicate Agent identity/u);
    assert.equal(await readFile(h.service.path, 'utf8'), source);
    await service.close().catch(() => {});
  }
});

test('appraisal independently rejects the same stable person even under inconsistent live membership', async t => {
  const h = await setup(t);
  const message = await h.activate('owner');
  const target = h.service.state.rooms[0].members.find(x => x.sessionId === 'reviewer');
  const previous = target.agentId;
  target.agentId = h.people[0].id;
  try {
    await assert.rejects(h.service.appraise(h.room.id, 'owner', { aboutAgentId: 'reviewer', stance: 'trust', confidence: 1, claim: 'Self endorsement', evidenceEventIds: [message.id] }), /cannot appraise themselves/u);
  } finally { target.agentId = previous; }
  await h.finish('owner');
});

test('a returning person cannot become independent reviewer of work they owned in an earlier Session', async t => {
  const h = await setup(t);
  const task = await h.service.createLedgerEntry(h.room.id, { kind: 'task', title: 'Prior work', ownerSessionId: 'owner', reviewerSessionId: 'reviewer' });
  await h.service.removeMember(h.room.id, 'owner');
  await h.service.addMember(h.room.id, h.member('returning-owner'));
  await assert.rejects(h.service.updateLedgerEntry(h.room.id, task.id, { reviewerSessionId: 'returning-owner' }, { expectedRevision: task.revision }), /independent Agent/u);
  const unchanged = (await h.service.listLedger(h.room.id))[0];
  assert.equal(unchanged.ownerSessionId, 'owner');
  assert.equal(unchanged.reviewerSessionId, 'reviewer');
  assert.equal(unchanged.revision, task.revision);
});

test('review checks submission identity after reviewer Session reuse and refuses ambiguous legacy owner history', async t => {
  const h = await setup(t);
  let task = await h.service.createLedgerEntry(h.room.id, { kind: 'task', title: 'Delivery', ownerSessionId: 'owner', reviewerSessionId: 'reviewer' });
  const source = await h.activate('owner');
  const operate = (session, action, input = {}) => h.service.operateWork(h.room.id, session, { operationId: `${session}-${action}`, action, entryId: task.id, expectedRevision: task.revision, summary: action, sourceMessageIds: [source.id], ...input });
  task = await operate('owner', 'acknowledge');
  task = await operate('owner', 'submit', { deliverable: 'Version 1' });
  assert.equal(task.submission.agentId, h.people[0].id);
  await h.finish('owner');
  await h.service.removeMember(h.room.id, 'owner');
  await h.service.removeMember(h.room.id, 'reviewer');
  await h.service.addMember(h.room.id, h.member('reviewer'));
  await h.activate('reviewer');
  await assert.rejects(operate('reviewer', 'review', { verdict: 'approve' }), /independent Agent/u);
  await h.finish('reviewer');
  await h.service.removeMember(h.room.id, 'reviewer');
  await h.service.addMember(h.room.id, h.member('reviewer', h.people[1]));
  await h.service.addMember(h.room.id, h.member('owner', h.people[2]));
  delete h.service.state.rooms[0].ledger[0].submission.agentId;
  await h.activate('reviewer');
  await assert.rejects(operate('reviewer', 'review', { verdict: 'approve' }), /unambiguous historical Agent identity/u);
  h.service.state.rooms[0].ledger[0].submission.agentId = h.people[0].id;
  const reviewed = await operate('reviewer', 'review', { verdict: 'approve' });
  assert.equal(reviewed.status, 'done', 'an explicitly bound submission permits a genuinely different person to review');
  assert.equal(reviewed.ownerSessionId, 'owner', 'the audit owner Session is never reassigned');
  await h.finish('reviewer');
});
