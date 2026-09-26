import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DshChatLocalService} from "../lib/room-store.js";
import {snapshotMemberConfiguration,provisionConversationSession} from "../lib/native-conversations.js";

async function fixture(run,{replyTimeoutMs=500}={}){
  const dir=await mkdtemp(join(tmpdir(),"dcl-conversations-")),path=join(dir,"rooms.json");
  const calls=[],agents=new Map();let nativeWrites=0,disposed=0;
  const model={provider:"official",model:"research",reasoningEffort:"high"};
  const configs=new Map([["old-a",{cwd:dir,model:structuredClone(model)}],["old-b",{cwd:dir,model:{provider:"other",model:"review"}}]]);
  const ctx={get(name){return this[name];},
    sessionQuery:{async observeSession(id){const config=configs.get(id);if(!config)throw new Error("missing native session");return {header:{cwd:config.cwd},projections:{values:{modelSelection:{next:config.model}}},[Symbol.dispose](){disposed++;}};}},
    llm:{async resolveCallConfig(selection){return selection;}},agents:{get(id){return agents.get(id);}},
    permissionPresets:{resolve(preset){return {sandbox:preset,approval:preset==="danger-full-access"?"never":"ask"};},current(session){return session.preset??"read-only";},set(session,preset){session.preset=preset;nativeWrites++;}},
    sessionController:{async create({sessionId,cwd}){nativeWrites++;if(!agents.has(sessionId))agents.set(sessionId,{status:"idle",session:{id:sessionId,async flush(){}}});configs.set(sessionId,{cwd,model});return {sessionId};},async resolveAgent(id){return {agent:agents.get(id)};},async rename(){nativeWrites++;},agents:{selectForNextRequest(agent,selected){nativeWrites++;configs.get(agent.session.id).model=structuredClone(selected);}}},
    dshBridge:{async status(){return {state:"idle"};},async deliverExternal(from,to,text,delivery){calls.push({from,to,text,delivery});}}
  };
  const service=new DshChatLocalService(ctx,{path,replyTimeoutMs,maxReplies:1});
  const waitForCalls=expected=>until(()=>calls.length===expected,{
    label:`bridge delivery count ${expected}`,
    inspect:()=>({calls:calls.length,nativeWrites,preparing:service.sessionPreparations.size,pending:[...service.pending.values()].map(item=>({status:item.delivery.status,replyTimerStarted:item.timer!==undefined}))})
  });
  try{await run({service,ctx,path,dir,calls,configs,model,agents,waitForCalls,get nativeWrites(){return nativeWrites;},get disposed(){return disposed;}});}
  finally{await service.close();await rm(dir,{recursive:true,force:true});}
}
const seed=service=>service.createRoom({name:"团队",autoDeliver:true,members:[{kind:"session",sessionId:"old-a",alias:"秘书",role:"协调"},{kind:"session",sessionId:"old-b",alias:"审查",mandate:"独立核验"}],profile:{purpose:"旧任务",charter:"证据可定位"}});
const send=(service,id,text,extra={})=>service.send({roomId:id,author:"human:me",authorKind:"human",text,automaticDelivery:false,...extra});
// Native preparation includes durable writes. Bound elapsed time, not the number
// of polls, and retain state when a condition fails under the full suite's load.
async function until(predicate,{label="condition",inspect,timeoutMs=10_000}={}){
  const started=performance.now();
  while(performance.now()-started<timeoutMs){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error(`${label} timed out after ${Math.round(performance.now()-started)}ms${inspect?`: ${JSON.stringify(await inspect())}`:""}`);
}

test("v11 migration keeps legacy messages, work and Session bindings intact",()=>fixture(async h=>{
  const room=await seed(h.service);await send(h.service,room.id,"旧材料 /outside/paper.docx");await h.service.createLedgerEntry(room.id,{kind:"task",title:"旧任务"});
  const state=JSON.parse(await readFile(h.path,"utf8"));state.version=11;delete state.groups;delete state.workspace;delete state.rooms[0].groupId;
  // A real v11 fixture predates the additive v15 identity directory and `tick`.
  for(const member of state.rooms[0].members){delete member.agentId;delete member.agentRevision;delete member.participationId;}
  delete state.rooms[0].tick;
  const original=structuredClone(state.rooms[0]);await h.service.close();await writeFile(h.path,JSON.stringify(state));
  const restored=new DshChatLocalService(h.ctx,{path:h.path});
  try{
    await restored.ready;const saved=JSON.parse(await readFile(h.path,"utf8"));assert.equal(saved.version,17);assert.equal(saved.groups.length,1);assert.equal(saved.rooms.length,1);
    for(const member of saved.rooms[0].members){
      assert.ok(member.agentId);assert.equal(member.agentRevision,1);assert.ok(member.participationId);
      assert.ok(saved.workspace.agents.some(agent=>agent.id===member.agentId));
      assert.ok(saved.workspace.participations.some(participant=>participant.id===member.participationId&&participant.roomId===room.id&&participant.sessionId===member.sessionId));
      delete member.agentId;delete member.agentRevision;delete member.participationId;
    }
    delete saved.rooms[0].groupId;
    // `tick` is additive in v15: a v11 fixture has none, so the migration lands it at zero.
    assert.equal(saved.rooms[0].tick, 0);delete saved.rooms[0].tick;
    assert.deepEqual(saved.rooms[0],original);assert.equal(h.nativeWrites,0);
  }finally{await restored.close();}
}));

test("new conversation copies team preferences with new native IDs, but no task state, message history or file grants",()=>fixture(async h=>{
  const old=await seed(h.service);await send(h.service,old.id,"旧授权 /outside/old.docx");await h.service.createLedgerEntry(old.id,{kind:"task",title:"不要再推进"});
  const before=await h.service.exportRoom(old.id,"json");const fresh=await h.service.createConversation(old.groupId,{operationId:"new"});
  assert.equal(h.nativeWrites,0);assert.equal(h.disposed,2);assert.equal(fresh.name,"新对话");assert.equal(fresh.policy.defaultActionMode,"read_only_audit");
  assert.equal(fresh.messageCount,0);assert.equal(fresh.ledgerCount,0);assert.deepEqual(fresh.artifacts,[]);assert.deepEqual(fresh.sharedFiles,[]);assert.ok(!fresh.profile.purpose);
  assert.equal(fresh.members[0].role,"协调");assert.deepEqual(fresh.members[0].nativeSetup.config.model,h.model);
  for(const member of fresh.members){assert.ok(!old.members.some(item=>item.sessionId===member.sessionId));assert.equal(member.nativeSetup.state,"pending");}
  assert.deepEqual(JSON.parse((await h.service.exportRoom(old.id,"json")).content).room,JSON.parse(before.content).room);
  assert.equal((await h.service.listParticipants(fresh.id))[0].runtime.state,"unprepared");assert.deepEqual((await h.service.roomMemory(fresh.id)).sharedFiles,[]);
}));

test("concurrent creation and restart retries reuse one conversation; receipt content conflicts reject",()=>fixture(async h=>{
  const old=await seed(h.service);const [a,b]=await Promise.all([h.service.createConversation(old.id,{operationId:"double"}),h.service.createConversation(old.id,{operationId:"double"})]);
  assert.equal(a.id,b.id);assert.equal((await h.service.listRooms()).length,2);await assert.rejects(h.service.createConversation(old.id,{operationId:"double",title:"changed"}),/reused/);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{assert.equal((await reopened.createConversation(old.id,{operationId:"double"})).id,a.id);assert.equal((await reopened.listRooms()).length,2);}finally{await reopened.close();}
}));

test("failed creation save rejects acknowledgement; retry persists the original identity",()=>fixture(async h=>{
  const old=await seed(h.service);await rm(h.path);await mkdir(h.path);await assert.rejects(h.service.createConversation(old.id,{operationId:"disk-error"}));
  const id=(await h.service.listRooms()).find(room=>room.id!==old.id).id;await rm(h.path,{recursive:true});
  assert.equal((await h.service.createConversation(old.id,{operationId:"disk-error"})).id,id);assert.equal(JSON.parse(await readFile(h.path,"utf8")).rooms[1].id,id);
}));

test("branch carries selected provenance only and rejects cross-group or fabricated sources",()=>fixture(async h=>{
  const old=await seed(h.service),selected=await send(h.service,old.id,"引用正文 /outside/selected.docx");await send(h.service,old.id,"不选这条");
  const branch=await h.service.createConversation(old.id,{operationId:"branch",sourceRoomId:old.id,sourceMessageIds:[selected.id],background:"比较另一种解释"});
  assert.equal(branch.origin.messages.length,1);assert.equal(branch.origin.messages[0].id,selected.id);assert.equal(branch.messageCount,0);assert.equal(branch.ledgerCount,0);assert.deepEqual(branch.sharedFiles,[]);
  const other=await h.service.createRoom({name:"另一个组"});await assert.rejects(h.service.createConversation(other.id,{operationId:"wrong",sourceRoomId:old.id,sourceMessageIds:[selected.id]}),/群组/);
  await assert.rejects(h.service.createConversation(old.id,{operationId:"missing",sourceRoomId:old.id,sourceMessageIds:["missing"]}),/不存在/);await assert.rejects(h.service.createConversation(old.id,{operationId:"background",background:"no source"}),/真实来源/);
}));

test("native preparation is lazy and coalesced, persists configuration without model calls or global default writes",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"prepare"}),member=fresh.members[0];assert.equal(h.nativeWrites,0);
  await Promise.all([h.service.prepareMember(fresh.id,member.sessionId),h.service.prepareMember(fresh.id,member.sessionId)]);assert.equal(h.nativeWrites,4);assert.equal(h.calls.length,0);assert.deepEqual(h.configs.get(member.sessionId).model,h.model);
  assert.equal(h.agents.get(member.sessionId).session.preset,"read-only");
  await h.service.prepareMember(fresh.id,member.sessionId);assert.equal(h.nativeWrites,4);assert.equal(JSON.parse(await readFile(h.path,"utf8")).rooms[1].members[0].nativeSetup.state,"ready");
}));

test("send prepares only its target, excludes old context and does not stop another conversation",()=>fixture(async h=>{
  const old=await seed(h.service);await send(h.service,old.id,"OLD_SECRET_TASK_123");const fresh=await h.service.createConversation(old.id,{operationId:"send"});
  await send(h.service,old.id,"旧组仍在处理",{automaticDelivery:true,mentions:["session:old-b"]});await h.waitForCalls(1);
  await send(h.service,fresh.id,"NEW_TOPIC_ONLY",{automaticDelivery:true,mentions:[`session:${encodeURIComponent(fresh.members[0].sessionId)}`]});await h.waitForCalls(2);
  assert.equal(h.calls[1].to,fresh.members[0].sessionId);assert.ok(!h.calls[1].text.includes("OLD_SECRET_TASK_123"));assert.ok(h.calls[1].text.includes("NEW_TOPIC_ONLY"));assert.equal((await h.service.resolveRoom(old.id)).orchestration.state,"running");assert.equal((await h.service.listParticipants(fresh.id))[1].nativeSetup.state,"pending");
},{replyTimeoutMs:60_000}));

test("saved group defaults affect future conversations only; local model changes cannot drift frozen defaults",()=>fixture(async h=>{
  const old=await seed(h.service),first=await h.service.createConversation(old.id,{operationId:"first"});h.configs.get("old-a").model={provider:"changed",model:"new-model"};
  const second=await h.service.createConversation(old.id,{operationId:"second"});assert.deepEqual(second.members[0].nativeSetup.config.model,h.model);
  const group=(await h.service.listGroups())[0],room=await h.service.resolveRoom(old.id);await h.service.saveGroupDefaults(old.id,{expectedRevision:room.revision,expectedGroupRevision:group.revision,name:"重命名团队"});
  const third=await h.service.createConversation(old.id,{operationId:"third"});assert.equal(third.members[0].nativeSetup.config.model.model,"new-model");assert.deepEqual((await h.service.resolveRoom(first.id)).members[0].nativeSetup.config.model,h.model);assert.equal((await h.service.listGroups())[0].name,"重命名团队");
}));

test("full-access defaults require confirmation and provision actual native permissions",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"permission"});const full=await h.service.setRoomPolicy(fresh.id,{defaultActionMode:"full_access",expectedRevision:1,confirmRisk:true}),group=(await h.service.listGroups())[0];
  await assert.rejects(h.service.saveGroupDefaults(fresh.id,{expectedRevision:full.revision,expectedGroupRevision:group.revision}),/明确确认/);
  await h.service.saveGroupDefaults(fresh.id,{expectedRevision:full.revision,expectedGroupRevision:group.revision,confirmRisk:true});
  await assert.rejects(h.service.createConversation(old.id,{operationId:"full-unconfirmed"}),/確認/);
  const next=await h.service.createConversation(old.id,{operationId:"full-default",confirmRisk:true});assert.equal(next.policy.defaultActionMode,"full_access");assert.equal(next.members[0].nativeSetup.state,"pending");
  await h.service.prepareMember(next.id,next.members[0].sessionId);assert.equal(h.agents.get(next.members[0].sessionId).session.preset,"danger-full-access");
}));

test("first human message names the new conversation; subsequent messages preserve manual or automatic title",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"title"});await send(h.service,fresh.id,"讨论新的研究方法");let updated=await h.service.resolveRoom(fresh.id);assert.equal(updated.name,"讨论新的研究方法");
  await send(h.service,fresh.id,"不是新标题");assert.equal((await h.service.resolveRoom(fresh.id)).name,updated.name);updated=await h.service.resolveRoom(fresh.id);await h.service.setRoomDetails(fresh.id,{name:"手动主题",expectedRevision:updated.revision});await send(h.service,fresh.id,"再发一条");assert.equal((await h.service.resolveRoom(fresh.id)).name,"手动主题");
}));

test("native adapter releases failed observations and fails closed for unavailable model or unsupported Host",async()=>{
  let disposed=0,created=0;await assert.rejects(snapshotMemberConfiguration({sessionQuery:{async observeSession(){return {header:{},[Symbol.dispose](){disposed++;}};}}},{sessionId:"s",alias:"A"}),/无法读取/);assert.equal(disposed,1);
  const member={sessionId:"session-new",alias:"A",nativeSetup:{config:{cwd:"/tmp",model:{provider:"a",model:"b"}}}};await assert.rejects(provisionConversationSession({},member),/不支持/);
  await assert.rejects(provisionConversationSession({llm:{async resolveCallConfig(){return {provider:"wrong",model:"wrong"};}},sessionController:{create(){created++;},resolveAgent(){},agents:{selectForNextRequest(){}}}},member),/不再可用/);assert.equal(created,0);
});

test("copying a group reuses configuration but creates fresh bindings and leaves the original group untouched",()=>fixture(async h=>{
  const old=await seed(h.service),copy=await h.service.createRoom({name:"复制团队",copyFromRoomId:old.id});
  assert.notEqual(copy.groupId,old.groupId);assert.equal(copy.members.length,2);assert.notEqual(copy.members[0].sessionId,old.members[0].sessionId);assert.equal(copy.members[0].nativeSetup.state,"pending");assert.equal(copy.policy.defaultActionMode,"read_only_audit");assert.equal(h.nativeWrites,0);
  assert.equal((await h.service.listGroups()).find(group=>group.id===copy.id).defaults.frozen,true);
}));

test("local model selection updates only its member, leaves frozen defaults unchanged, rejects running conversations",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"models"});
  h.ctx.agentDefaultModel={saveSelection(){assert.fail("must not change global default");}};
  const selected=await h.service.selectMemberModel(fresh.id,fresh.members[0].sessionId,{provider:"local",model:"new"});assert.equal(selected.selected.model,"new");assert.equal(h.configs.get("old-a").model.model,"research");
  const another=await h.service.createConversation(old.id,{operationId:"models-other"});assert.equal(another.members[0].nativeSetup.config.model.model,"research");
  await send(h.service,fresh.id,"进行中",{automaticDelivery:true,mentions:[`session:${encodeURIComponent(fresh.members[0].sessionId)}`]});await h.waitForCalls(1);
  await assert.rejects(h.service.selectMemberModel(fresh.id,fresh.members[0].sessionId,{provider:"local",model:"another"}),/stop/);
// This test needs an active conversation, not the reply deadline to expire.
},{replyTimeoutMs:60_000}));

test("stopping while native preparation is pending never delivers or rewrites superseded status as failure",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"stop"});
  let release,started=false;const create=h.ctx.sessionController.create;
  h.ctx.sessionController.create=async request=>{started=true;await new Promise(resolve=>{release=resolve;});return create(request);};
  const message=await send(h.service,fresh.id,"开始",{automaticDelivery:true,mentions:[`session:${encodeURIComponent(fresh.members[0].sessionId)}`]});await until(()=>started);
  await h.service.stopRoom(fresh.id);release();await until(()=>h.service.sessionPreparations.size===0);
  assert.equal(h.calls.length,0);const saved=(await h.service.messages(fresh.id)).find(item=>item.id===message.id);assert.equal(saved.deliveries[0].status,"superseded");
}));

test("pending members can preview their Host-snapshotted workspace without preparing a native session",()=>fixture(async h=>{
  const old=await seed(h.service),fresh=await h.service.createConversation(old.id,{operationId:"file"});await writeFile(join(h.dir,"workspace.md"),"本对话工作目录文件");
  const result=await h.service.previewArtifact(fresh.id,{path:"workspace.md"});assert.match(result.content,/本对话工作目录文件/);assert.equal(h.nativeWrites,0);
  await assert.rejects(h.service.previewArtifact(fresh.id,{path:"/etc/hosts"}),/outside the authorized/);
}));

test("native Agent preset is copied as configuration, not an inherited Session log",async()=>{
  const config=await snapshotMemberConfiguration({sessionQuery:{async observeSession(){return {header:{cwd:"/tmp"},projections:{values:{agentPreset:"research-tools",modelSelection:{next:{provider:"p",model:"m"}}}},[Symbol.dispose](){}};}}},{sessionId:"source"});
  assert.equal(config.agentPreset,"research-tools");assert.equal("events" in config,false);
});
