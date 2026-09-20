import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DshChatLocalService } from "../lib/room-store.js";

async function waitFor(predicate, label = "condition") {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function harness(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-chat-local-"));
  const path = join(directory, "rooms.json");
  const calls = [];
  const canceled = [];
  const sessionCwds = new Map();
  const persistedSessionCwds = new Map();
  let service;
  const ctx = {
    sessions: { get: (id) => sessionCwds.has(id) ? { header: { cwd: sessionCwds.get(id) } } : undefined },
    sessionQuery: {
      readTitleSnapshot: async (id) => {
        if (!persistedSessionCwds.has(id)) throw new Error(`session ${id} not found`);
        return { session: { id, cwd: persistedSessionCwds.get(id) } };
      }
    },
    sessionTitle: { get: () => undefined },
    agents: {
      get: (id) => ({ cancel: (cause, config) => canceled.push({ id, cause, config }) })
    },
    dshBridge: {
      status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => {
        const call = { from, to, text, delivery };
        calls.push(call);
        if (options.onDeliver) await options.onDeliver(call, path);
      }
    },
    get(name) { return this[name]; }
  };
  service = new DshChatLocalService(ctx, {
    path,
    maxRounds: options.maxRounds ?? 1,
    maxReplies: options.maxReplies ?? 10,
    replyTimeoutMs: 1_000,
    monitorMinuteMs: options.monitorMinuteMs,
    monitorIntervalMs: options.monitorIntervalMs
  });
  const complete = async (call, text = "(pass)", reason = { kind: "completed" }, turn = calls.indexOf(call) + 1) => {
    await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn } });
    await service.observeSessionEvent(call.to, {
      type: "user/message",
      data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] }
    });
    if (text !== null) {
      await service.observeSessionEvent(call.to, {
        type: "assistant/message",
        data: { turn, step: 1, message: { content: [{ type: "text", text }] } }
      });
    }
    await service.observeSessionEvent(call.to, { type: "turn/end", data: { turn, reason } });
  };
  const cleanup = async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  };
  return { service, path, calls, canceled, complete, cleanup, directory, sessionCwds, persistedSessionCwds };
}

async function roomWithMembers(service, aliases) {
  return await service.createRoom({
    name: "研究组",
    autoDeliver: true,
    members: aliases.map((alias, index) => ({ kind: "session", sessionId: `s${index + 1}`, alias }))
  });
}

async function activate(h, index = 0) {
  await waitFor(() => h.calls.length > index, "participant delivery");
  const call = h.calls[index];
  await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: index + 1 } });
  await h.service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] } });
  return call;
}

const charterInput = (message, extra = {}) => ({ baseRevision: 1, charter: "所有判断附依据；分歧保留并说明。", reason: "将讨论中的科学纪律登记为长期规则", sourceMessageIds: [message.id], ...extra });

test("active Agent document reads resolve shared filenames and retain continuation hash guards", async () => {
  const h = await harness(), outside = await mkdtemp(join(tmpdir(), "dcl-agent-shared-"));
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    h.sessionCwds.set("s1", h.directory);
    const path = join(outside, "shared.md"); await writeFile(path, "first\nsecond\nthird");
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: `读取 [材料](<${path}>)` });
    await activate(h);
    const first = await h.service.readDocument(room.id, "s1", { path: "shared.md", maxLines: 1 });
    assert.equal(first.access.scope, "human_shared_file"); assert.equal(first.nextStartLine, 2);
    const rest = await h.service.readDocument(room.id, "s1", { path: "shared.md", startLine: 2, expectedHash: first.contentHash });
    assert.match(rest.content, /second/); assert.equal(rest.nextStartLine, null);
    await writeFile(path, "changed");
    await assert.rejects(h.service.readDocument(room.id, "s1", { path: "shared.md", startLine: 2, expectedHash: first.contentHash }), /version changed/);
    await h.complete(h.calls[0]);
    await assert.rejects(h.service.readDocument(room.id, "s1", { path: "shared.md" }), /active/);
  } finally { await h.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test("an objection returns to its proposer once within the bounded round, without requiring an @mention", async () => {
  const h = await harness({ maxRounds: 3 });
  try {
    const room = await roomWithMembers(h.service, ["秘书", "审查"]);
    const source = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "依据需可定位" });
    await activate(h);
    const proposal = await h.service.proposeCharter(room.id, "s1", charterInput(source));
    await h.complete(h.calls[0]);
    await activate(h, 1);
    await h.service.reviewCharter(room.id, "s2", { proposalId: proposal.id, verdict: "request_changes", comment: "应明确定位信息" });
    await h.complete(h.calls[1]);
    await activate(h, 2);
    assert.equal(h.calls[2].to, "s1");
    assert.match(h.calls[2].text, /收到异议/);
    await h.complete(h.calls[2]);
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration.state === "idle");
    assert.equal(h.calls.length, 3);
    assert.equal((await h.service.roomMemory(room.id)).profile.revision, 1);
  } finally { await h.cleanup(); }
});

test("late charter proposal wakes earlier reviewers even after pass, then publishes unanimously once", async () => {
  const h = await harness({ maxRounds: 3 });
  try {
    const room = await roomWithMembers(h.service, ["评审", "秘书"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "判断要有依据，分歧请保留。这是今后共同遵守的规则。" });
    await h.complete(await activate(h), "(pass)");
    const secretary = await activate(h, 1);
    const proposal = await h.service.proposeCharter(room.id, "s2", charterInput(root));
    assert.equal(proposal.status, "pending");
    assert.equal((await h.service.roomMemory(room.id)).profile.revision, 1);
    const duplicate = await h.service.proposeCharter(room.id, "s2", charterInput(root));
    assert.equal(duplicate.id, proposal.id);
    await h.complete(secretary, "(pass)");
    const reviewer = await activate(h, 2);
    assert.equal(reviewer.to, "s1");
    assert.match(reviewer.text, new RegExp(proposal.id));
    assert.match(reviewer.text, new RegExp(root.id));
    const review = { proposalId: proposal.id, verdict: "approve", comment: "原讨论支持两项要求，未扩大权限" };
    const applied = await h.service.reviewCharter(room.id, "s1", review);
    assert.equal(applied.status, "applied");
    assert.equal(applied.appliedRevision, 2);
    await h.service.reviewCharter(room.id, "s1", review);
    const memory = await h.service.roomMemory(room.id);
    assert.equal(memory.history.length, 2);
    assert.equal(memory.proposals.length, 1);
    assert.equal(memory.profile.charter, charterInput(root).charter);
    assert.equal(memory.proposals[0].sources[0].text, root.text);
    const notices = (await h.service.messages(room.id)).filter((item) => item.author === "system:charter");
    assert.equal(notices.length, 2);
    assert.ok(notices.every((item) => Number.isFinite(item.sentAt)));
    assert.match(notices[1].text, /全体 2 位成员确认/);
    await h.complete(reviewer, "登记完成");
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration.state === "idle");
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "继续讨论" });
    await activate(h, 3);
    assert.match(h.calls[3].text, /现行章程 revision：2/);
    assert.match(h.calls[3].text, /所有判断附依据/);
    assert.equal((await h.service.listRooms())[0].pendingCharterCount, 0);
  } finally { await h.cleanup(); }
});

test("objection preserves current charter and a revised proposal links back to the rejected draft", async () => {
  const h = await harness({ maxRounds: 3 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "保留依据和分歧，不自动编辑文件" });
    await activate(h);
    const proposal = await h.service.proposeCharter(room.id, "s1", charterInput(root));
    await h.complete(h.calls[0], "请审阅提案");
    await activate(h, 1);
    await h.service.reviewCharter(room.id, "s2", { proposalId: proposal.id, verdict: "request_changes", comment: "需要明示不修改文件" });
    assert.equal((await h.service.roomMemory(room.id)).profile.revision, 1);
    await assert.rejects(h.service.reviewCharter(room.id, "s2", { proposalId: proposal.id, verdict: "approve", comment: "改变主意" }), /changes_requested/);
    const revised = await h.service.proposeCharter(room.id, "s2", charterInput(root, { charter: "所有判断附依据；保留分歧；不擅自修改文件。", replacesProposalId: proposal.id }));
    assert.equal(revised.replacesProposalId, proposal.id);
    assert.equal(revised.status, "pending");
    await h.complete(h.calls[1]);
    await activate(h, 2);
    await h.service.reviewCharter(room.id, "s1", { proposalId: revised.id, verdict: "approve", comment: "已完整反映原讨论" });
    const memory = await h.service.roomMemory(room.id);
    assert.equal(memory.proposals[0].status, "changes_requested");
    assert.equal(memory.proposals[1].status, "applied");
  } finally { await h.cleanup(); }
});

test("memory writes reject outsiders, inactive turns, wrong-room turns and superseded late calls", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    const other = await h.service.createRoom({ name: "另一个房间", members: [{ sessionId: "s1", alias: "甲", kind: "session" }] });
    await assert.rejects(h.service.roomMemory(room.id, "outsider"), /member/);
    await assert.rejects(h.service.proposeCharter(room.id, "s1", {}), /active/);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "遵守科学纪律" });
    await activate(h);
    await assert.rejects(h.service.proposeCharter(room.id, "outsider", charterInput(root)), /member/);
    await assert.rejects(h.service.proposeCharter(other.id, "s1", charterInput(root)), /active/);
    assert.equal(h.service.guardToolExecution({ name: "chat_charter_propose", agent: { session: { id: "s1" } } }), undefined);
    assert.ok(h.service.guardToolExecution({ name: "write_file", agent: { session: { id: "s1" } } }));
    await h.service.stopRoom(room.id);
    await assert.rejects(h.service.proposeCharter(room.id, "s1", charterInput(root)), /active/);
    assert.equal((await h.service.roomMemory(room.id)).proposals.length, 0);
  } finally { await h.cleanup(); }
});

test("proposal validation requires real room evidence and cannot write policy, identity or source", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "依据必须可复核" });
    await activate(h);
    for (const extra of [{ policy: {} }, { actor: "human:me" }, { source: { name: "伪造" } }, { sourceMessageIds: [] }, { sourceMessageIds: ["foreign"] }, { baseRevision: 9 }, { charter: "x".repeat(20001) }, { reason: "" }]) {
      await assert.rejects(h.service.proposeCharter(room.id, "s1", charterInput(root, extra)));
    }
    assert.equal((await h.service.roomMemory(room.id)).proposals.length, 0);
    const applied = await h.service.proposeCharter(room.id, "s1", charterInput(root));
    assert.equal(applied.status, "applied");
    assert.deepEqual((await h.service.resolveRoom(room.id)).policy, room.policy);
    assert.equal((await h.service.roomMemory(room.id)).profile.source, undefined);
  } finally { await h.cleanup(); }
});

test("manual edits supersede pending proposals; restoring creates a new version without erasing history", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "讨论长期规则" });
    await activate(h);
    const proposal = await h.service.proposeCharter(room.id, "s1", charterInput(root));
    await h.service.setRoomProfile(room.id, { expectedRevision: 1, charter: "用户现行要求" });
    await h.complete(h.calls[0]);
    await activate(h, 1);
    await assert.rejects(h.service.reviewCharter(room.id, "s2", { proposalId: proposal.id, verdict: "approve", comment: "确认" }), /superseded/);
    await assert.rejects(h.service.restoreCharter(room.id, { revision: 1, expectedRevision: 1 }), /conflict/);
    await h.service.restoreCharter(room.id, { revision: 1, expectedRevision: 2 });
    const memory = await h.service.roomMemory(room.id);
    assert.equal(memory.history.length, 3);
    assert.equal(memory.profile.revision, 3);
    assert.equal(memory.profile.charter, undefined);
    assert.equal(memory.history[1].profile.charter, "用户现行要求");
    assert.equal(memory.history[2].restoredFromRevision, 1);
    await h.service.restoreCharter(room.id, { revision: 1, expectedRevision: 3 });
    assert.equal((await h.service.roomMemory(room.id)).history.length, 3, "no-op restore does not create fake change");
  } finally { await h.cleanup(); }
});

test("unconfirmed proposals survive a bounded round and membership change invalidates old votes", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "请形成规则" });
    await activate(h);
    const proposal = await h.service.proposeCharter(room.id, "s1", charterInput(root));
    await h.complete(h.calls[0]);
    await activate(h, 1);
    await h.complete(h.calls[1], "我同意");
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration.state === "idle");
    assert.equal(h.calls.length, 2);
    assert.equal((await h.service.roomMemory(room.id)).proposals[0].status, "pending", "ordinary agreement is not a vote");
    assert.equal((await h.service.listRooms())[0].pendingCharterCount, 1);
    await h.service.addMember(room.id, { kind: "session", sessionId: "s3", alias: "丙" });
    const memory = await h.service.roomMemory(room.id);
    assert.equal(memory.proposals[0].id, proposal.id);
    assert.equal(memory.proposals[0].status, "superseded");
    assert.equal(memory.profile.revision, 1);
  } finally { await h.cleanup(); }
});

test("charter revisions and source snapshots persist after restart, including user dismissal", async () => {
  const h = await harness();
  let restarted;
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    const root = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "可核查的科学纪律" });
    await activate(h);
    const proposal = await h.service.proposeCharter(room.id, "s1", charterInput(root));
    await h.service.dismissCharterProposal(room.id, proposal.id);
    await h.service.close();
    restarted = new DshChatLocalService({ get() {} }, { path: h.path });
    const memory = await restarted.roomMemory(room.id);
    assert.equal(memory.proposals[0].status, "dismissed");
    assert.equal(memory.proposals[0].sources[0].text, root.text);
    assert.equal(memory.history.length, 1);
    assert.equal("profileHistory" in (await restarted.listRooms())[0], false, "room polling does not duplicate the entire archive");
    const disk = JSON.parse(await readFile(h.path, "utf8"));
    assert.equal(disk.version, 17);
  } finally { if (restarted) await restarted.close(); await h.cleanup(); }
});

test("persists the room message before external delivery and exposes delivery failure", async () => {
  let observedDurable = false;
  const h = await harness({
    onDeliver: async (_call, path) => {
      const disk = JSON.parse(await readFile(path, "utf8"));
      observedDurable = disk.rooms[0].messages.some((message) => message.text === "先保存");
      throw new Error("bridge offline");
    }
  });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "先保存" });
    await waitFor(async () => (await h.service.messages(room.id))[0]?.deliveries?.[0]?.status === "failed", "failed delivery");
    const [message] = await h.service.messages(room.id);
    assert.equal(observedDurable, true);
    assert.equal(message.deliveries[0].error, "bridge offline");
  } finally { await h.cleanup(); }
});

test("rejects unknown structured mentions instead of silently broadcasting", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await assert.rejects(
      h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "你好", mentions: ["不存在"] }),
      /does not match a room member/
    );
    assert.equal(h.calls.length, 0);
    assert.equal((await h.service.messages(room.id)).length, 0);
  } finally { await h.cleanup(); }
});

test("runs participants sequentially and automatically relays ordinary replies", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "讨论一下" });
    await waitFor(() => h.calls.length === 1, "first participant");
    assert.equal(h.calls[0].to, "s1");
    await h.complete(h.calls[0], "甲的意见");
    await waitFor(() => h.calls.length === 2, "second participant");
    assert.equal(h.calls[1].to, "s2");
    await h.complete(h.calls[1], "乙的意见");
    await waitFor(async () => (await h.service.messages(room.id)).length === 3, "two relayed replies");
    const messages = await h.service.messages(room.id);
    assert.deepEqual(messages.map((message) => message.text), ["讨论一下", "甲的意见", "乙的意见"]);
    assert.deepEqual(messages[0].deliveries.map((delivery) => delivery.status), ["replied", "replied"]);
  } finally { await h.cleanup(); }
});

test("routes Agent @mentions into a bounded, causal Agent-to-Agent dialogue", async () => {
  const h = await harness({ maxRounds: 3 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙", "丙"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "请共同讨论" });
    await waitFor(() => h.calls.length === 1, "first participant");
    assert.equal(h.calls[0].to, "s1");

    await h.complete(h.calls[0], "@乙你怎么看？");
    await waitFor(() => h.calls.length === 2, "mentioned participant");
    assert.equal(h.calls[1].to, "s2");
    assert.match(h.calls[1].text, /这个 @ 会立即把对话路由给对方/);

    await h.complete(h.calls[1], "@甲 我不同意，请补充证据。");
    await waitFor(() => h.calls.length === 3, "reply back to first participant");
    assert.equal(h.calls[2].to, "s1");
    await h.complete(h.calls[2], "证据补充如下，不再点名。");

    await waitFor(() => h.calls.length === 4, "remaining initial participant");
    assert.equal(h.calls[3].to, "s3");
    await h.complete(h.calls[3], "(pass)");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(h.calls.map((call) => call.to), ["s1", "s2", "s1", "s3"]);
    const messages = await h.service.messages(room.id);
    assert.deepEqual(messages[1].mentions, ["session:s2"]);
    assert.deepEqual(messages[2].mentions, ["session:s1"]);
    assert.equal(messages[2].causedByMessageId, messages[1].id);
    assert.equal(messages[3].causedByMessageId, messages[2].id);
  } finally { await h.cleanup(); }
});

test("recognizes a typed human @alias and targets only that participant", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    const sent = await h.service.send({
      roomId: room.id,
      author: "human:me",
      authorKind: "human",
      text: "@乙请单独回答",
      mentions: []
    });
    await waitFor(() => h.calls.length === 1, "typed mention delivery");
    assert.equal(h.calls[0].to, "s2");
    assert.deepEqual(sent.mentions, ["session:s2"]);
    await h.complete(h.calls[0], "(pass)");
  } finally { await h.cleanup(); }
});

test("assigns unique room aliases when DSH session titles collide", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["Documents", "Documents"]);
    assert.deepEqual(room.members.map((member) => member.alias), ["Documents", "Documents-2"]);
  } finally { await h.cleanup(); }
});

test("persists a room charter and member mandate and injects both into collaboration turns", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await h.service.createRoom({
      name: "研究决策小组",
      autoDeliver: true,
      defaultActionMode: "read_only_audit",
      profile: {
        purpose: "形成可核查的研究决策。",
        charter: "默认只提意见；未获明确授权不得改稿。",
        source: { name: "对话全记录.md", path: "/tmp/对话全记录.md", sha256: "abc123" }
      },
      members: [{
        kind: "session",
        sessionId: "s1",
        alias: "方法设计部",
        role: "识别策略与统计口径审查",
        mandate: "先核对研究设计，再给出可复核的建议。"
      }]
    });

    const [participant] = await h.service.listParticipants(room.id);
    assert.equal(participant.role, "识别策略与统计口径审查");
    assert.equal(participant.mandate, "先核对研究设计，再给出可复核的建议。");
    assert.equal(room.profile.source.readOnlyReference, true);

    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "请评议设计" });
    await waitFor(() => h.calls.length === 1, "chartered participant");
    assert.match(h.calls[0].text, /形成可核查的研究决策/);
    assert.match(h.calls[0].text, /未获明确授权不得改稿/);
    assert.match(h.calls[0].text, /识别策略与统计口径审查/);
    assert.match(h.calls[0].text, /先核对研究设计/);
    await h.complete(h.calls[0], "(pass)");
  } finally { await h.cleanup(); }
});

test("updates room profile and member roles with revision checks", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await assert.rejects(
      h.service.setRoomProfile(room.id, { purpose: "新目标", charter: "新章程", expectedRevision: 99 }),
      /profile revision conflict/
    );
    const updated = await h.service.setRoomProfile(room.id, {
      purpose: "新目标",
      charter: "新章程",
      source: { name: "依据.md" },
      expectedRevision: 1
    });
    assert.equal(updated.profile.revision, 2);
    assert.equal(updated.profile.purpose, "新目标");
    await h.service.addMember(room.id, {
      kind: "session",
      sessionId: "s1",
      alias: "甲",
      role: "终审",
      mandate: "只指出未闭环事项"
    });
    const [participant] = await h.service.listParticipants(room.id);
    assert.equal(participant.role, "终审");
    assert.equal(participant.mandate, "只指出未闭环事项");
  } finally { await h.cleanup(); }
});

test("does not regress a fast completed reply back to sent", async () => {
  let h;
  h = await harness({
    maxRounds: 1,
    onDeliver: async (call) => { await h.complete(call, "即时回答"); }
  });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "快速回答" });
    await waitFor(async () => (await h.service.messages(room.id)).length === 2, "fast reply");
    const messages = await h.service.messages(room.id);
    assert.equal(messages[0].deliveries[0].status, "replied");
    assert.equal(messages[1].text, "即时回答");
  } finally { await h.cleanup(); }
});

test("exposes distinct sent, delivered, working and replied delivery states", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "状态测试" });
    await waitFor(() => h.calls.length === 1, "sent delivery");
    await waitFor(async () => (await h.service.messages(room.id))[0]?.deliveries?.[0]?.status === "sent", "sent state");
    const call = h.calls[0];
    await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
    await h.service.observeSessionEvent(call.to, {
      type: "user/message",
      data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] }
    });
    assert.equal((await h.service.messages(room.id))[0].deliveries[0].status, "delivered");
    await h.service.observeSessionEvent(call.to, {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "回答" }] } }
    });
    assert.equal((await h.service.messages(room.id))[0].deliveries[0].status, "working");
    await h.service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    assert.equal((await h.service.messages(room.id))[0].deliveries[0].status, "replied");
  } finally { await h.cleanup(); }
});

test("enforces room policy revision and blocks mutating tools only during a group turn", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    assert.equal(room.policy.defaultActionMode, "discuss_only");
    await assert.rejects(
      h.service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit", expectedRevision: 99 }),
      /revision conflict/
    );
    const updated = await h.service.setRoomPolicy(room.id, { defaultActionMode: "read_only_audit", expectedRevision: 1 });
    assert.equal(updated.policy.revision, 2);
    assert.equal(updated.policy.defaultActionMode, "read_only_audit");

    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "只读核查" });
    await waitFor(() => h.calls.length === 1, "guarded participant");
    const execution = (name) => ({ name, agent: { session: { id: "s1" } } });
    assert.equal(h.service.guardToolExecution(execution("bash")), undefined, "a queued group message must not lock an unrelated current turn");
    const call = h.calls[0];
    await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
    await h.service.observeSessionEvent(call.to, {
      type: "user/message",
      data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] }
    });
    assert.equal(h.service.guardToolExecution(execution("read_file")), undefined);
    assert.equal(h.service.guardToolExecution(execution("chat_send")), undefined);
    assert.match(h.service.guardToolExecution(execution("bash")), /Host 已拒绝非只读工具 bash/);
    assert.match(h.service.guardToolExecution(execution("run_code")), /Host 已拒绝非只读工具 run_code/);
    await h.service.observeSessionEvent(call.to, {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "核查完成" }] } }
    });
    await h.service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    await waitFor(() => h.service.guardToolExecution(execution("bash")) === undefined, "released tool guard");
  } finally { await h.cleanup(); }
});

test("deduplicates retried human submissions by client operation id", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    const input = {
      roomId: room.id,
      author: "human:me",
      authorKind: "human",
      text: "只发送一次",
      clientOperationId: "op-1"
    };
    const first = await h.service.send(input);
    const second = await h.service.send(input);
    assert.equal(first.id, second.id);
    assert.equal((await h.service.messages(room.id)).length, 1);
    await waitFor(() => h.calls.length === 1, "one external delivery");
    await h.complete(h.calls[0], "(pass)");
  } finally { await h.cleanup(); }
});

test("previews authorized workspace text as versioned artifacts and rejects path escape", async () => {
  const h = await harness();
  try {
    h.sessionCwds.set("s1", h.directory);
    const room = await roomWithMembers(h.service, ["甲"]);
    const file = join(h.directory, "paper.md");
    await writeFile(file, "# 第一版\n");
    const first = await h.service.previewArtifact(room.id, { sessionId: "s1", path: "paper.md" });
    assert.equal(first.content, "# 第一版\n");
    assert.equal(first.artifact.kind, "markdown");
    assert.equal(first.artifact.replica.relativePath, "paper.md");

    await writeFile(file, "# 第二版\n");
    const second = await h.service.previewArtifact(room.id, { sessionId: "s1", path: file });
    assert.equal(second.artifact.id, first.artifact.id);
    assert.notEqual(second.artifact.version.id, first.artifact.version.id);
    const [artifact] = await h.service.listArtifacts(room.id);
    assert.equal(artifact.versions.length, 2);
    assert.equal(artifact.currentVersionId, second.artifact.version.id);

    await assert.rejects(
      h.service.previewArtifact(room.id, { sessionId: "s1", path: "/etc/hosts" }),
      { code: "FILE_NOT_AUTHORIZED", status: 403 }
    );
  } finally { await h.cleanup(); }
});

test("previews a file from a durable DSH session that is not currently attached", async () => {
  const h = await harness();
  try {
    h.persistedSessionCwds.set("s1", h.directory);
    const room = await roomWithMembers(h.service, ["甲"]);
    await writeFile(join(h.directory, "durable.md"), "# 持久化会话\n");

    const preview = await h.service.previewArtifact(room.id, { sessionId: "s1", path: "durable.md" });

    assert.equal(preview.content, "# 持久化会话\n");
    assert.equal(preview.artifact.replica.sessionId, "s1");
    assert.equal(preview.artifact.replica.relativePath, "durable.md");
  } finally { await h.cleanup(); }
});

test("all-pass ends the turn without adding a fake reply or starting another round", async () => {
  const h = await harness({ maxRounds: 3 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "还有补充吗" });
    await waitFor(() => h.calls.length === 1, "participant");
    await h.complete(h.calls[0], "(pass)");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const messages = await h.service.messages(room.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].deliveries[0].status, "passed");
    assert.equal(h.calls.length, 1);
  } finally { await h.cleanup(); }
});

test("a newer room message supersedes an in-flight turn and suppresses its late reply", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "旧问题" });
    await waitFor(() => h.calls.length === 1, "old delivery");
    const oldCall = h.calls[0];
    await h.service.observeSessionEvent(oldCall.to, { type: "turn/start", data: { turn: 1 } });
    await h.service.observeSessionEvent(oldCall.to, {
      type: "user/message",
      data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${oldCall.delivery.id} from ${oldCall.from}]` }] }
    });
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "新问题" });
    await h.service.observeSessionEvent(oldCall.to, {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "迟到的旧回答" }] } }
    });
    await h.service.observeSessionEvent(oldCall.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    await waitFor(() => h.calls.length === 2, "new delivery");
    await h.complete(h.calls[1], "(pass)", { kind: "completed" }, 2);
    const messages = await h.service.messages(room.id);
    assert.equal(messages.some((message) => message.text === "迟到的旧回答"), false);
    assert.equal(messages[0].deliveries[0].status, "superseded");
    assert.equal(h.canceled.length, 1);
  } finally { await h.cleanup(); }
});

test("new rooms default to automatic collaboration", async () => {
  const h = await harness();
  try {
    const room = await h.service.createRoom({ name: "默认协作" });
    assert.equal(room.autoDeliver, true);
  } finally { await h.cleanup(); }
});

test("edits room details with optimistic revision checks and rejects duplicate active names", async () => {
  const h = await harness();
  try {
    const room = await h.service.createRoom({ name: "原名称" });
    await h.service.createRoom({ name: "已占用" });
    await assert.rejects(
      h.service.setRoomDetails(room.id, { name: "改名", purpose: "目标", charter: "章程", expectedRevision: 99 }),
      /room revision conflict/
    );
    await assert.rejects(
      h.service.setRoomDetails(room.id, { name: "已占用", purpose: "目标", charter: "章程", expectedRevision: room.revision }),
      /already exists/
    );
    const updated = await h.service.setRoomDetails(room.id, {
      name: "改名",
      purpose: "形成可核查结果",
      charter: "默认自动协作",
      expectedRevision: room.revision
    });
    assert.equal(updated.name, "改名");
    assert.equal(updated.profile.purpose, "形成可核查结果");
    assert.equal(updated.profile.charter, "默认自动协作");
    assert.equal(updated.revision, room.revision + 1);
  } finally { await h.cleanup(); }
});

test("reorders every member exactly once and preserves edited identity fields", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙", "丙"]);
    await h.service.addMember(room.id, {
      kind: "session",
      sessionId: "s2",
      alias: "数据审查部",
      role: "数据审计",
      mandate: "核对变量、单位与样本。"
    });
    const afterEdit = await h.service.resolveRoom(room.id);
    await assert.rejects(h.service.addMember(room.id, {
      kind: "session",
      sessionId: "s2",
      alias: "旧页面覆盖"
    }, { expectedRevision: room.revision }), /room revision conflict/);
    await assert.rejects(
      h.service.reorderMembers(room.id, ["s3", "s2", "s1"], { expectedRevision: room.revision }),
      /room revision conflict/
    );
    const ordered = await h.service.reorderMembers(room.id, ["s3", "s2", "s1"], { expectedRevision: afterEdit.revision });
    assert.deepEqual(ordered.map((member) => member.sessionId), ["s3", "s2", "s1"]);
    const participants = await h.service.listParticipants(room.id);
    assert.deepEqual(participants.map((member) => member.alias), ["丙", "数据审查部", "甲"]);
    assert.equal(participants[1].role, "数据审计");
    assert.equal(participants[1].mandate, "核对变量、单位与样本。");
    await assert.rejects(h.service.reorderMembers(room.id, ["s1", "s2"]), /every room member exactly once/);
    await assert.rejects(h.service.reorderMembers(room.id, ["s1", "s2", "unknown"]), /unknown session/);
  } finally { await h.cleanup(); }
});

test("stops an active collaboration and suppresses its late reply", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "正在协作" });
    await waitFor(() => h.calls.length === 1, "active collaboration");
    const call = h.calls[0];
    await h.service.observeSessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
    await h.service.observeSessionEvent(call.to, {
      type: "user/message",
      data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] }
    });
    const stopped = await h.service.stopRoom(room.id);
    assert.equal(stopped.orchestration.state, "idle");
    assert.equal(stopped.orchestration.stoppedByUser, true);
    assert.equal((await h.service.messages(room.id))[0].deliveries[0].status, "superseded");
    assert.equal(h.canceled.length, 1);
    await h.service.observeSessionEvent(call.to, {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "停止后的迟到回复" }] } }
    });
    await h.service.observeSessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    assert.equal((await h.service.messages(room.id)).some((message) => message.text === "停止后的迟到回复"), false);
  } finally { await h.cleanup(); }
});

test("soft-deletes and restores a room without losing messages or DSH membership", async () => {
  const h = await harness();
  try {
    const room = await h.service.createRoom({
      name: "可恢复房间",
      autoDeliver: false,
      members: [{ kind: "session", sessionId: "s1", alias: "协调组" }]
    });
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "保留这条记录" });
    const deleted = await h.service.deleteRoom(room.id, { expectedRevision: room.revision });
    assert.ok(deleted.deletedAt);
    assert.equal((await h.service.listRooms()).some((item) => item.id === room.id), false);
    assert.equal((await h.service.listDeletedRooms()).some((item) => item.id === room.id), true);
    assert.equal((await h.service.messages(room.id))[0].text, "保留这条记录");
    assert.deepEqual((await h.service.listParticipants(room.id)).map((member) => member.alias), ["协调组"]);

    const restored = await h.service.restoreRoom(room.id, { expectedRevision: deleted.revision });
    assert.equal(restored.deletedAt, undefined);
    assert.equal(restored.name, "可恢复房间");
    assert.equal((await h.service.messages(room.id))[0].text, "保留这条记录");

    const deletedAgain = await h.service.deleteRoom(room.id, { expectedRevision: restored.revision });
    await h.service.createRoom({ name: "可恢复房间" });
    const renamedRestore = await h.service.restoreRoom(room.id, { expectedRevision: deletedAgain.revision });
    assert.equal(renamedRestore.name, "可恢复房间（恢复）");
  } finally { await h.cleanup(); }
});

test("blocks membership changes while automatic collaboration is active", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲", "乙"]);
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "开始" });
    await waitFor(() => h.calls.length === 1, "running collaboration");
    await assert.rejects(h.service.reorderMembers(room.id, ["s2", "s1"]), /stop the active collaboration/);
    await assert.rejects(h.service.addMember(room.id, { kind: "session", sessionId: "s3", alias: "丙" }), /stop the active collaboration/);
    await h.service.stopRoom(room.id);
    await h.service.reorderMembers(room.id, ["s2", "s1"]);
  } finally { await h.cleanup(); }
});

test("creates and updates an auditable task ledger with member and revision validation", async () => {
  const h = await harness();
  try {
    const room = await roomWithMembers(h.service, ["协调组", "方法组"]);
    const source = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "核对识别策略", mentions: [] });
    await h.service.stopRoom(room.id);
    const task = await h.service.createLedgerEntry(room.id, {
      kind: "task",
      title: "复核识别策略",
      details: "检查平行趋势与样本口径。",
      acceptanceCriteria: "形成可复核的问题清单。",
      ownerSessionId: "s2",
      collaboratorSessionIds: ["s1"],
      sourceMessageId: source.id,
      status: "open"
    });
    assert.equal(task.revision, 1);
    assert.equal(task.history[0].type, "created");
    await assert.rejects(
      h.service.updateLedgerEntry(room.id, task.id, { status: "in_progress" }, { expectedRevision: 99 }),
      /ledger revision conflict/
    );
    const updated = await h.service.updateLedgerEntry(room.id, task.id, {
      status: "blocked",
      details: "等待补充原始变量定义。"
    }, { expectedRevision: 1 });
    assert.equal(updated.revision, 2);
    assert.equal(updated.status, "blocked");
    assert.equal(updated.history.at(-1).fromStatus, "open");
    assert.equal((await h.service.listLedger(room.id))[0].details, "等待补充原始变量定义。");
    await assert.rejects(
      h.service.createLedgerEntry(room.id, { kind: "task", title: "错误负责人", ownerSessionId: "missing" }),
      /owner must be a room member/
    );
  } finally { await h.cleanup(); }
});

test("idle task monitoring survives as room state and wakes only the configured coordinator", async () => {
  const h = await harness({ monitorMinuteMs: 20, monitorIntervalMs: 25, maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["协调组", "方法组"]);
    const task = await h.service.createLedgerEntry(room.id, {
      kind: "task",
      title: "未闭环任务",
      ownerSessionId: "s2",
      monitor: { enabled: true, coordinatorSessionId: "s1", idleMinutes: 1 }
    });
    await waitFor(() => h.calls.length === 1, "idle task reminder");
    assert.equal(h.calls[0].to, "s1");
    assert.match(h.calls[0].text, /任务「未闭环任务」已连续 1 分钟没有实质进展/);
    const messages = await h.service.messages(room.id);
    assert.equal(messages[0].authorKind, "system");
    assert.equal(messages[0].authorAlias, "停滞监控");
    assert.deepEqual(messages[0].mentions, ["session:s1"]);
    const [monitored] = await h.service.listLedger(room.id);
    assert.equal(monitored.id, task.id);
    assert.equal(monitored.monitor.reminderCount, 1);
    assert.ok(monitored.monitor.nextReminderAt > monitored.monitor.lastReminderAt);
    await h.complete(h.calls[0], "(pass)");
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration.state === "idle");
    assert.equal(h.calls.length, 1, "a coordinator-only monitor must not wake old task owners");
  } finally { await h.cleanup(); }
});

test("corrects a human message by appending an audit-linked message and notifying affected participants", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    const original = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "样本是 100", mentions: ["s1"] });
    await waitFor(() => h.calls.length === 1, "original delivery");
    await h.complete(h.calls[0], "收到原数据");
    await waitFor(async () => (await h.service.messages(room.id)).length === 2, "original reply");

    const correction = await h.service.correctHumanMessage(room.id, original.id, {
      text: "纠正：样本是 120",
      clientOperationId: "correction-1"
    });
    await waitFor(() => h.calls.length === 2, "correction delivery");
    assert.equal(h.calls[1].to, "s1");
    assert.equal(correction.correctsMessageId, original.id);
    const messages = await h.service.messages(room.id);
    assert.equal(messages[0].text, "样本是 100");
    assert.equal(messages.some((message) => message.text === "纠正：样本是 120" && message.correctsMessageId === original.id), true);
    await h.complete(h.calls[1], "(pass)", { kind: "completed" }, 2);
  } finally { await h.cleanup(); }
});

test("retries only failed recipients on the original message without duplicating the human message", async () => {
  let fail = true;
  const h = await harness({
    maxRounds: 1,
    onDeliver: async () => {
      if (fail) {
        fail = false;
        throw new Error("temporary bridge failure");
      }
    }
  });
  try {
    const room = await roomWithMembers(h.service, ["甲"]);
    const original = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "重试我", mentions: ["s1"] });
    await waitFor(async () => (await h.service.messages(room.id))[0]?.deliveries?.[0]?.status === "failed", "initial failure");
    // A failed delivery is persisted before the surrounding collaboration finishes.
    await waitFor(async () => !["queued", "running"].includes((await h.service.resolveRoom(room.id)).orchestration?.state), "collaboration ready for retry");
    const retried = await h.service.retryFailedDeliveries(room.id, original.id);
    assert.deepEqual(retried.retriedSessionIds, ["s1"]);
    await waitFor(() => h.calls.length === 2, "retried delivery");
    await h.complete(h.calls[1], "重试成功");
    await waitFor(async () => (await h.service.messages(room.id)).length === 2, "retry reply");
    const messages = await h.service.messages(room.id);
    assert.equal(messages.filter((message) => message.authorKind === "human").length, 1);
    assert.deepEqual(messages[0].deliveries.map((delivery) => delivery.status), ["superseded", "replied"]);
    assert.equal(messages[1].text, "重试成功");
  } finally { await h.cleanup(); }
});

test("searches messages by text, author and delivery status", async () => {
  const h = await harness({ maxRounds: 1 });
  try {
    const room = await h.service.createRoom({ name: "搜索", autoDeliver: false });
    const target = await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "采用路径 C" });
    await h.service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "其他事项" });
    assert.deepEqual((await h.service.searchMessages(room.id, { query: "路径 C" })).map((message) => message.text), ["采用路径 C"]);
    assert.equal((await h.service.searchMessages(room.id, { author: "human:me" })).length, 2);
    assert.equal((await h.service.searchMessages(room.id, { deliveryStatus: "failed" })).length, 0);
    assert.deepEqual((await h.service.messageContext(room.id, target.id, 1)).map((message) => message.text), ["采用路径 C", "其他事项"]);
  } finally { await h.cleanup(); }
});

test("migrates v1 copied agent records into v15 membership and a group without copied model state", async () => {
  const h = await harness();
  try {
    await h.service.close();
    await writeFile(h.path, JSON.stringify({
      version: 1,
      rooms: [{ id: "room-1", name: "旧房间", createdAt: 1, autoDeliver: true, members: [], messages: [] }],
      agents: [{ agentId: "a1", roomId: "room-1", sessionId: "session-1", name: "旧 Agent", model: "copied/model", createdAt: 2 }]
    }));
    const ctx = { sessions: { get: () => undefined }, sessionTitle: { get: () => undefined }, get(name) { return this[name]; } };
    const migrated = new DshChatLocalService(ctx, { path: h.path });
    const [room] = await migrated.listRooms();
    assert.deepEqual(room.members.map((member) => ({ sessionId: member.sessionId, alias: member.alias, ownership: member.ownership })), [
      { sessionId: "session-1", alias: "旧 Agent", ownership: "provisioned" }
    ]);
    const disk = JSON.parse(await readFile(h.path, "utf8"));
    assert.equal(disk.version, 17);
    assert.deepEqual(disk.rooms[0].ledger, []);
    assert.equal("agents" in disk, false);
    assert.equal("model" in disk.rooms[0].members[0], false);
    assert.equal(disk.rooms[0].policy.defaultActionMode, "discuss_only");
    assert.equal(disk.rooms[0].profile.revision, 1);
    assert.equal(disk.rooms[0].profileHistory.length, 1);
    assert.deepEqual(disk.rooms[0].profileProposals, []);
    await migrated.close();
  } finally {
    await rm(h.directory, { recursive: true, force: true });
  }
});
