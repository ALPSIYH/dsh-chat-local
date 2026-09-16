import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { docxFixture } from "./docx-fixture.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
}

test("registered tools derive actor from DSH execution and share the HTTP revision archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-charter-tools-"));
  const registered = new Map(), disposers = [], deliveries = [];
  let handler, observe;
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    on(name, fn) { assert.equal(name, "session/event"); observe = fn; },
    tools: { register(tool) { registered.set(tool.name, tool); }, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    sessionTitle: { get() {} }, sessions: { get() { return { header: { cwd: directory } }; } }, agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (from, to, text, delivery) => deliveries.push({ from, to, text, delivery }) },
    get(name) { return this[name]; }
  };
  apply(ctx, { path: join(directory, "rooms.json"), maxRounds: 2 });
  const request = async (path, body, method = body ? "POST" : "GET") => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    req.url = `/api/dsh-chat-local${path}`; req.method = method;
    let status, result;
    await handler(req, { writeHead(code) { status = code; }, end(text) { result = JSON.parse(text); } });
    assert.equal(status, 200, result?.error);
    assert.equal(result.ok, true, result?.error);
    return result.value;
  };
  const exec = (id) => ({ agent: { session: { id } } });
  const activate = async (index) => {
    await waitFor(() => deliveries.length > index);
    const call = deliveries[index];
    observe({ id: call.to }, { type: "turn/start", data: { turn: index + 1 } });
    observe({ id: call.to }, { type: "user/message", data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] } });
    await waitFor(async () => (await request(`/rooms/${room.id}/messages`))[0].deliveries[index]?.status === "delivered");
  };
  let room;
  try {
    for (const name of ["chat_memory", "chat_charter_propose", "chat_charter_review", "chat_work", "chat_read_document"]) assert.ok(registered.has(name));
    room = await request("/rooms", { name: "工具测试", members: [{ kind: "session", sessionId: "a", alias: "甲" }, { kind: "session", sessionId: "b", alias: "乙" }], profile: { charter: "原始纪律", source: { name: "只读记录.md", path: "/readonly/original.md" } } });
    const source = await request(`/rooms/${room.id}/messages`, { author: "human:me", authorKind: "human", text: "新增长期要求：每项判断附可定位依据。" });
    await activate(0);
    await writeFile(join(directory,"paper.docx"),docxFixture());
    const reader=registered.get("chat_read_document");
    await assert.rejects(reader.execute({room:room.id,path:"paper.docx"},exec("b")),/active/);
    const firstChunk=await reader.execute({room:room.id,path:"paper.docx",maxLines:1},exec("a"));
    assert.equal(firstChunk.document,undefined,"human reading structure must not bypass Agent chunk limits");
    assert.equal(firstChunk.extraction.document,undefined);
    assert.match(firstChunk.content,/正文核查/);assert.equal(firstChunk.nextStartLine,2);
    await assert.rejects(reader.execute({room:room.id,path:"paper.docx",startLine:2},exec("a")),/expectedHash/);
    const rest=await reader.execute({room:room.id,path:"paper.docx",startLine:2,expectedHash:firstChunk.contentHash},exec("a"));assert.equal(rest.nextStartLine,null);assert.match(rest.content,/原始数据说明/);
    await assert.rejects(reader.execute({room:room.id,path:"paper.docx",expectedHash:"old-version"},exec("a")),/version changed/);
    const args = { room: room.id, baseRevision: 1, charter: "原始纪律；每项判断附可定位依据。", reason: "登记用户明确要求", sourceMessageIds: [source.id] };
    await assert.rejects(registered.get("chat_charter_propose").execute({ ...args, actor: "human:me" }, exec("a")), /unsupported/);
    await assert.rejects(registered.get("chat_memory").execute({ room: room.id }, exec("outsider")), /member/);
    const proposal = await registered.get("chat_charter_propose").execute(args, exec("a"));
    assert.equal(proposal.proposer.sessionId, "a");
    assert.equal(proposal.status, "pending");
    observe({ id: "a" }, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    await activate(1);
    const approved = await registered.get("chat_charter_review").execute({ room: room.id, proposalId: proposal.id, verdict: "approve", comment: "原纪律保留，新增要求来自用户" }, exec("b"));
    assert.equal(approved.status, "applied");
    const memory = await request(`/rooms/${room.id}/memory`);
    assert.equal(memory.history.length, 2);
    assert.equal(memory.profile.charter, args.charter);
    assert.deepEqual(memory.profile.source, room.profile.source);
    const read = await registered.get("chat_memory").execute({ room: room.id }, exec("b"));
    assert.equal(read.profile.revision, 2);
    assert.ok(read.messages.some((item) => item.id === source.id));
    assert.equal("messages" in memory, false);
    await request(`/rooms/${room.id}/profile/restore`, { revision: 1, expectedRevision: 2 });
    assert.equal((await request(`/rooms/${room.id}/memory`)).profile.charter, "原始纪律");
    const next = await registered.get("chat_charter_propose").execute({ ...args, baseRevision: 3 }, exec("b"));
    await request(`/rooms/${room.id}/proposals/${next.id}/dismiss`, {});
    assert.equal((await request(`/rooms/${room.id}/memory`)).proposals[1].status, "dismissed");
    const workArgs = { room: room.id, operationId: "adapter-task", action: "record", summary: "登记本轮核查", sourceMessageIds: [source.id], fields: { kind: "task", title: "核对来源", ownerSessionId: "b" } };
    await assert.rejects(registered.get("chat_work").execute({ ...workArgs, actor: "human:me" }, exec("b")), /unsupported/);
    let task = await registered.get("chat_work").execute(workArgs, exec("b"));
    assert.equal(task.createdBy, "session:b");
    task = await registered.get("chat_work").execute({ room: room.id, operationId: "adapter-ack", action: "acknowledge", entryId: task.id, expectedRevision: task.revision, summary: "本人收悉", sourceMessageIds: [source.id] }, exec("b"));
    task = await registered.get("chat_work").execute({ room: room.id, operationId: "adapter-submit", action: "submit", entryId: task.id, expectedRevision: task.revision, summary: "核对完成，请用户验收", deliverable: "来源核对表 v1", sourceMessageIds: [source.id] }, exec("b"));
    assert.equal(task.status, "in_review");
    task = await request(`/rooms/${room.id}/ledger/${task.id}`, { patch: { status: "done", reviewSummary: "我已核验交付结果" }, expectedRevision: task.revision });
    assert.equal(task.review.actor, "human:me");
    assert.equal(task.review.summary, "我已核验交付结果");
    task = await request(`/rooms/${room.id}/ledger/${task.id}/restore`, { revision: 1, expectedRevision: task.revision });
    assert.equal(task.status, "open");
    assert.equal(task.submission, undefined);
    assert.equal(task.acknowledgement, undefined);
  } finally {
    for (const dispose of disposers.reverse()) await dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
