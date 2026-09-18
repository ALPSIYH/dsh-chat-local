import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DshChatLocalService} from "../lib/room-store.js";
import {workProtocol} from "../lib/work-protocol.js";

async function fixture(run){
  const dir=await mkdtemp(join(tmpdir(),"dcl-workspace-")),path=join(dir,"rooms.json"),agents=new Map(),calls=[];let created=0;
  const model={provider:"test",model:"good"};
  const ctx={get(key){return this[key];},llm:{async resolveCallConfig(selection){if(selection.model==="missing")throw new Error("model unavailable");return selection;}},
    sessionController:{async create({sessionId}){created++;agents.set(sessionId,{status:"idle",session:{id:sessionId,async flush(){}}});return {sessionId};},async resolveAgent(id){return {agent:agents.get(id)};},async rename(){},agents:{selectForNextRequest(){}}},
    permissionPresets:{resolve(preset){return {sandbox:preset,approval:"ask"};},set(session,preset){session.preset=preset;},current(){return "read-only";}},agents:{get(id){return agents.get(id);}},dshBridge:{async status(){return {state:"idle"};},async deliverExternal(from,to,text,delivery){calls.push({from,to,text,delivery});}}
  };
  const service=new DshChatLocalService(ctx,{path,replyTimeoutMs:500,maxReplies:1});
  const member=(id="a")=>({id,alias:id.toUpperCase(),role:"审查",mandate:"独立核验",model});
  try{await run({dir,path,ctx,service,calls,member,get created(){return created;}});}finally{await service.close();await rm(dir,{recursive:true,force:true});}
}
const group=h=>h.service.workspace.createGroup({operationId:crypto.randomUUID(),name:"研究",members:[h.member()],environment:{cwd:h.dir}});

test("group recency follows its non-deleted conversation activity without rewriting group revision",()=>fixture(async h=>{
  const g=await group(h);
  const room=await h.service.createConversation(g.id,{operationId:"recency"});
  const listed=(await h.service.listGroups()).find(item=>item.id===g.id);
  assert.equal(listed.lastActivityAt,Math.max(g.updatedAt??g.createdAt,room.updatedAt));
  assert.equal(listed.revision,g.revision);
}));

test("a new group is independent of the currently viewed team; copying is explicit",()=>fixture(async h=>{
  const existing=await group(h);
  const fresh=await h.service.workspace.openDraft({kind:"group",groupId:existing.id});
  assert.equal(fresh.groupId,null);
  assert.deepEqual(fresh.members,[]);
  assert.equal(fresh.environment.cwd,"");
  const copied=await h.service.workspace.openDraft({kind:"group",sourceGroupId:existing.id,another:true});
  assert.equal(copied.members.length,1);
  assert.equal(copied.environment.cwd,"");
  assert.equal(copied.groupId,null);
  assert.equal(h.created,0);
}));

test("Agent directory saves reusable identity without creating a native session or carrying file permissions",()=>fixture(async h=>{
  const input={operationId:"agent-save",profile:{alias:"方法顧問",role:"研究設計",model:{},cwd:"/private",mode:"full_access"}};
  const saved=await h.service.directory.save(input);
  assert.equal(saved.alias,"方法顧問");
  assert.equal(saved.cwd,undefined);assert.equal(saved.mode,undefined);
  assert.equal((await h.service.directory.save(input)).id,saved.id);
  assert.equal((await h.service.directory.list()).length,1);
  assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("new Agent drafts publish only with their group, with one identity on retry and none on discard",()=>fixture(async h=>{
  let draft=await h.service.workspace.openDraft({kind:"group"});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,title:"新團隊",members:[{id:"provisional",alias:"新顧問",model:{}}]});
  assert.equal((await h.service.directory.list()).length,0);
  await h.service.workspace.discardDraft(draft.id,draft.revision);
  assert.equal((await h.service.directory.list()).length,0);
  draft=await h.service.workspace.openDraft({kind:"group",another:true});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,title:"新團隊",members:[{id:"provisional",alias:"新顧問",model:{}}]});
  const input={draftId:draft.id,expectedRevision:draft.revision,operationId:"publish-group",name:draft.title,members:draft.members,mode:"inherit_dsh"};
  const saved=await h.service.workspace.createGroup(input);
  assert.equal((await h.service.directory.list()).length,1);
  assert.equal(saved.defaults.members[0].agentId,(await h.service.directory.list())[0].id);
  assert.equal((await h.service.workspace.createGroup(input)).id,saved.id);
  assert.equal((await h.service.directory.list()).length,1);
  assert.equal(h.created,0);
}));

test("group member pool and new-conversation defaults are distinct, and per-topic selection stays local",()=>fixture(async h=>{
  let g=await group(h);
  g=await h.service.workspace.updateGroup(g.id,{expectedRevision:g.revision,operationId:"add-member",members:[...g.defaults.members,h.member("b")]});
  assert.equal(g.defaults.members.length,2);
  let draft=await h.service.workspace.openDraft({groupId:g.id,another:true});
  assert.deepEqual(draft.members.filter(m=>m.enabled).map(m=>m.alias),["A"]);
  g=await h.service.workspace.updateGroup(g.id,{expectedRevision:g.revision,operationId:"preselect",defaultParticipantIds:["b"]});
  draft=await h.service.workspace.openDraft({groupId:g.id,another:true});
  assert.deepEqual(draft.members.filter(m=>m.enabled).map(m=>m.alias),["B"]);
  await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:[h.member("c")]});
  const next=await h.service.workspace.openDraft({groupId:g.id,another:true});
  assert.deepEqual(next.members.filter(m=>m.enabled).map(m=>m.alias),["B"]);
}));

test("legacy Session membership migrates per conversation without merging same-name Agents or changing drafts",()=>fixture(async h=>{
  const a=await h.service.createRoom({name:"甲",members:[{kind:"session",sessionId:"shared",alias:"顧問"}]}),b=await h.service.createRoom({name:"乙",members:[{kind:"session",sessionId:"shared",alias:"顧問"}]});
  let draft=await h.service.workspace.openDraft({kind:"group"});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:[{...h.member(),enabled:false},h.member("b")],title:"未完草稿"});
  await h.service.close();
  const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{
    const directory=await reopened.directory.list();assert.equal(directory.length,2);
    const one=await reopened.resolveRoom(a.id),two=await reopened.resolveRoom(b.id);
    assert.equal(one.members[0].sessionId,"shared");assert.equal(two.members[0].sessionId,"shared");
    assert.notEqual(one.members[0].participationId,two.members[0].participationId);
    assert.notEqual(one.members[0].agentId,two.members[0].agentId);
    const saved=(await reopened.workspace.list()).drafts.find(d=>d.id===draft.id);
    assert.deepEqual(saved.members.map(m=>m.enabled),[false,true]);
  }finally{await reopened.close();}
}));

test("two topics reuse one Agent identity with independent Session contexts and preserve Agent versions",()=>fixture(async h=>{
  const agent=await h.service.directory.save({operationId:"identity",profile:{...h.member(),alias:"方法助手"}});
  const g=await h.service.workspace.createGroup({operationId:"team",name:"團隊",members:[await h.service.directory.selection(agent.id)],environment:{cwd:h.dir}});
  const topic=async text=>{let d=await h.service.workspace.openDraft({groupId:g.id,another:true});d=await h.service.workspace.saveDraft(d.id,{expectedRevision:d.revision,text,autoDeliver:false});return (await h.service.workspace.startDraft(d.id,{expectedRevision:d.revision})).room;};
  const a=await topic("甲主題"),b=await topic("乙主題");
  assert.equal(a.members[0].agentId,agent.id);assert.equal(b.members[0].agentId,agent.id);
  assert.notEqual(a.members[0].sessionId,b.members[0].sessionId);
  await h.service.directory.save({id:agent.id,expectedRevision:agent.revision,operationId:"update",profile:{...agent,alias:"新名字"}});
  assert.equal((await h.service.resolveRoom(a.id)).members[0].alias,"方法助手");
  assert.equal((await h.service.directory.list()).length,1);assert.equal(h.created,0);
}));

test("archiving an Agent hides only the library entry; archiving a group prevents new work until restored",()=>fixture(async h=>{
  const g=await group(h),agent=(await h.service.directory.list())[0];
  await h.service.directory.lifecycle(agent.id,{action:"archive",expectedRevision:agent.revision,operationId:"archive-agent"});
  assert.equal((await h.service.directory.list()).length,0);
  assert.equal((await h.service.workspace.configuration(g.id)).members.filter(m=>m.enabled).length,1);
  const archived=await h.service.setGroupLifecycle(g.id,{action:"archive",expectedRevision:g.revision,operationId:"archive-group"});
  await assert.rejects(h.service.workspace.openDraft({groupId:g.id,another:true}),/收存/);
  await assert.rejects(h.service.createConversation(g.id,{operationId:"blocked"}),/收存/);
  await h.service.setGroupLifecycle(g.id,{action:"restore",expectedRevision:archived.revision,operationId:"restore-group"});
  assert.equal((await h.service.workspace.openDraft({groupId:g.id,another:true})).members.length,1);
  assert.equal(h.calls.length,0);
}));

test("a library-archived Agent remains usable from the full group pool in new and existing topics",()=>fixture(async h=>{
  let g=await group(h);g=await h.service.workspace.updateGroup(g.id,{expectedRevision:g.revision,operationId:"pool-b",members:[...g.defaults.members,h.member("b")]});
  const existing=await h.service.createConversation(g.id,{operationId:"a-only"}),b=g.defaults.members.find(member=>member.id==="b");
  await h.service.directory.lifecycle(b.agentId,{action:"archive",expectedRevision:b.agentRevision,operationId:"archive-b"});
  assert.equal((await h.service.directory.list()).some(agent=>agent.id===b.agentId),false);
  const pool=await h.service.workspace.configuration(g.id,{all:true});assert.equal(pool.members.length,2);
  let draft=await h.service.workspace.openDraft({groupId:g.id,another:true});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"僅讓原群組 B 參與",members:pool.members.map(member=>({...member,enabled:member.id==="b"})),autoDeliver:false});
  const started=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(started.room.members[0].agentId,b.agentId);
  const current=await h.service.participantConfiguration(existing.id);
  const updated=await h.service.updateParticipants(existing.id,{expectedRevision:current.revision,operationId:"add-existing-pool-b",members:[...current.members,{...b,enabled:true}],environment:pool.environment});
  assert.equal(updated.members[1].agentId,b.agentId);
  // This roster screen is a membership change like any other, so the join it
  // makes is recorded in the room's log (R41) rather than only in rooms.json.
  assert.equal((await h.service.eventsFor(existing.id)).filter(event=>event.type==="member.added"&&event.payload.sessionId===updated.members[1].sessionId).length,1);
  await assert.rejects(h.service.workspace.createGroup({operationId:"outside-reuse",name:"其他群組",members:[b]}),/已從名冊收存/);
  assert.equal((await h.service.workspace.configuration(g.id)).members.filter(member=>member.enabled).length,1);assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("legacy createRoom and addMember publish durable identities without adding topic-only members to the group pool",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"舊入口",members:[{kind:"session",sessionId:"old-a",alias:"A"}]});
  assert.ok(room.members[0].agentId);assert.ok(room.members[0].participationId);
  const added=await h.service.addMember(room.id,{kind:"session",sessionId:"old-b",alias:"B"});
  assert.ok(added.agentId);assert.ok(added.participationId);
  assert.equal((await h.service.directory.list()).length,2);
  const group=(await h.service.listGroups()).find(group=>group.id===room.groupId);assert.deepEqual(group.defaults.members.map(member=>member.alias),["A"]);
  const before=(await h.service.resolveRoom(room.id)).members;
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{
    assert.deepEqual((await reopened.resolveRoom(room.id)).members,before);
    assert.equal((await reopened.directory.list()).length,2);
    const disk=JSON.parse(await readFile(h.path,"utf8"));assert.equal(disk.workspace.agents.length,2);assert.equal(disk.workspace.participations.length,2);
  }finally{await reopened.close();}
}));

test("loading an incomplete v15 identity migration persists its repair before reporting readiness",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"待補身分",members:[{kind:"session",sessionId:"old-a",alias:"A"}]});
  await h.service.close();const old=JSON.parse(await readFile(h.path,"utf8"));
  old.workspace.agents=[];old.workspace.participations=[];
  for(const member of [...old.rooms[0].members,...old.groups[0].defaults.members]){delete member.agentId;delete member.agentRevision;delete member.participationId;}
  await writeFile(h.path,JSON.stringify(old));
  const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{
    const loaded=await reopened.resolveRoom(room.id),disk=JSON.parse(await readFile(h.path,"utf8"));
    assert.ok(loaded.members[0].agentId);assert.equal(disk.version,15);assert.equal(disk.workspace.agents.length,1);assert.equal(disk.workspace.participations.length,1);
    assert.equal(disk.rooms[0].members[0].agentId,loaded.members[0].agentId);assert.equal(disk.rooms[0].members[0].participationId,loaded.members[0].participationId);
    assert.deepEqual(disk.rooms[0].messages,old.rooms[0].messages);assert.deepEqual(disk.rooms[0].ledger,old.rooms[0].ledger);
  }finally{await reopened.close();}
}));

test("adopting a topic as future defaults preserves the rest of the group pool and its environments",()=>fixture(async h=>{
  const other=join(h.dir,"other-member"),topic=join(h.dir,"topic");await mkdir(other);await mkdir(topic);
  const g=await h.service.workspace.createGroup({operationId:"pool",name:"獨立成員池",members:[h.member("a"),h.member("b")],environment:{cwd:h.dir,overrides:{b:other},presetOverrides:{b:"review-tools"}}});
  const b=g.defaults.members.find(member=>member.id==="b"),a=g.defaults.members.find(member=>member.id==="a");
  const room=await h.service.createConversation(g.id,{operationId:"local-topic",configuration:{members:[a,h.member("c")],environment:{cwd:topic},autoDeliver:false,mode:"read_only_audit"}});
  assert.equal((await h.service.listGroups()).find(group=>group.id===g.id).defaults.members.length,2);
  const updated=await h.service.saveGroupDefaults(room.id,{expectedRevision:room.revision,expectedGroupRevision:g.revision});
  assert.equal(updated.defaults.members.length,3);assert.deepEqual(updated.defaults.defaultParticipantIds,["a","c"]);
  const retained=updated.defaults.members.find(member=>member.id==="b");assert.equal(retained.agentId,b.agentId);assert.equal(retained.alias,"B");assert.deepEqual(retained.config.model,h.member().model);
  assert.equal(updated.defaults.environment.overrides.b,other);assert.equal(updated.defaults.environment.presetOverrides.b,"review-tools");
  const next=await h.service.createConversation(g.id,{operationId:"adopted-next"});assert.deepEqual(next.members.map(member=>member.alias),["A","C"]);assert.ok(next.members.every(member=>member.nativeSetup.config.cwd===topic));
  assert.deepEqual((await h.service.resolveRoom(room.id)).members,room.members);assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("native continuation requires a scoped preview, stays out of group defaults and rejects busy sessions",()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model}}}};}};
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id,another:true});
  const preview=await h.service.directory.inspectNative("existing-session",{kind:"conversation-draft",id:draft.id});
  const member={...h.member("continued"),context:preview.context};
  await assert.rejects(h.service.workspace.createGroup({operationId:"illegal-binding",name:"不得共享",members:[member]}),/具體對話/);
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:[member],text:"接續",autoDeliver:false});
  h.ctx.dshBridge.status=async()=>({state:"running"});
  const blocked=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(blocked.state,"needs_configuration");assert.equal(h.created,0);
  h.ctx.dshBridge.status=async()=>({state:"idle"});
  const result=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  assert.equal(result.room.members[0].sessionId,"existing-session");assert.equal(result.room.members[0].ownership,"attached");assert.equal(h.created,0);
}));

test("one native Session cannot become two Agents in a draft or in an existing conversation",()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model}}}};}};
  const g=await group(h),draft=await h.service.workspace.openDraft({groupId:g.id});
  const preview=await h.service.directory.inspectNative("existing-session",{kind:"conversation-draft",id:draft.id});
  await assert.rejects(h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:[{...h.member("one"),context:preview.context},{...h.member("two"),context:preview.context}]}),/同一原生/);
  assert.equal((await h.service.workspace.openDraft({groupId:g.id})).members.length,1);
  const room=await h.service.createConversation(g.id,{operationId:"existing"}),current=await h.service.participantConfiguration(room.id);
  const attached=await h.service.directory.inspectNative(room.members[0].sessionId,{kind:"conversation-members",id:room.id});
  await assert.rejects(h.service.updateParticipants(room.id,{members:[...current.members,{...h.member("duplicate"),context:attached.context}],environment:current.environment,expectedRevision:current.revision,operationId:"duplicate-attachment"}),/同一原生/);
  assert.deepEqual((await h.service.resolveRoom(room.id)).members,room.members);
  assert.equal((await h.service.directory.list()).length,1);assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("a native continuation receipt cannot be replayed into another group or a new operation",()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model}}}};}};
  const g=await group(h),other=await h.service.workspace.createGroup({operationId:"other-group",name:"另一群組",members:[]});
  let draft=await h.service.workspace.openDraft({groupId:g.id});const target={kind:"conversation-draft",id:draft.id};
  const preview=await h.service.directory.inspectNative("existing-session",target);
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"明確接續",members:[{...h.member("continued"),context:preview.context}],autoDeliver:false});
  const started=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  const request={operationId:started.room.creation.operationId,selectionTarget:target,configuration:{members:draft.members,environment:draft.environment,charter:draft.charter,autoDeliver:false,mode:draft.mode}};
  await assert.rejects(h.service.createConversation(other.id,request),/具體對話草稿/);
  await assert.rejects(h.service.createConversation(g.id,{...request,operationId:"unrelated-operation"}),/具體對話草稿/);
  assert.equal((await h.service.listRooms()).length,1);assert.equal((await h.service.messages(started.room.id)).length,1);
  assert.equal((await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision})).room.id,started.room.id);
  assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("a groupless native continuation starts only in its unclassified group and cannot be redirected",()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model}}}};}};
  const other=await group(h);let draft=await h.service.workspace.openDraft({another:true});
  const target={kind:"conversation-draft",id:draft.id},preview=await h.service.directory.inspectNative("temporary-native",target);
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"不用先建群組",members:[{...h.member("continued"),context:preview.context}],autoDeliver:false});
  let checks=0;h.ctx.dshBridge.status=async()=>{if(++checks===2)throw new Error("fixture validation interrupted");return {state:"idle"};};
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}),/fixture validation interrupted/);
  h.ctx.dshBridge.status=async()=>({state:"idle"});
  const persisted=JSON.parse(await readFile(h.path,"utf8")),pending=persisted.workspace.drafts.find(item=>item.id===draft.id);
  assert.ok(pending.start);assert.equal(pending.groupId,null);
  const request={operationId:`draft:${pending.start.operationId}`,selectionTarget:target,configuration:{members:draft.members,environment:draft.environment,charter:draft.charter,autoDeliver:false,mode:draft.mode}};
  await assert.rejects(h.service.createConversation(other.id,request),/具體對話草稿/);
  const started=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  assert.equal(started.room.members[0].sessionId,"temporary-native");assert.notEqual(started.room.groupId,other.id);
  assert.equal((await h.service.listGroups()).find(item=>item.id===started.room.groupId).unclassified,true);
  assert.equal((await h.service.listRooms()).length,1);assert.equal((await h.service.messages(started.room.id)).length,1);
  assert.equal((await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision})).room.id,started.room.id);
  assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("concurrent drafts cannot silently enlarge a native Session sharing scope",{timeout:3000},()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model}}}};}};
  const g=await group(h),drafts=[];
  for(const id of ["one","two"]){
    let draft=await h.service.workspace.openDraft({groupId:g.id,another:true});
    const preview=await h.service.directory.inspectNative("shared-native",{kind:"conversation-draft",id:draft.id});
    draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:`主題 ${id}`,members:[{...h.member(id),context:preview.context}],autoDeliver:false});drafts.push(draft);
  }
  let statusCalls=0,release;const gate=new Promise(resolve=>{release=resolve;});
  h.ctx.dshBridge.status=async()=>{statusCalls++;if(statusCalls>=3){if(statusCalls===4)release();await gate;}return {state:"idle"};};
  const results=await Promise.allSettled(drafts.map(draft=>h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision})));
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  const rejected=results.find(result=>result.status==="rejected");assert.match(rejected.reason.message,/共享範圍已變更/);
  const rooms=await h.service.listRooms();assert.equal(rooms.length,1);assert.equal(rooms[0].members[0].sessionId,"shared-native");
  assert.equal((await h.service.directory.list()).length,2);assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("full-access continuation synchronizes native permission only on preparation, without creating a Session",()=>fixture(async h=>{
  let permissionWrites=0;const nativeAgent={status:"idle",session:{id:"existing-session",preset:"read-only",async flush(){}}};
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model},permissions:{currentValue:nativeAgent.session.preset}}}};}};
  h.ctx.agents={get(id){return id===nativeAgent.session.id?nativeAgent:undefined;}};
  h.ctx.permissionPresets={resolve(preset){return {sandbox:preset,approval:preset==="danger-full-access"?"never":"ask"};},current(session){return session.preset;},set(session,preset){permissionWrites++;session.preset=preset;}};
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id});
  const preview=await h.service.directory.inspectNative(nativeAgent.session.id,{kind:"conversation-draft",id:draft.id});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"獨立確認完整權限",members:[{...h.member("continued"),context:preview.context}],autoDeliver:false,mode:"full_access"});
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}),/确认/);
  const started=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision,confirmRisk:true});
  assert.equal(started.room.policy.defaultActionMode,"full_access");assert.equal(started.room.members[0].sessionId,nativeAgent.session.id);
  assert.equal(nativeAgent.session.preset,"read-only");assert.equal(permissionWrites,0);assert.equal(h.created,0);assert.equal(h.calls.length,0);
  await Promise.all([h.service.prepareMember(started.room.id,nativeAgent.session.id),h.service.prepareMember(started.room.id,nativeAgent.session.id)]);
  assert.equal(nativeAgent.session.preset,"danger-full-access");assert.equal(permissionWrites,1);assert.equal(h.created,0);assert.equal(h.calls.length,0);
  await h.service.prepareMember(started.room.id,nativeAgent.session.id);assert.equal(permissionWrites,1);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{await reopened.prepareMember(started.room.id,nativeAgent.session.id);assert.equal(permissionWrites,1);assert.equal(h.created,0);assert.equal((await reopened.resolveRoom(started.room.id)).policy.defaultActionMode,"full_access");}finally{await reopened.close();}
}));

test("renaming a legacy group preserves native environments; direct topics retain identity, defaults and permission mode",()=>fixture(async h=>{
  h.ctx.sessionQuery={async observeSession(){return {header:{cwd:h.dir},projections:{values:{modelSelection:{next:h.member().model},agentPreset:"research-tools"}}};}};
  const g=await group(h),live=h.service.state.groups.find(item=>item.id===g.id);
  delete live.defaults.environment;
  live.defaults.members[0].config.agentPreset="research-tools";
  const original=structuredClone(live.defaults.members);
  await h.service.workspace.updateGroup(g.id,{expectedRevision:live.revision,operationId:"name-only",name:"新名稱"});
  assert.deepEqual(live.defaults.members,original);
  live.defaults.frozen=false;live.defaults.defaultActionMode="full_access";
  live.defaults.members.push({...h.member("b"),sourceSessionId:"b",agentId:"legacy-b",config:{cwd:h.dir,model:h.member().model}});
  live.defaults.defaultParticipantIds=["a"];
  const room=await h.service.createConversation(g.id,{operationId:"direct-topic",confirmRisk:true});
  assert.equal(room.members.length,1);assert.equal(room.members[0].agentId,original[0].agentId);
  assert.equal(room.policy.defaultActionMode,"full_access");
}));

test("updating the group member pool preserves resolved model, environment, preset and direct-topic defaults",()=>fixture(async h=>{
  let g=await group(h);
  g=await h.service.workspace.updateGroup(g.id,{expectedRevision:g.revision,operationId:"environment",environment:{cwd:h.dir,presetOverrides:{a:"research-tools"}}});
  const originalId=g.defaults.members[0].agentId;
  g=await h.service.workspace.updateGroup(g.id,{expectedRevision:g.revision,operationId:"add-pool-member",members:[...g.defaults.members,h.member("b")]});
  const room=await h.service.createConversation(g.id,{operationId:"direct-after-member-change"});
  assert.equal(room.members.length,1);assert.equal(room.members[0].alias,"A");assert.equal(room.members[0].agentId,originalId);
  assert.deepEqual(room.members[0].nativeSetup.config,{cwd:h.dir,model:h.member().model,agentPreset:"research-tools"});
  const saved=(await h.service.listGroups()).find(item=>item.id===g.id);
  assert.equal(saved.defaults.members.length,2);assert.deepEqual(saved.defaults.defaultParticipantIds,["a"]);
  assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("archiving preserves paused monitor settings across restart and restoring never restarts them",()=>fixture(async h=>{
  const g=await group(h),room=await h.service.createConversation(g.id,{operationId:"monitored-topic"});
  const task=await h.service.createLedgerEntry(room.id,{kind:"task",title:"待人工恢復的監測",ownerSessionId:room.members[0].sessionId,monitor:{enabled:true,coordinatorSessionId:room.members[0].sessionId,idleMinutes:1,nextReminderAt:Date.now()-1}});
  await assert.rejects(h.service.setGroupLifecycle(g.id,{action:"archive",expectedRevision:g.revision,operationId:"without-confirmation"}),/確認暫停/);
  assert.equal((await h.service.listLedger(room.id)).find(entry=>entry.id===task.id).monitor.enabled,true);
  const archived=await h.service.setGroupLifecycle(g.id,{action:"archive",expectedRevision:g.revision,operationId:"pause-and-archive",confirmPause:true});
  const paused=(await h.service.listLedger(room.id)).find(entry=>entry.id===task.id);
  assert.equal(paused.status,"open");assert.equal(paused.monitor.enabled,false);assert.ok(paused.monitor.pausedByGroupAt);
  assert.equal(paused.monitor.coordinatorSessionId,room.members[0].sessionId);assert.equal(paused.monitor.idleMinutes,1);
  assert.ok(paused.history.some(event=>event.type==="monitor_paused"&&event.actor==="human:me"));
  assert.ok((await h.service.resolveRoom(room.id)).revision>room.revision);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path,monitorMinuteMs:10,monitorIntervalMs:25});
  try{
    const persisted=(await reopened.listLedger(room.id)).find(entry=>entry.id===task.id);assert.deepEqual(persisted.monitor,paused.monitor);
    await reopened.setGroupLifecycle(g.id,{action:"restore",expectedRevision:archived.revision,operationId:"restore-only"});
    assert.deepEqual((await reopened.listLedger(room.id)).find(entry=>entry.id===task.id).monitor,paused.monitor);
    await new Promise(resolve=>setTimeout(resolve,80));assert.equal(h.calls.length,0);assert.equal((await reopened.messages(room.id)).length,0);
  }finally{await reopened.close();}
}));

test("merely opening a new page does not create a durable draft; the first edit saves with a stable receipt",()=>fixture(async h=>{
  const one=await h.service.workspace.openDraft({kind:"group",another:true,ephemeral:true});
  const two=await h.service.workspace.openDraft({kind:"group",another:true,ephemeral:true});
  assert.notEqual(one.id,two.id);assert.equal((await h.service.workspace.list()).drafts.length,0);
  const input={seed:{kind:one.kind,groupId:one.groupId},expectedRevision:one.revision,operationId:"first-edit",title:"剛開始"};
  const saved=await h.service.workspace.saveDraft(one.id,input);
  assert.equal(saved.title,"剛開始");assert.equal((await h.service.workspace.saveDraft(one.id,input)).revision,saved.revision);
  assert.equal((await h.service.workspace.list()).drafts.length,1);
}));

test("existing conversation selection adds Agents without running them or changing the group default",()=>fixture(async h=>{
  const g=await group(h),room=await h.service.createConversation(g.id,{operationId:"topic"});
  const current=await h.service.participantConfiguration(room.id);
  const input={members:[...current.members,h.member("b")],environment:{cwd:h.dir},expectedRevision:current.revision,operationId:"members"};
  const changed=await h.service.updateParticipants(room.id,input);
  assert.equal(changed.members.length,2);assert.equal(changed.members[0].sessionId,room.members[0].sessionId);
  assert.equal((await h.service.updateParticipants(room.id,input)).members[1].sessionId,changed.members[1].sessionId);
  await assert.rejects(h.service.updateParticipants(room.id,{...input,members:[...input.members,h.member("c")]}),/憑據內容衝突/);
  await assert.rejects(h.service.updateParticipants(room.id,{...input,operationId:"stale-member-change"}),/revision conflict/);
  assert.equal((await h.service.workspace.configuration(g.id)).members.length,1);
  assert.equal((await h.service.directory.list()).length,2);
  assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("removing a participant with open responsibilities keeps the selection and ledger unchanged",()=>fixture(async h=>{
  const g=await group(h),room=await h.service.createConversation(g.id,{operationId:"responsible-topic"});
  const task=await h.service.createLedgerEntry(room.id,{kind:"task",title:"仍需交接的核驗",ownerSessionId:room.members[0].sessionId});
  const before=await h.service.resolveRoom(room.id),current=await h.service.participantConfiguration(room.id);
  await assert.rejects(h.service.updateParticipants(room.id,{members:[h.member("replacement")],environment:current.environment,expectedRevision:current.revision,operationId:"replace-responsible-member"}),/未閉環責任/);
  const after=await h.service.resolveRoom(room.id);assert.deepEqual(after.members,before.members);assert.equal(after.revision,before.revision);
  const kept=(await h.service.listLedger(room.id)).find(entry=>entry.id===task.id);assert.equal(kept.ownerSessionId,room.members[0].sessionId);assert.equal(kept.status,"open");
  assert.equal((await h.service.directory.list()).length,1);assert.equal(h.created,0);assert.equal(h.calls.length,0);
}));

test("empty groups persist independently and can start their first draft without placeholder rooms",()=>fixture(async h=>{
  const saved=await h.service.workspace.createGroup({operationId:"group",name:"空群组",members:[],environment:{cwd:h.dir}});
  assert.equal((await h.service.listRooms()).length,0);assert.equal((await h.service.listGroups())[0].conversationCount,0);
  const draft=await h.service.workspace.openDraft({groupId:saved.id});assert.equal(draft.groupId,saved.id);assert.equal(h.created,0);
  assert.equal((await h.service.workspace.createGroup({operationId:"group",name:"空群组",members:[],environment:{cwd:h.dir}})).id,saved.id);
  await assert.rejects(h.service.workspace.createGroup({operationId:"group",name:"改变内容",members:[],environment:{cwd:h.dir}}),/凭据/);
}));

test("drafts have independent durable identity, partial configuration and idempotent saves",()=>fixture(async h=>{
  const a=await group(h),b=await h.service.workspace.createGroup({operationId:"b",name:"B",members:[]});
  const first=await h.service.workspace.openDraft({groupId:a.id}),second=await h.service.workspace.openDraft({groupId:b.id});
  const input={expectedRevision:first.revision,operationId:"save",text:"A 的内容",members:[{id:"blank",alias:"",model:{}}]};
  const saved=await h.service.workspace.saveDraft(first.id,input);assert.equal((await h.service.workspace.saveDraft(first.id,input)).revision,saved.revision);
  assert.equal((await h.service.workspace.openDraft({groupId:a.id})).id,first.id);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{const drafts=(await reopened.workspace.list()).drafts;assert.equal(drafts.find(d=>d.id===first.id).text,"A 的内容");assert.equal(drafts.find(d=>d.id===second.id).text,"");assert.equal(h.created,0);}finally{await reopened.close();}
}));

test("rosters strip execution environments and do not mutate earlier versions or active conversations",()=>fixture(async h=>{
  const g=await group(h),draft=await h.service.workspace.openDraft({groupId:g.id});
  const roster=await h.service.workspace.saveRoster({name:"方法组",members:[{...h.member(),config:{cwd:"/other/private",model:h.member().model},cwd:"/other/private"}]});
  assert.equal("config" in roster.members[0],false);assert.equal("cwd" in roster.members[0],false);
  await h.service.workspace.saveRoster({id:roster.id,expectedRevision:roster.revision,name:"新版",members:[{...h.member(),alias:"新名称"}]});
  assert.equal((await h.service.workspace.openDraft({groupId:g.id})).members[0].alias,"A");
  const changed=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:roster.members,text:"新议题",autoDeliver:false});
  const result=await h.service.workspace.startDraft(changed.id,{expectedRevision:changed.revision});
  assert.equal(result.room.members[0].nativeSetup.config.cwd,h.dir);assert.equal(h.created,0);assert.equal((await h.service.messages(result.room.id)).length,1);
}));

test("starting retries preserve one room and first message; no selected participant means a saved note",()=>fixture(async h=>{
  let draft=await h.service.workspace.openDraft();
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"仅记录一份笔记"});
  const [a,b]=await Promise.all([h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}),h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision})]);
  assert.equal(a.room.id,b.room.id);assert.equal(a.state,"note_saved");assert.equal((await h.service.listRooms()).length,1);assert.equal((await h.service.messages(a.room.id)).length,1);assert.equal(h.calls.length,0);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{assert.equal((await reopened.workspace.startDraft(draft.id,{expectedRevision:draft.revision})).room.id,a.room.id);}finally{await reopened.close();}
}));

test("an unavailable member blocks preflight without creating native sessions and can be explicitly omitted",()=>fixture(async h=>{
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"检查",members:[h.member(),{...h.member("b"),model:{provider:"test",model:"missing"}}],autoDeliver:false});
  const blocked=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(blocked.state,"needs_configuration");assert.equal(blocked.checks.filter(c=>!c.ok).length,1);assert.equal((await h.service.listRooms()).length,0);assert.equal(h.created,0);
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,members:draft.members.map(m=>m.id==="b"?{...m,enabled:false}:m)});
  const started=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(started.room.members.length,1);assert.equal(h.created,0);
}));

test("management is a fixed revision batch, skips changed items and terminates without accepting",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"整理测试"});
  const a=await h.service.createLedgerEntry(room.id,{kind:"task",title:"旧任务"}),b=await h.service.createLedgerEntry(room.id,{kind:"evidence",title:"旧证据"});
  const batch=await h.service.prepareLedgerManagement(room.id,{operationId:"batch",action:"terminate",entryIds:[a.id,b.id],reason:"旧版本已停止"});
  assert.equal((await h.service.listLedger(room.id))[0].status,"open");
  await h.service.updateLedgerEntry(room.id,b.id,{details:"并发新证据"},{expectedRevision:b.revision});
  const result=await h.service.commitLedgerManagement(room.id,batch.id);assert.deepEqual(result.results.map(r=>r.state),["success","conflict"]);
  assert.equal((await h.service.listLedger(room.id)).find(e=>e.id===a.id).status,"cancelled");
  assert.deepEqual((await h.service.commitLedgerManagement(room.id,batch.id)).results,result.results);assert.equal(h.calls.length,0);
}));

test("archived accepted results can be shown without reopening; unfinished history is paused, not invented as cancelled",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"历史"});let done=await h.service.createLedgerEntry(room.id,{kind:"task",title:"完成事项"});
  done=await h.service.updateLedgerEntry(room.id,done.id,{status:"done"},{expectedRevision:done.revision});
  let archived=await h.service.triageLedgerEntry(room.id,done.id,{action:"archive",operationId:"archive",expectedRevision:done.revision});
  const visible=await h.service.triageLedgerEntry(room.id,done.id,{action:"show",operationId:"show",expectedRevision:archived.revision});assert.equal(visible.status,"done");assert.ok(visible.review);
  const task=await h.service.createLedgerEntry(room.id,{kind:"task",title:"未完历史"});archived=await h.service.triageLedgerEntry(room.id,task.id,{action:"archive",operationId:"arc2",expectedRevision:task.revision});
  const paused=await h.service.triageLedgerEntry(room.id,task.id,{action:"show",operationId:"show2",expectedRevision:archived.revision});assert.equal(paused.status,"paused");assert.equal((await h.service.resolveRoom(room.id)).workSummary.tasks,0);
}));

test("obsolete prerequisite links can be explicitly removed without pretending prerequisite acceptance",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"依赖"}),decision=await h.service.createLedgerEntry(room.id,{kind:"decision",title:"旧授权申请"});
  // Public task creation preserves structured blockers only through the Agent protocol; use an existing durable legacy fixture.
  const task=await h.service.createLedgerEntry(room.id,{kind:"task",title:"继续审查"});
  const material=await h.service.createLedgerEntry(room.id,{kind:"task",title:"仍需材料"});
  const stored=h.service.state.rooms.find(item=>item.id===room.id).ledger.find(item=>item.id===task.id);
  Object.assign(stored,{status:"blocked",blocker:{kind:"dependency",summary:"需材料和权限",nextStep:"核对",entryIds:[decision.id,material.id]}});
  await assert.rejects(h.service.prepareLedgerManagement(room.id,{operationId:"bad",action:"unlink_dependency",entryIds:[task.id]}),/明确选择/);
  const batch=await h.service.prepareLedgerManagement(room.id,{operationId:"unlink",action:"unlink_dependency",entryIds:[task.id],predecessorIds:[decision.id]});
  assert.deepEqual(batch.items[0].predecessors,[{id:decision.id,title:decision.title}]);
  await h.service.commitLedgerManagement(room.id,batch.id);
  assert.equal((await h.service.listLedger(room.id)).find(e=>e.id===decision.id).status,"proposed");
  const after=(await h.service.listLedger(room.id)).find(e=>e.id===task.id);assert.equal(after.status,"blocked");assert.deepEqual(after.blocker.entryIds,[material.id]);
}));

test("discard during asynchronous preflight cannot create a room, message or native session",()=>fixture(async h=>{
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id});draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"不得启动"});
  let release,reached;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>reached=resolve);
  h.service.workspace.preflight=async()=>{reached();await gate;return [];};
  const start=h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  await entered;await h.service.workspace.discardDraft(draft.id,draft.revision);release();
  await assert.rejects(start,/取消/);assert.equal((await h.service.listRooms()).length,0);assert.equal(h.calls.length,0);assert.equal(h.created,0);
}));

test("permission confirmation survives restart only for its immutable start snapshot",()=>fixture(async h=>{
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id});draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"新执行",mode:"full_access",autoDeliver:false});
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}),/确认/);
  h.service.createConversation=async()=>{throw new Error("injected before room");};
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision,confirmRisk:true}),/injected/);
  await h.service.close();const reopened=new DshChatLocalService(h.ctx,{path:h.path});
  try{const result=await reopened.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(result.state,"note_saved");assert.equal(result.room.policy.defaultActionMode,"full_access");assert.equal(h.calls.length,0);}finally{await reopened.close();}
}));

test("a failed dispatch intent save can be retried when Host was definitely not crossed",()=>fixture(async h=>{
  let draft=await h.service.workspace.openDraft();draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"笔记"});
  const persist=h.service.workspace.persist;let injected=false,deliveries=0;
  h.service.workspace.persist=async()=>{if(!injected&&h.service.state.workspace.drafts[0].start?.state==="dispatching"){injected=true;throw new Error("disk failure");}return persist();};
  const deliver=h.service.deliverSavedMessage.bind(h.service);h.service.deliverSavedMessage=async(...args)=>{deliveries++;return deliver(...args);};
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}),/disk failure/);assert.equal(deliveries,0);
  const result=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(result.state,"note_saved");assert.equal(deliveries,1);assert.equal((await h.service.messages(result.room.id)).length,1);
}));

test("archival cycles do not restore obsolete completion into a new work cycle",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"历史轮次"});let entry=await h.service.createLedgerEntry(room.id,{kind:"task",title:"完成过的工作"});entry=await h.service.updateLedgerEntry(room.id,entry.id,{status:"done"},{expectedRevision:entry.revision});
  for(const action of ["archive","show","resume","archive","show"])entry=await h.service.triageLedgerEntry(room.id,entry.id,{action,expectedRevision:entry.revision,operationId:crypto.randomUUID()});
  assert.equal(entry.status,"paused");assert.ok(!entry.review);
}));

test("termination includes the full dependent closure and records a single business failure without blocking the batch",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"收尾"});const entries=[];for(const title of ["A","B","C","D"])entries.push(await h.service.createLedgerEntry(room.id,{kind:"task",title}));
  const live=h.service.state.rooms.find(item=>item.id===room.id);
  for(let i=1;i<3;i++)Object.assign(live.ledger.find(item=>item.id===entries[i].id),{status:"blocked",blocker:{kind:"dependency",summary:"依赖前项",nextStep:"等待",entryIds:[entries[i-1].id]}});
  const batch=await h.service.prepareLedgerManagement(room.id,{operationId:"closure",action:"terminate",entryIds:[entries[0].id,entries[3].id],dependencyHandling:"terminate"});assert.equal(batch.items.length,4);
  const full=live.ledger.find(item=>item.id===entries[3].id);full.history=Array.from({length:1000},()=>full.history[0]);
  const result=await h.service.commitLedgerManagement(room.id,batch.id);assert.equal(result.state,"completed");assert.equal(result.results.filter(item=>item.state==="success").length,3);assert.equal(result.results.filter(item=>item.state==="failed").length,1);
  for(const item of live.ledger.filter(item=>item.id!==full.id))assert.equal(item.status,"cancelled");
}));

test("execution retry requires inspected continuation and repeats its receipt even while running",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"重试",members:[{kind:"session",sessionId:"a",alias:"A"}]});const message=await h.service.send({roomId:room.id,author:"human:me",authorKind:"human",text:"有副作用的工作",automaticDelivery:false});
  const live=h.service.state.rooms.find(item=>item.id===room.id),stored=live.messages.find(item=>item.id===message.id);Object.assign(live.policy,{defaultActionMode:"full_access",revision:2});Object.assign(stored,{actionMode:"full_access",policyRevision:2,deliveries:[{status:"failed",member:"a",error:"Agent reply timed out"}]});
  await assert.rejects(h.service.retryFailedDeliveries(room.id,message.id),/核对结果/);
  const input={mode:"current",operationId:"continue",expectedPolicyRevision:2,confirmResultChecked:true};const result=await h.service.retryFailedDeliveries(room.id,message.id,undefined,input);
  live.orchestration.state="running";
  assert.equal((await h.service.retryFailedDeliveries(room.id,message.id,undefined,input)).id,result.id);assert.equal(live.messages.filter(item=>item.retrySourceMessageId===message.id).length,1);
}));

test("legacy per-member native presets remain environment bindings, not roster permissions",()=>fixture(async h=>{
  const g=await group(h);const live=h.service.state.groups.find(item=>item.id===g.id);delete live.defaults.environment;delete live.defaults.defaultParticipantIds;live.defaults.members=[{...h.member("a"),config:{cwd:h.dir,model:h.member().model,agentPreset:"research-tools"}},{...h.member("b"),config:{cwd:h.dir,model:h.member().model,agentPreset:"review-tools"}}];
  let draft=await h.service.workspace.openDraft({groupId:g.id});assert.deepEqual(draft.environment.presetOverrides,{a:"research-tools",b:"review-tools"});
  draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"按各自配置",autoDeliver:false});const result=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  assert.deepEqual(result.room.members.map(item=>item.nativeSetup.config.agentPreset),["research-tools","review-tools"]);
}));

test("an inner dispatch save failure clears the phantom queue and retry actually delivers exactly once",()=>fixture(async h=>{
  const g=await group(h);let draft=await h.service.workspace.openDraft({groupId:g.id});draft=await h.service.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,text:"真实派送到假 Host"});
  const deliver=h.service.deliverSavedMessage.bind(h.service);let first=true;
  h.service.deliverSavedMessage=async(...args)=>{if(!first)return deliver(...args);first=false;h.service.path=h.dir;try{return await deliver(...args);}finally{h.service.path=h.path;}};
  await assert.rejects(h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision}));
  assert.equal(h.calls.length,0);assert.equal(h.service.state.workspace.drafts[0].start.state,"saved");assert.notEqual(h.service.state.rooms[0].orchestration.state,"queued");assert.ok(!h.service.state.rooms[0].messages[0].dispatchAttempted);
  const result=await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});
  for(let n=0;n<50&&!h.calls.length;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(h.calls.length,1);assert.equal(h.created,1);assert.equal(result.state,"started");await h.service.workspace.startDraft(draft.id,{expectedRevision:draft.revision});assert.equal(h.calls.length,1);
}));

test("two tabs cannot claim one failed delivery twice and receipt replay repairs its source after a save gap",()=>fixture(async h=>{
  const room=await h.service.createRoom({name:"双视窗",members:[{kind:"session",sessionId:"a",alias:"A"}]});const message=await h.service.send({roomId:room.id,author:"human:me",authorKind:"human",text:"续接",automaticDelivery:false});
  const live=h.service.state.rooms.find(item=>item.id===room.id),stored=live.messages.find(item=>item.id===message.id);stored.deliveries=[{status:"failed",member:"a",error:"timeout"}];
  const options={mode:"current",operationId:"one",expectedPolicyRevision:live.policy.revision,confirmResultChecked:true};
  const results=await Promise.allSettled([h.service.retryFailedDeliveries(room.id,message.id,undefined,options),h.service.retryFailedDeliveries(room.id,message.id,undefined,{...options,operationId:"two"})]);
  assert.equal(results.filter(item=>item.status==="fulfilled").length,1);assert.equal(live.messages.filter(item=>item.retrySourceMessageId===message.id).length,1);
  stored.deliveries[0].status="failed";delete stored.deliveries[0].continuationMessageId;
  await h.service.retryFailedDeliveries(room.id,message.id,undefined,options);assert.equal(stored.deliveries[0].status,"superseded");assert.ok(stored.deliveries[0].continuationMessageId);
}));

test("an adopted decision with failed notification remains actionable, while terminated work stays quiet",()=>{
  for(const state of ["failed","interrupted","no_recipient"]){assert.equal(workProtocol.needsUser({status:"decided",handoff:{state}},new Map()),true);for(const status of ["cancelled","paused","archived"])assert.equal(workProtocol.needsUser({status,handoff:{state}},new Map()),false);}
});
