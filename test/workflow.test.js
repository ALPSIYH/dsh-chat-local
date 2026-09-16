import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DshChatLocalService } from "../lib/room-store.js";

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function harness(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-workflow-test-"));
  const path = join(directory, "rooms.json");
  const calls = [];
  const ctx = {
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: {
      status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); }
    },
    get(name) { return this[name]; }
  };
  const config = { path, maxRounds: 1, maxReplies: 1, replyTimeoutMs: 5_000, monitorIntervalMs: 3_600_000, ...options };
  let service = new DshChatLocalService(ctx, config);
  let operationCount = 0;
  const activateCall = async (index) => {
    const call = await waitFor(() => calls[index], "an actual participant delivery");
    const turn = index + 1;
    await service.observeSessionEvent(call.to, { type: "turn/start", data: { turn } });
    await service.observeSessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text", text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] } });
    return call;
  };
  return {
    get service() { return service; }, path, calls,directory,
    activateCall,
    async finishCall(index, text = "(pass)") {
      const call = calls[index];
      const turn = index + 1;
      await service.observeSessionEvent(call.to, { type: "assistant/message", data: { turn, step: 1, message: { content: [{ type: "text", text }] } } });
      await service.observeSessionEvent(call.to, { type: "turn/end", data: { turn, reason: { kind: "completed" } } });
    },
    async room(name = "工作流验证") {
      return service.createRoom({ name, autoDeliver: true, members: ["秘书", "执行", "复核"].map((alias, i) => ({ kind: "session", sessionId: `s${i + 1}`, alias })) });
    },
    async activate(room, sessionId = "s1", text = "请登记讨论结论，核对依据并明确交接与验收。") {
      await service.stopRoom(room.id);
      const index = calls.length;
      const source = await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text, mentions: [sessionId] });
      const call = await activateCall(index);
      assert.equal(call.to, sessionId);
      return source;
    },
    command(source, input = {}) {
      return { operationId: `work-test-${++operationCount}`, sourceMessageIds: [source.id], summary: "根据本轮讨论登记可核对的状态变化", ...input };
    },
    async reopen() {
      await service.close();
      service = new DshChatLocalService(ctx, config);
      await service.ready;
    },
    async cleanup() {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

const taskFields = (extra = {}) => ({ kind: "task", title: "核对统计口径", details: "对照原始报告逐项核对", acceptanceCriteria: "列出原始出处、口径和页码", ownerSessionId: "s2", reviewerSessionId: "s3", ...extra });
const byId = async (h, room, entry) => (await h.service.listLedger(room.id, { includeArchived: true })).find((item) => item.id === entry.id);

test("ignoring an obsolete blocker needs no successful permission preflight and preserves an undoable history",async()=>{
  const h=await harness();try{
    const room=await h.room(),source=await h.activate(room,"s2");
    let entry=await h.service.createLedgerEntry(room.id,taskFields());
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:entry.id,expectedRevision:entry.revision}));
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"progress",entryId:entry.id,expectedRevision:entry.revision,state:"blocked",blocker:{kind:"permission",summary:"历史权限错误",nextStep:"核对是否仍适用",filePaths:["/obsolete/no-longer-needed.docx"]}}));
    await h.service.stopRoom(room.id);
    const before=entry,calls=h.calls.length,policy=(await h.service.resolveRoom(room.id)).policy;
    assert.equal((await h.service.inspectLedgerRecovery(room.id,entry.id)).canRetry,false);
    const request={action:"dismiss_blocker",expectedRevision:entry.revision,operationId:"ignore-once",note:"   "};
    entry=await h.service.triageLedgerEntry(room.id,entry.id,request);
    assert.equal(entry.status,"open");assert.equal(entry.triage.action,"dismiss_blocker");
    for(const key of ["blocker","progress","acknowledgement","submission","review","handoff","monitor"])assert.equal(entry[key],undefined,key);
    assert.deepEqual(entry.history.at(-1).before.blocker,before.blocker);
    assert.equal((await h.service.listRooms())[0].workSummary.blocked,0);assert.equal((await h.service.listRooms())[0].workSummary.needsUser,0);
    await h.service.triageLedgerEntry(room.id,entry.id,request);assert.equal((await byId(h,room,entry)).revision,entry.revision);
    await assert.rejects(h.service.triageLedgerEntry(room.id,entry.id,{...request,note:"different"}),/different triage/);
    await h.reopen();entry=await byId(h,room,entry);assert.equal(entry.triage.action,"dismiss_blocker");
    entry=await h.service.triageLedgerEntry(room.id,entry.id,{action:"restore",expectedRevision:entry.revision,operationId:"undo-ignore"});
    assert.equal(entry.status,"blocked");assert.deepEqual(entry.blocker,before.blocker);assert.deepEqual(entry.progress,before.progress);
    assert.equal(entry.triage,undefined);assert.equal(h.calls.length,calls);assert.deepEqual((await h.service.resolveRoom(room.id)).policy,policy);
  }finally{await h.cleanup();}
});

test("removing a task archives reversibly without accepting it or completing its dependents",async()=>{
  const h=await harness();try{
    const room=await h.room(),source=await h.activate(room,"s2");
    let task=await h.service.createLedgerEntry(room.id,taskFields()),dependent=await h.service.createLedgerEntry(room.id,taskFields({title:"后续任务"}));
    dependent=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:dependent.id,expectedRevision:dependent.revision}));
    dependent=await h.service.operateWork(room.id,"s2",h.command(source,{action:"progress",entryId:dependent.id,expectedRevision:dependent.revision,state:"blocked",blocker:{kind:"dependency",summary:"等待前项",entryIds:[task.id]}}));
    const calls=h.calls.length;
    task=await h.service.triageLedgerEntry(room.id,task.id,{action:"archive",expectedRevision:task.revision,operationId:"remove"});
    assert.equal(task.status,"archived");assert.equal(task.review,undefined);assert.ok(!(await h.service.listLedger(room.id)).some(item=>item.id===task.id));
    assert.equal((await h.service.inspectLedgerRecovery(room.id,dependent.id)).canRetry,false);
    task=await h.service.triageLedgerEntry(room.id,task.id,{action:"restore",expectedRevision:task.revision,operationId:"restore"});
    assert.equal(task.status,"open");assert.equal(task.review,undefined);assert.equal(h.calls.length,calls);
    assert.equal(task.history.at(-2).after.status,"archived");
  }finally{await h.cleanup();}
});

test("ignoring a queued recovery cancels that notice and disables its reminder without stopping another round",async()=>{
  const h=await harness();try{
    const room=await h.room();let entry=await h.service.createLedgerEntry(room.id,taskFields({status:"blocked",monitor:{enabled:true,coordinatorSessionId:"s1",idleMinutes:1}}));
    const source=await h.activate(room);
    entry=await h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"queued-recovery"});assert.equal(entry.handoff.state,"queued");
    entry=await h.service.triageLedgerEntry(room.id,entry.id,{action:"dismiss_blocker",expectedRevision:entry.revision,operationId:"discard-old"});
    assert.equal(entry.handoff,undefined);assert.equal(entry.monitor,undefined);assert.equal((await h.service.resolveRoom(room.id)).orchestration.rootMessageId,source.id);
    await h.finishCall(0);await waitFor(async()=>(await h.service.resolveRoom(room.id)).orchestration.state==="idle","original round completion");
    assert.equal(h.calls.length,1);
  }finally{await h.cleanup();}
});

test("an old ignore undo cannot overwrite newer work or be forged through Agent fields",async()=>{
  const h=await harness();try{
    const room=await h.room(),source=await h.activate(room,"s2");let entry=await h.service.createLedgerEntry(room.id,taskFields({status:"blocked"}));
    await assert.rejects(h.service.operateWork(room.id,"s2",h.command(source,{action:"amend",entryId:entry.id,expectedRevision:entry.revision,fields:{triage:{action:"dismiss_blocker"}}})),/unsupported/);
    entry=await h.service.triageLedgerEntry(room.id,entry.id,{action:"dismiss_blocker",expectedRevision:entry.revision,operationId:"ignore"});
    const stale=entry.revision;
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:entry.id,expectedRevision:entry.revision}));
    assert.equal(entry.triage,undefined);
    await assert.rejects(h.service.triageLedgerEntry(room.id,entry.id,{action:"restore",expectedRevision:stale,operationId:"stale-undo"}),/revision conflict/);
    await assert.rejects(h.service.triageLedgerEntry(room.id,entry.id,{action:"restore",expectedRevision:entry.revision,operationId:"changed-undo"}),/has changed/);
    assert.equal((await byId(h,room,entry)).status,"in_progress");
  }finally{await h.cleanup();}
});

test("restoring an archived accepted decision requires a fresh choice",async()=>{
  const h=await harness();try{
    const room=await h.room();let entry=await h.service.createLedgerEntry(room.id,{kind:"decision",title:"历史权限请求"});
    entry=await h.service.updateLedgerEntry(room.id,entry.id,{status:"decided"},{expectedRevision:entry.revision});
    entry=await h.service.triageLedgerEntry(room.id,entry.id,{action:"archive",expectedRevision:entry.revision,operationId:"archive-decision"});
    entry=await h.service.triageLedgerEntry(room.id,entry.id,{action:"restore",expectedRevision:entry.revision,operationId:"restore-decision"});
    assert.equal(entry.status,"proposed");assert.equal(entry.review,undefined);assert.equal(h.calls.length,0);
  }finally{await h.cleanup();}
});

test("a blocked task requiring recovery cannot disappear from the user action count",async()=>{
  const h=await harness();try{
    const room=await h.room();
    await h.service.createLedgerEntry(room.id,taskFields({status:"blocked",details:"等待用户提供可读材料"}));
    const view=(await h.service.listRooms()).find(item=>item.id===room.id);
    assert.equal(view.workSummary.blocked,1);
    assert.equal(view.workSummary.needsUser,1,"blocked legacy records need a visible recovery path, not 0 actions");
  }finally{await h.cleanup();}
});

test("a decision notification deferred during a running round is delivered after that round",async()=>{
  const h=await harness();try{
    const room=await h.room();
    const task=await h.service.createLedgerEntry(room.id,taskFields());
    const decision=await h.service.createLedgerEntry(room.id,{kind:"decision",title:"恢复处理方式",relatedEntryIds:[task.id]});
    await h.activate(room);
    const saved=await h.service.updateLedgerEntry(room.id,decision.id,{status:"decided",notifyParticipants:true},{expectedRevision:decision.revision});
    assert.equal(saved.notification.state,"deferred");assert.equal(h.calls.length,1);
    await h.finishCall(0);
    await waitFor(()=>h.calls[1],"deferred decision notification after current round");
    assert.equal(h.calls[1].to,"s2");
    assert.ok((await h.service.messages(room.id)).some(message=>message.author==="system:decision"&&message.text.includes("恢复处理方式")));
  }finally{await h.cleanup();}
});

test("recovery checks are read-only and sharing one material neither grants neighbors nor interrupts a round",async()=>{
  const h=await harness();try{
    const room=await h.room(),path=join(h.directory,"actual paper.txt"),neighbor=join(h.directory,"neighbor.txt");
    await writeFile(path,"correct version of the material");await writeFile(neighbor,"not shared");
    const entry=await h.service.createLedgerEntry(room.id,taskFields({title:`核对材料 [额外文件](<${neighbor}>)`,status:"blocked",details:`需要只读审阅：[材料](<${path}>)`}));
    const before=await readFile(h.path,"utf8");
    const failed=await h.service.inspectLedgerRecovery(room.id,entry.id);
    assert.equal(failed.files[0].status,"unavailable");assert.equal(failed.canRetry,false);assert.equal(await readFile(h.path,"utf8"),before);
    await assert.rejects(h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"not-ready"}),/恢复条件/);
    const source=await h.activate(room);
    const check=await h.service.shareLedgerFile(room.id,entry.id,{path,expectedRevision:entry.revision,operationId:"single-file"});
    assert.equal(check.files[0].status,"readable");assert.equal(check.canRetry,true);
    assert.equal((await h.service.resolveRoom(room.id)).orchestration.rootMessageId,source.id);
    assert.equal(h.calls.length,1);assert.equal((await byId(h,room,entry)).status,"blocked");
    await assert.rejects(h.service.previewArtifact(room.id,{path:neighbor}),/outside/);
    await h.service.shareLedgerFile(room.id,entry.id,{path,expectedRevision:entry.revision,operationId:"single-file"});
    assert.equal((await h.service.messages(room.id)).filter(item=>item.clientOperationId==="ledger-share:single-file").length,1);
    assert.equal((await h.service.resolveRoom(room.id)).policy.defaultActionMode,"discuss_only");
  }finally{await h.cleanup();}
});

test("a recovery request is idempotent, keeps blocked until a real report, and shows missing reports",async()=>{
  const h=await harness();try{
    const room=await h.room();let entry=await h.service.createLedgerEntry(room.id,taskFields({status:"blocked"}));
    const request={expectedRevision:entry.revision,operationId:"retry-once",note:"核对当前条件"};
    entry=await h.service.requestLedgerHandoff(room.id,entry.id,request);
    await h.activateCall(0);assert.equal(h.calls[0].to,"s2");assert.equal(entry.status,"blocked");assert.equal(entry.handoff.state,"waiting_report");
    await h.service.requestLedgerHandoff(room.id,entry.id,request);assert.equal(h.calls.length,1);
    await assert.rejects(h.service.requestLedgerHandoff(room.id,entry.id,{...request,note:"changed"}),/different recovery content/);
    await h.finishCall(0);
    await waitFor(async()=>((await byId(h,room,entry)).handoff.state==="needs_report"),"missing recovery report remains visible");
    assert.equal((await byId(h,room,entry)).status,"blocked");
    assert.equal((await h.service.listRooms())[0].workSummary.needsUser,1);
  }finally{await h.cleanup();}
});

test("queued handoffs survive restart as interrupted and stop never silently resumes them",async()=>{
  const h=await harness();try{
    const room=await h.room();let entry=await h.service.createLedgerEntry(room.id,taskFields({status:"blocked"}));
    await h.activate(room);
    entry=await h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"defer"});
    assert.equal(entry.handoff.state,"queued");assert.equal(h.calls.length,1);
    await h.reopen();entry=await byId(h,room,entry);assert.equal(entry.handoff.state,"interrupted");assert.equal(h.calls.length,1);
    await h.activate(room);
    entry=await h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"defer-again"});
    await h.service.stopRoom(room.id);
    assert.equal((await byId(h,room,entry)).handoff.state,"interrupted");assert.equal(h.calls.length,2);
  }finally{await h.cleanup();}
});

test("handoff targets ignore @ names embedded in task descriptions",async()=>{
  const h=await harness();try{
    const room=await h.room();const entry=await h.service.createLedgerEntry(room.id,taskFields({title:"核对材料 @复核"}));
    await h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"exact-owner"});
    const notice=(await h.service.messages(room.id)).find(item=>item.author==="system:work-handoff");
    assert.deepEqual(notice.mentions,["session:s2"]);assert.equal(notice.scheduledCount,1);
  }finally{await h.cleanup();}
});

test("a UI-created task can be acknowledged and reported using its auditable human handoff source",async()=>{
  const h=await harness();try{
    const room=await h.room();let entry=await h.service.createLedgerEntry(room.id,taskFields({status:"blocked"}));
    entry=await h.service.requestLedgerHandoff(room.id,entry.id,{expectedRevision:entry.revision,operationId:"start-no-chat"});
    await h.activateCall(0);
    const source=(await h.service.messages(room.id)).find(message=>message.id===entry.handoff.messageId);
    assert.equal(source.humanAction.entryId,entry.id);
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:entry.id,expectedRevision:entry.revision}));
    assert.equal(entry.status,"blocked");
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"progress",entryId:entry.id,expectedRevision:entry.revision,state:"in_progress",summary:"已实测依赖条件满足，继续核验"}));
    assert.equal(entry.status,"in_progress");assert.equal(entry.handoff.state,"reported");
    assert.equal(entry.history.at(-1).after.handoff.state,"reported");
    assert.equal(entry.history.at(-1).sources[0].humanAction.entryId,entry.id);
    await h.finishCall(0);await waitFor(async()=>(await h.service.resolveRoom(room.id)).orchestration.state==="idle","round completion");
    assert.equal((await byId(h,room,entry)).handoff.state,"reported");
  }finally{await h.cleanup();}
});

test("structured prerequisites reject cycles and archived prerequisites do not mean fulfilled",async()=>{
  const h=await harness();try{
    const room=await h.room(),source=await h.activate(room,"s2");
    let a=await h.service.createLedgerEntry(room.id,taskFields({title:"任务 A"})),b=await h.service.createLedgerEntry(room.id,taskFields({title:"任务 B"}));
    const act=async(entry,input)=>h.service.operateWork(room.id,"s2",h.command(source,{entryId:entry.id,expectedRevision:entry.revision,...input}));
    a=await act(a,{action:"acknowledge"});b=await act(b,{action:"acknowledge"});
    a=await act(a,{action:"progress",state:"blocked",blocker:{kind:"dependency",summary:"需要任务 B",entryIds:[b.id]}});
    await assert.rejects(act(b,{action:"progress",state:"blocked",blocker:{kind:"dependency",summary:"需要任务 A",entryIds:[a.id]}}),/cycle/);
    await assert.rejects(act(b,{action:"progress",state:"blocked",blocker:{kind:"dependency",summary:"无效事项",entryIds:["another-room"]}}),/this room/);
    assert.equal((await h.service.inspectLedgerRecovery(room.id,a.id)).canRetry,false);
    b=await h.service.updateLedgerEntry(room.id,b.id,{status:"archived"},{expectedRevision:b.revision});
    assert.equal((await h.service.inspectLedgerRecovery(room.id,a.id)).canRetry,false);
    b=await h.service.updateLedgerEntry(room.id,b.id,{status:"done"},{expectedRevision:b.revision});
    assert.equal((await h.service.inspectLedgerRecovery(room.id,a.id)).canRetry,true);
  }finally{await h.cleanup();}
});

test("a user selects one structured option without typing; the recorded choice never grants permissions",async()=>{
  const h=await harness();try{
    const room=await h.room(), source=await h.activate(room);
    const task=await h.service.operateWork(room.id,"s1",h.command(source,{action:"record",fields:taskFields()}));
    let entry=await h.service.operateWork(room.id,"s1",h.command(source,{action:"record",fields:{kind:"decision",title:"如何恢复审阅",question:"使用现有 DOCX 还是等待新稿？",relatedEntryIds:[task.id],decisionOptions:[{id:"read",label:"读取现有 DOCX",description:"只读，不修改正文"},{id:"wait",label:"等待新稿",description:"当前审阅继续暂停"}]}}));
    await assert.rejects(h.service.updateLedgerEntry(room.id,entry.id,{status:"decided"},{expectedRevision:entry.revision}),/select one/);
    await assert.rejects(h.service.updateLedgerEntry(room.id,entry.id,{status:"decided",selectedOptionId:"all-permissions"},{expectedRevision:entry.revision}),/current option/);
    entry=await h.service.updateLedgerEntry(room.id,entry.id,{status:"decided",selectedOptionId:"read",reviewSummary:"   "},{expectedRevision:entry.revision});
    assert.equal(entry.review.selectedOption.id,"read");assert.match(entry.review.summary,/读取现有 DOCX/);assert.equal((await h.service.resolveRoom(room.id)).policy.defaultActionMode,"discuss_only");
    entry=await h.service.updateLedgerEntry(room.id,entry.id,{decisionOptions:[{id:"read",label:"改稿",description:"修改正文"},{id:"wait",label:"等待",description:"不执行"}]},{expectedRevision:entry.revision});
    assert.equal(entry.status,"proposed");assert.equal(entry.review,undefined);
  }finally{await h.cleanup();}
});

test("acknowledgement does not silently resolve a blocker; a verified progress report does",async()=>{
  const h=await harness();try{
    const room=await h.room(),source=await h.activate(room,"s2");
    let entry=await h.service.createLedgerEntry(room.id,taskFields());
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:entry.id,expectedRevision:entry.revision}));
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"progress",entryId:entry.id,expectedRevision:entry.revision,state:"blocked",blocker:{kind:"file",summary:"无法读取正文",nextStep:"提供同版正文",filePaths:["/example/manuscript.docx"]}}));
    assert.equal(entry.blocker.kind,"file");
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"acknowledge",entryId:entry.id,expectedRevision:entry.revision}));
    assert.equal(entry.status,"blocked");
    entry=await h.service.operateWork(room.id,"s2",h.command(source,{action:"progress",entryId:entry.id,expectedRevision:entry.revision,state:"in_progress",summary:"已读取正确版本并开始核验"}));
    assert.equal(entry.status,"in_progress");assert.equal(entry.blocker,undefined);
    assert.ok(entry.history.some(event=>event.after?.blocker?.kind==="file"));
  }finally{await h.cleanup();}
});

test("decision notification targets the proposer and related owner without interrupting a running round",async()=>{
  const h=await harness();try{
    const room=await h.room(), source=await h.activate(room);
    const task=await h.service.operateWork(room.id,"s1",h.command(source,{action:"record",fields:taskFields()}));
    let decision=await h.service.operateWork(room.id,"s1",h.command(source,{action:"record",fields:{kind:"decision",title:"测试待决",relatedEntryIds:[task.id]}}));
    const deferred=await h.service.updateLedgerEntry(room.id,decision.id,{status:"decided",notifyParticipants:true},{expectedRevision:decision.revision});assert.equal(deferred.notification.state,"deferred");assert.equal(h.calls.length,1);
    await h.service.stopRoom(room.id);
    decision=await h.service.updateLedgerEntry(room.id,decision.id,{status:"proposed"},{expectedRevision:deferred.revision});
    const sent=await h.service.updateLedgerEntry(room.id,decision.id,{status:"decided",notifyParticipants:true},{expectedRevision:decision.revision});assert.equal(sent.notification.state,"sent");assert.deepEqual(sent.notification.sessionIds,["s1","s2"]);
    const notice=(await h.service.messages(room.id)).find(m=>m.author==="system:decision");assert.deepEqual(notice.mentions,["session:s1","session:s2"]);
  }finally{await h.cleanup();}
});

test("archiving never invents acceptance and reopening clears prior review metadata", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    let entry = await h.service.createLedgerEntry(room.id, taskFields());
    const update = async (status, reviewSummary) => {
      entry = await h.service.updateLedgerEntry(room.id, entry.id, { status, reviewSummary }, { expectedRevision: entry.revision });
    };
    await update("archived");
    assert.equal(entry.review, undefined);
    await update("open");
    await update("done", "用户核对结果后明确验收");
    const acceptance = entry.review;
    await update("archived");
    assert.deepEqual(entry.review, acceptance);
    await update("open");
    assert.equal(entry.review, undefined);
    assert.equal(entry.submission, undefined);
    assert.equal(entry.acknowledgement, undefined);
    assert.equal(entry.history.at(-1).before.review.summary, "用户核对结果后明确验收");
  } finally { await h.cleanup(); }
});

test("editing an adopted decision requires a new decision instead of retaining the prior approval", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    let entry = await h.service.createLedgerEntry(room.id, { kind: "decision", title: "采用口径 A" });
    entry = await h.service.updateLedgerEntry(room.id, entry.id, { status: "decided", reviewSummary: "确认采用 A" }, { expectedRevision: entry.revision });
    entry = await h.service.updateLedgerEntry(room.id, entry.id, { title: "改用口径 B", status: "decided" }, { expectedRevision: entry.revision });
    assert.equal(entry.status, "proposed");
    assert.equal(entry.review, undefined);
    assert.equal(entry.history.at(-1).before.review.summary, "确认采用 A");
  } finally { await h.cleanup(); }
});

test("commenting on a legacy record does not manufacture creator authority", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const initial = await h.service.createLedgerEntry(room.id, { kind: "task", title: "旧版未指定负责人事项" });
    await h.service.close();
    const state = JSON.parse(await readFile(h.path, "utf8"));
    delete state.rooms[0].ledger[0].createdBy;
    await writeFile(h.path, JSON.stringify(state));
    await h.reopen();
    const source = await h.activate(room);
    const commented = await h.service.operateWork(room.id, "s1", h.command(source, { action: "comment", entryId: initial.id, expectedRevision: initial.revision }));
    assert.equal(commented.createdBy, "system:legacy");
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "amend", entryId: initial.id, expectedRevision: commented.revision, fields: { title: "无权改写旧事项" } })), /only the recorder or task owner/);
  } finally { await h.cleanup(); }
});

test("work closes the record → owner acknowledgement → submission → independent review loop", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    assert.equal(entry.status, "open");
    assert.equal(entry.revision, 1);

    await h.activate(room, "s2");
    await assert.rejects(() => h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "口径表 v1" })));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    assert.equal(entry.status, "in_progress");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "progress", entryId: entry.id, expectedRevision: entry.revision, state: "blocked", summary: "原始报告缺第 3 页，无法核对分母" }));
    assert.equal(entry.status, "blocked");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "口径核对表 v1；报告第 3 页" }));
    assert.equal(entry.status, "in_review");
    assert.equal(entry.submission.deliverable, "口径核对表 v1；报告第 3 页");
    await assert.rejects(() => h.service.operateWork(room.id, "s2", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve" })));

    await h.activate(room, "s3");
    entry = await h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "request_changes", summary: "出处完整，但分母定义仍需补充" }));
    assert.equal(entry.status, "in_progress");
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "口径核对表 v2，已补充分母定义" }));
    await h.activate(room, "s3");
    entry = await h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve", summary: "逐项核对出处、页码及分母定义，满足验收条件" }));
    assert.equal(entry.status, "done");
    assert.equal((await byId(h, room, entry)).status, "done");
    const events = entry.history.filter((event) => event.operationId);
    assert.equal(events.length, 7);
    assert.equal(new Set(events.map((event) => event.operationId)).size, 7);
    assert.ok(events.every((event) => Number.isInteger(event.revision) && event.after && event.summary && event.sources?.length));
    assert.equal(events.at(-1).before.status, "in_review");
    assert.equal(events.at(-1).after.status, "done");
  } finally { await h.cleanup(); }
});

test("work operation keys are idempotent, reject changed payloads and survive restart", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const command = h.command(source, { action: "record", fields: taskFields() });
    const entry = await h.service.operateWork(room.id, "s1", command);
    const repeated = await h.service.operateWork(room.id, "s1", command);
    assert.equal(repeated.id, entry.id);
    assert.equal(repeated.revision, entry.revision);
    assert.equal((await h.service.listLedger(room.id)).length, 1);
    await assert.rejects(() => h.service.operateWork(room.id, "s1", { ...command, fields: taskFields({ title: "偷偷改变同一操作的内容" }) }));
    await h.service.stopRoom(room.id);
    await h.reopen();
    await h.activate(room);
    const replay = await h.service.operateWork(room.id, "s1", command);
    assert.equal(replay.id, entry.id);
    assert.equal((await h.service.listLedger(room.id)).length, 1);
    assert.deepEqual((await byId(h, room, entry)).history, entry.history);
  } finally { await h.cleanup(); }
});

test("work writes reject inactive, wrong-session, cross-room and superseded turns", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const other = await h.room("另一个房间");
    const source = await h.activate(room);
    const make = () => h.command(source, { action: "record", fields: taskFields() });
    await assert.rejects(() => h.service.operateWork(room.id, "unknown-session", make()));
    await assert.rejects(() => h.service.operateWork(room.id, "s2", make()));
    await assert.rejects(() => h.service.operateWork(other.id, "s1", make()));
    await assert.rejects(() => h.service.operateWork(room.id, "s1", { ...make(), actor: "human:me" }));
    await h.service.stopRoom(room.id);
    await assert.rejects(() => h.service.operateWork(room.id, "s1", make()));
    assert.equal((await h.service.listLedger(room.id)).length, 0);
    assert.equal((await h.service.listLedger(other.id)).length, 0);
  } finally { await h.cleanup(); }
});

test("work rejects missing sources, sources from another room and unsafe write fields", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const other = await h.room("外部讨论");
    const foreign = await h.service.send({ roomId: other.id, author: "human:me", authorKind: "human", text: "这不是当前房间的依据", automaticDelivery: false });
    const source = await h.activate(room);
    for (const sourceMessageIds of [[], ["missing-id"], [foreign.id], Array(9).fill(source.id)]) {
      await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "record", sourceMessageIds, fields: taskFields() })));
    }
    for (const extra of [{ status: "done" }, { monitor: { enabled: true, coordinatorSessionId: "s1" } }, { actor: "human:me" }, { ownerSessionId: "outsider" }, { reviewerSessionId: "s2" }]) {
      await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields(extra) })));
    }
    assert.equal((await h.service.listLedger(room.id)).length, 0);
  } finally { await h.cleanup(); }
});

test("work assignment requires the recipient's own acknowledgement and an unassigned task can be claimed", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let assigned = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "acknowledge", entryId: assigned.id, expectedRevision: assigned.revision })));
    await h.activate(room, "s2");
    assigned = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: assigned.id, expectedRevision: assigned.revision }));
    assert.equal(assigned.ownerSessionId, "s2");
    assert.equal(assigned.status, "in_progress");
    await h.activate(room, "s1");
    const { ownerSessionId, ...unassignedFields } = taskFields({ title: "待认领的核对任务" });
    let unassigned = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: unassignedFields }));
    await h.activate(room, "s2");
    unassigned = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: unassigned.id, expectedRevision: unassigned.revision }));
    assert.equal(unassigned.ownerSessionId, "s2");
    assert.equal(unassigned.status, "in_progress");
  } finally { await h.cleanup(); }
});

test("work scope amendments reset acknowledgement and submission, preserving the old snapshot", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "原验收口径下的版本 v1" }));
    const oldRevision = entry.revision;
    await h.activate(room, "s3");
    await assert.rejects(() => h.service.operateWork(room.id, "s3", h.command(source, { action: "amend", entryId: entry.id, expectedRevision: entry.revision, fields: { acceptanceCriteria: "擅自改变范围" } })));
    await h.activate(room, "s1");
    entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "amend", entryId: entry.id, expectedRevision: entry.revision, fields: { acceptanceCriteria: "新增分组口径和分母复核" } }));
    assert.equal(entry.status, "open");
    assert.equal(entry.submission, undefined);
    assert.equal(entry.history.at(-1).before.submission.deliverable, "原验收口径下的版本 v1");
    assert.equal(entry.history.at(-1).after.acceptanceCriteria, "新增分组口径和分母复核");
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "amend", entryId: entry.id, expectedRevision: oldRevision, fields: { title: "过期版本覆盖" } })));
    await h.activate(room, "s2");
    await assert.rejects(() => h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "未经重新收悉就提交" })));
  } finally { await h.cleanup(); }
});

test("work decisions remain proposals and ordinary comments cannot forge collective approval", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: { kind: "decision", title: "候选路径 C", details: "先登记为待确认决定" } }));
    assert.equal(entry.status, "proposed");
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve" })));
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "amend", entryId: entry.id, expectedRevision: entry.revision, fields: { status: "decided" } })));
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "comment", entryId: entry.id, expectedRevision: entry.revision, summary: "我支持路径 C，但其他成员尚未确认" }));
    assert.equal(entry.status, "proposed");
    assert.equal(entry.history.at(-1).summary, "我支持路径 C，但其他成员尚未确认");
  } finally { await h.cleanup(); }
});

test("work comments preserve operational inactivity and the configured reminder deadline", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const created = await h.service.createLedgerEntry(room.id, { ...taskFields(), sourceMessageId: source.id, monitor: { enabled: true, coordinatorSessionId: "s1", idleMinutes: 120 } });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const commented = await h.service.operateWork(room.id, "s1", h.command(source, { action: "comment", entryId: created.id, expectedRevision: created.revision, summary: "补充说明，不代表任务取得进展" }));
    assert.equal(commented.status, created.status);
    assert.equal(commented.activityAt, created.activityAt);
    assert.equal(commented.monitor.nextReminderAt, created.monitor.nextReminderAt);
    assert.ok(commented.updatedAt > created.updatedAt);
    assert.equal(commented.revision, created.revision + 1);
  } finally { await h.cleanup(); }
});

test("restoring work appends a version and cannot revive prior acknowledgement or approval", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "待复核版本 v1" }));
    await h.activate(room, "s3");
    entry = await h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve" }));
    const completed = structuredClone(entry);
    const restored = await h.service.restoreLedgerEntry(room.id, entry.id, { revision: completed.revision, expectedRevision: completed.revision });
    assert.equal(restored.status, "open");
    assert.equal(restored.revision, completed.revision + 1);
    assert.equal(restored.submission, undefined);
    assert.equal(restored.monitor, undefined);
    assert.equal(restored.history.length, completed.history.length + 1);
    assert.deepEqual(restored.history.slice(0, -1), completed.history);
    assert.equal(restored.history.at(-1).before.status, "done");
    assert.equal(restored.history.at(-1).after.status, "open");
    await assert.rejects(() => h.service.restoreLedgerEntry(room.id, entry.id, { revision: 1, expectedRevision: completed.revision }));
    await h.activate(room, "s2");
    await assert.rejects(() => h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: restored.revision, deliverable: "重用旧的收悉与验收" })));
    await h.service.stopRoom(room.id);
    const saved = JSON.parse(await readFile(h.path, "utf8"));
    assert.equal(saved.rooms.find((item) => item.id === room.id).ledger.find((item) => item.id === entry.id).revision, restored.revision);
    await h.reopen();
    assert.deepEqual((await byId(h, room, entry)).history, restored.history);
  } finally { await h.cleanup(); }
});

test("work without a designated independent reviewer remains awaiting human acceptance", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const { reviewerSessionId, ...fields } = taskFields();
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields }));
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "提交版本 v1，请用户验收" }));
    await h.activate(room, "s3");
    await assert.rejects(() => h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve" })));
    assert.equal((await byId(h, room, entry)).status, "in_review");
  } finally { await h.cleanup(); }
});

test("work summaries expose unowned and orphaned tasks without hiding decisions and disputes", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const assigned = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    const unowned = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: { kind: "task", title: "尚未认领的补充核对" } }));
    await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: { kind: "decision", title: "等待确认的路径选择" } }));
    await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: { kind: "dispute", title: "尚未解决的识别争议" } }));
    const initial = await h.service.roomMemory(room.id, "s2");
    assert.ok(initial.myWork.some((item) => item.id === assigned.id));
    assert.ok(!initial.myWork.some((item) => item.id === unowned.id));
    assert.equal(initial.workSummary.pendingDecisions, 1);
    assert.equal(initial.workSummary.disputes, 1);
    assert.equal(initial.workSummary.orphaned, 0);
    assert.equal(initial.workSummary.needsUser, 3);
    await h.service.stopRoom(room.id);
    await h.service.removeMember(room.id, "s2");
    await h.service.removeMember(room.id, "s3");
    const summary = (await h.service.resolveRoom(room.id)).workSummary;
    assert.equal(summary.orphaned, 1, "losing both owner and reviewer counts the affected item only once");
    assert.equal(summary.needsUser, 4);
    assert.deepEqual((await h.service.roomMemory(room.id, "s1")).workSummary, summary);
    assert.deepEqual((await h.service.roomMemory(room.id, "s1")).myWork, []);
    assert.equal((await h.service.listLedger(room.id)).length, 4);
  } finally { await h.cleanup(); }
});

test("restoring a decided item reopens the proposal and Agent amendments cannot rewrite closed items", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: { kind: "decision", title: "路径选择", details: "待用户确认" } }));
    entry = await h.service.updateLedgerEntry(room.id, entry.id, { status: "decided", reviewSummary: "用户明确采用路径 C" }, { expectedRevision: entry.revision });
    assert.equal(entry.status, "decided");
    await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "amend", entryId: entry.id, expectedRevision: entry.revision, fields: { details: "Agent 无权改写已经闭环的决定" } })));
    const history = structuredClone(entry.history);
    const restored = await h.service.restoreLedgerEntry(room.id, entry.id, { revision: entry.revision, expectedRevision: entry.revision });
    assert.equal(restored.status, "proposed");
    assert.equal(restored.revision, entry.revision + 1);
    assert.deepEqual(restored.history.slice(0, -1), history);
  } finally { await h.cleanup(); }
});

test("matching work records with new operation keys reject conflicting owners or details and identify the existing item", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const originalCommand = h.command(source, { action: "record", fields: taskFields() });
    const original = await h.service.operateWork(room.id, "s1", originalCommand);
    for (const fields of [taskFields({ ownerSessionId: "s1" }), taskFields({ details: "同名同来源，但内容已被改变" })]) {
      await assert.rejects(() => h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields })), (error) => {
        assert.match(error.message, /already exists/i);
        assert.ok(error.message.includes(original.id), "conflict identifies the existing entry to inspect");
        return true;
      });
    }
    assert.deepEqual(await h.service.operateWork(room.id, "s1", originalCommand), original);
    assert.deepEqual(await h.service.listLedger(room.id), [original]);
  } finally { await h.cleanup(); }
});

test("human editing a submitted task cannot retain a stale in_review status after changing scope", async () => {
  const h = await harness();
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.activate(room, "s2");
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "变更前的口径表 v1" }));
    assert.equal(entry.status, "in_review");
    const changed = await h.service.updateLedgerEntry(room.id, entry.id, { ...taskFields(), acceptanceCriteria: "新增按年份拆分的分母核对", status: entry.status }, { expectedRevision: entry.revision });
    assert.equal(changed.status, "open");
    assert.equal(changed.submission, undefined);
    assert.equal(changed.acknowledgement, undefined);
    assert.equal(changed.review, undefined);
    assert.equal(changed.history.at(-1).before.submission.deliverable, "变更前的口径表 v1");
    assert.equal(changed.history.at(-1).after.status, "open");
    assert.equal((await h.service.resolveRoom(room.id)).workSummary.inReview, 0);
    await h.activate(room, "s3");
    await assert.rejects(() => h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: changed.id, expectedRevision: changed.revision, verdict: "approve" })));
  } finally { await h.cleanup(); }
});

test("idle monitoring preserves more than 100 work events and their idempotency keys", async () => {
  const h = await harness({ monitorMinuteMs: 10, monitorIntervalMs: 25 });
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const originalCommand = h.command(source, { action: "record", fields: taskFields() });
    const original = await h.service.operateWork(room.id, "s1", originalCommand);
    let entry = original;
    for (let i = 0; i < 105; i += 1) {
      entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "comment", entryId: entry.id, expectedRevision: entry.revision, summary: `审计附注 ${i + 1}，不冒充实质进展` }));
    }
    entry = await h.service.updateLedgerEntry(room.id, entry.id, { monitor: { enabled: true, coordinatorSessionId: "s1", idleMinutes: 1 } }, { expectedRevision: entry.revision });
    const preserved = structuredClone(entry.history);
    assert.ok(preserved.length > 100);
    await h.service.stopRoom(room.id);
    await waitFor(async () => (await h.service.messages(room.id)).some((item) => item.author === "system:task-monitor"), "the configured task monitor");
    const monitored = await byId(h, room, entry);
    assert.ok(monitored.history.length > preserved.length);
    assert.deepEqual(monitored.history.slice(0, preserved.length), preserved);
    assert.equal(monitored.history.filter((event) => event.operationId).length, 106);
    assert.equal(monitored.history.at(-1).type, "idle_reminder");
    const notice = (await h.service.messages(room.id)).find((item) => item.author === "system:task-monitor");
    assert.match(notice.text, /没有实质进展/);
    assert.doesNotMatch(notice.text, /没有人工推进/);
    // This assertion is about persistent idempotency, not racing a 10 ms periodic reminder.
    await h.service.updateLedgerEntry(room.id, entry.id, { monitor: { enabled: false } }, { expectedRevision: monitored.revision });
    await h.reopen();
    await h.activate(room);
    assert.deepEqual(await h.service.operateWork(room.id, "s1", originalCommand), original);
    assert.equal((await h.service.listLedger(room.id)).length, 1);
  } finally { await h.cleanup(); }
});

test("a secretary-only mention automatically routes acknowledgement, submission and independent review without further mentions", async () => {
  const h = await harness({ maxRounds: 2, maxReplies: 10 });
  try {
    const room = await h.room();
    const source = await h.activate(room, "s1");
    assert.deepEqual(source.mentions, ["session:s1"]);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.finishCall(0);
    const owner = await h.activateCall(1);
    assert.equal(owner.to, "s2");
    assert.ok(owner.text.includes(entry.id));
    assert.match(owner.text, /等待你本人收悉/);
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "按原讨论要求核验完成的口径表 v1" }));
    await h.finishCall(1);
    const reviewer = await h.activateCall(2);
    assert.equal(reviewer.to, "s3");
    assert.ok(reviewer.text.includes(entry.id));
    assert.match(reviewer.text, /你负责独立验收/);
    entry = await h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "approve", summary: "对照来源逐项核验，满足交付要求" }));
    await h.finishCall(2);
    const finished = await waitFor(async () => {
      const current = await h.service.resolveRoom(room.id);
      return current.orchestration.state === "idle" && current;
    }, "automatic work round completion");
    assert.deepEqual(h.calls.map((call) => call.to), ["s1", "s2", "s3"]);
    assert.equal((await byId(h, room, entry)).status, "done");
    assert.equal(finished.orchestration.visibleReplies, 0, "pass replies do not masquerade as public messages");
    const messages = await h.service.messages(room.id, 500);
    assert.equal(messages.filter((item) => item.authorKind === "human").length, 1);
    assert.equal(messages.filter((item) => item.authorKind === "session").length, 0);
    assert.ok(messages.filter((item) => item.ledgerEntryId === entry.id).length >= 4, "state transitions remain visible in system notices");
  } finally { await h.cleanup(); }
});

test("automatic work routing respects the per-participant turn ceiling and leaves rejected work visible", async () => {
  const h = await harness({ maxRounds: 1, maxReplies: 10 });
  try {
    const room = await h.room();
    const source = await h.activate(room);
    let entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.finishCall(0);
    await h.activateCall(1);
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "acknowledge", entryId: entry.id, expectedRevision: entry.revision }));
    entry = await h.service.operateWork(room.id, "s2", h.command(source, { action: "submit", entryId: entry.id, expectedRevision: entry.revision, deliverable: "仍需修订的口径表 v1" }));
    await h.finishCall(1);
    await h.activateCall(2);
    entry = await h.service.operateWork(room.id, "s3", h.command(source, { action: "review", entryId: entry.id, expectedRevision: entry.revision, verdict: "request_changes", summary: "来源与分母定义尚不一致" }));
    await h.finishCall(2);
    await waitFor(async () => (await h.service.resolveRoom(room.id)).orchestration.state === "idle", "bounded work round completion");
    const finished = await h.service.resolveRoom(room.id);
    assert.equal(finished.orchestration.endReason, "member_limit");
    assert.ok(finished.orchestration.pendingSessionIds.includes("s2"));
    assert.deepEqual(h.calls.map((call) => call.to), ["s1", "s2", "s3"]);
    assert.equal((await byId(h, room, entry)).status, "in_progress");
    assert.equal((await byId(h, room, entry)).review.verdict, "request_changes");
    assert.ok((await h.service.roomMemory(room.id, "s2")).myWork.some((item) => item.id === entry.id));
  } finally { await h.cleanup(); }
});

test("automatic work routing respects the visible-reply ceiling and preserves unacknowledged work", async () => {
  const h = await harness({ maxRounds: 3, maxReplies: 1 });
  try {
    const room = await h.room();
    const source = await h.activate(room);
    const entry = await h.service.operateWork(room.id, "s1", h.command(source, { action: "record", fields: taskFields() }));
    await h.finishCall(0, "已按原讨论登记核对事项，等待负责人本人收悉。");
    const finished = await waitFor(async () => {
      const current = await h.service.resolveRoom(room.id);
      return current.orchestration.state === "idle" && current;
    }, "reply-limited work round completion");
    assert.deepEqual(h.calls.map((call) => call.to), ["s1"]);
    assert.equal(finished.orchestration.visibleReplies, 1);
    assert.equal(finished.orchestration.endReason, "reply_limit");
    assert.ok(finished.orchestration.pendingSessionIds.includes("s2"));
    assert.equal(finished.workSummary.unacknowledged, 1);
    assert.equal((await byId(h, room, entry)).status, "open");
  } finally { await h.cleanup(); }
});
