import {createHash} from "node:crypto";
import {snapshotMemberConfiguration} from "./native-conversations.js";

const copy=value=>structuredClone(value);
export const identityKey=(...parts)=>createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0,32);
export function setupError(code,message,extra={}) { return Object.assign(new Error(message),{code,status:code==="revision_conflict"?409:400,...extra}); }
export function agentProfile(input={},{partial=false}={}) {
  const alias=String(input.alias??"").trim().slice(0,120);
  if(!partial&&!alias)throw setupError("name_required","請輸入 Agent 名稱");
  const model=input.model??input.config?.model??{};
  return {alias,role:String(input.role??"").slice(0,1000),mandate:String(input.mandate??"").slice(0,8000),
    model:{provider:String(model.provider??""),model:String(model.model??""),...(model.reasoningEffort?{reasoningEffort:String(model.reasoningEffort)}:{})}};
}

export function registerParticipations(state,room){
  let changed=false;
  const records=state.workspace.participations;
  const ids=new Set([...room.members.map(m=>m.sessionId),...room.ledger.flatMap(e=>[e.ownerSessionId,e.reviewerSessionId,...(e.collaboratorSessionIds??[])]).filter(Boolean)]);
  for(const sessionId of ids){
    const member=room.members.find(m=>m.sessionId===sessionId);
    let mapping=records.find(p=>p.roomId===room.id&&p.sessionId===sessionId);
    if(!mapping){mapping={id:`participant-${identityKey(room.id,sessionId)}`,roomId:room.id,sessionId,...(member?.agentId?{agentId:member.agentId}:{}),alias:member?.alias??"歷史責任人"};records.push(mapping);changed=true;}
    if(member){if(member.participationId!==mapping.id){member.participationId=mapping.id;changed=true;}if(member.agentId&&!mapping.agentId){mapping.agentId=member.agentId;changed=true;}}
  }
  return changed;
}

/** Add identity references without rewriting messages, ledger owners, grants or user drafts. */
export function migrateAgentDirectory(state){
  let changed=false;
  for(const group of state.groups){
    for(const member of group.defaults.members){
      if(!member.agentId){
        const id=`legacy-agent-${identityKey(group.id,member.id)}`;
        let agent=state.workspace.agents.find(a=>a.id===id);
        if(!agent){agent={id,revision:1,...agentProfile(member,{partial:true}),versions:[],createdAt:group.createdAt,updatedAt:group.updatedAt??group.createdAt,
          source:{groupId:group.id,memberId:member.id,...(member.sourceSessionId?{sessionId:member.sourceSessionId}:{})}};state.workspace.agents.push(agent);}
        member.agentId=id;member.agentRevision=agent.revision;changed=true;
      }
    }
    if(group.defaults.defaultParticipantIds===undefined){group.defaults.defaultParticipantIds=group.defaults.members.filter(m=>m.enabled!==false).map(m=>m.id);changed=true;}
  }
  for(const room of state.rooms){
    const group=state.groups.find(g=>g.id===room.groupId);
    for(const member of room.members){
      const source=group?.defaults.members.find(m=>(member.memberId&&m.id===member.memberId)||m.sourceSessionId===member.sessionId||m.id===member.sessionId);
      if(source?.agentId&&!member.agentId){member.agentId=source.agentId;member.agentRevision=source.agentRevision;changed=true;}
      if(!member.agentId){
        // A legacy addMember is topic-local. Give it an identity without expanding the group pool.
        const mapping=state.workspace.participations.find(p=>p.roomId===room.id&&p.sessionId===member.sessionId);
        const id=mapping?.agentId??`legacy-topic-agent-${identityKey(room.id,member.sessionId)}`;
        let agent=state.workspace.agents.find(a=>a.id===id);
        if(!agent){agent={id,revision:1,...agentProfile({...member,model:member.nativeSetup?.config?.model},{partial:true}),versions:[],createdAt:member.joinedAt??room.createdAt,updatedAt:room.updatedAt??room.createdAt,source:{roomId:room.id,sessionId:member.sessionId}};state.workspace.agents.push(agent);}
        member.agentId=id;member.agentRevision=agent.revision;changed=true;
      }
    }
    changed=registerParticipations(state,room)||changed;
  }
  return changed;
}

/** Stable, reusable profiles. Native Session execution remains outside this Module. */
export class AgentDirectory {
  constructor(store,persist){this.store=store;this.persist=persist;}
  get data(){return this.store.state.workspace;}
  async inspectNative(sessionId,target,{continueSession=true}={}){
    await this.store.ready;
    if(!sessionId||!target?.id||!["group-draft","group-members","conversation-draft","conversation-members"].includes(target.kind))throw setupError("invalid_target","請先選擇加入位置");
    if(continueSession&&!target.kind.startsWith("conversation-"))throw setupError("context_scope","接續原生會話只能加入具體對話；群組僅能匯入配置");
    const config=await snapshotMemberConfiguration(this.store.ctx,{sessionId,alias:sessionId});
    const status=await this.store.ctx.dshBridge.status(sessionId);
    const sharedWith=this.store.state.rooms.filter(r=>!r.deletedAt&&r.members.some(m=>m.sessionId===sessionId)).map(r=>({id:r.id,name:r.name}));
    const busy=status?.state!=="idle";
    if(!continueSession)return {config,busy,sharedWith};
    const proof={token:crypto.randomUUID(),sessionId,target:copy(target),configuration:identityKey(config),shared:sharedWith.map(r=>r.id).sort()};
    this.data.nativePreviews.push(proof);await this.persist();
    return {config,busy,sharedWith,context:{kind:"continue",sessionId,token:proof.token}};
  }
  async validateNative(context,target){
    const proof=this.data.nativePreviews.find(p=>p.token===context?.token&&p.sessionId===context.sessionId&&p.target.kind===target?.kind&&p.target.id===target?.id);
    if(context?.kind!=="continue"||!proof)throw setupError("preview_required","請重新預覽要接續的原生會話，確認加入位置與共享影響");
    const config=await snapshotMemberConfiguration(this.store.ctx,{sessionId:context.sessionId,alias:context.sessionId});
    if(identityKey(config)!==proof.configuration)throw setupError("native_changed","原生會話的配置已變更；請重新預覽，未替換模型或環境");
    const status=await this.store.ctx.dshBridge.status(context.sessionId);
    this.assertNativeSharing(context);
    const shared=proof.shared;
    if(status?.state!=="idle"||this.store.state.rooms.some(r=>shared.includes(r.id)&&["running","queued"].includes(r.orchestration.state)))throw setupError("native_busy","原生會話正在執行；可稍後重試，或改用獨立上下文");
    return config;
  }
  assertNativeSharing(context){
    const proof=this.data.nativePreviews.find(p=>p.token===context?.token);
    const shared=this.store.state.rooms.filter(r=>!r.deletedAt&&r.members.some(m=>m.sessionId===context.sessionId)).map(r=>r.id).sort();
    if(!proof||identityKey(shared)!==identityKey(proof.shared))throw setupError("native_changed","原生會話的共享範圍已變更；請重新確認");
  }
  planMembers(input,scope,{allowArchivedIds=[]}={}){
    const aliases=new Set(),identities=new Set(),created=[];
    const members=input.map(member=>{
      const profile=agentProfile(member),aliasKey=profile.alias.toLocaleLowerCase();
      if(aliases.has(aliasKey))throw setupError("alias_conflict",`「${profile.alias}」在這份名單重複，請設定可區分的稱呼`);
      aliases.add(aliasKey);
      let agent=member.agentId&&this.data.agents.find(a=>a.id===member.agentId);
      if(member.agentId&&!agent)throw setupError("agent_missing",`「${profile.alias}」的 Agent 已不存在；請重新選擇`);
      if(agent?.archivedAt&&!allowArchivedIds.includes(agent.id))throw setupError("agent_archived",`「${profile.alias}」已從名冊收存，請先恢復或保留現有群組引用`);
      if(!agent){
        const id=`agent-${identityKey(scope,member.id)}`;
        agent=this.data.agents.find(a=>a.id===id)??{id,revision:1,...profile,versions:[],createdAt:Date.now(),updatedAt:Date.now()};
        if(!this.data.agents.some(a=>a.id===id))created.push(agent);
      }
      if(identities.has(agent.id))throw setupError("duplicate_agent",`「${profile.alias}」已在名單中；不同角色請建立另一位 Agent`);
      identities.add(agent.id);
      const version=member.agentRevision??agent.revision;
      if(version!==agent.revision&&!agent.versions.some(v=>v.revision===version))throw setupError("revision_conflict",`「${profile.alias}」的版本不存在`);
      return {...copy(member),...profile,agentId:agent.id,agentRevision:version};
    });
    return {members,created};
  }
  publish(plan){for(const agent of plan.created)if(!this.data.agents.some(a=>a.id===agent.id))this.data.agents.push(copy(agent));}
  async list({includeArchived=false,query=""}={}){
    await this.store.ready;
    const q=String(query).toLocaleLowerCase();
    return this.data.agents.filter(a=>(includeArchived||!a.archivedAt)&&[a.alias,a.role].join(" ").toLocaleLowerCase().includes(q)).map(a=>copy({...a,
      usages:this.store.state.groups.filter(g=>g.defaults.members.some(m=>m.agentId===a.id)).map(g=>({id:g.id,name:g.name,archived:!!g.archivedAt})),
      configured:!!(a.model?.provider&&a.model?.model)}));
  }
  async selection(id){
    await this.store.ready;
    const agent=this.data.agents.find(a=>a.id===id);
    if(!agent)throw setupError("agent_missing","Agent 不存在");
    let profile=agentProfile(agent),configurationError;
    if(!profile.model.model&&agent.source?.sessionId){
      try{const config=await snapshotMemberConfiguration(this.store.ctx,{sessionId:agent.source.sessionId,alias:agent.alias});profile.model=config.model;}
      catch(error){configurationError=String(error.message??error);}
    }
    return {id:crypto.randomUUID(),agentId:agent.id,agentRevision:agent.revision,revision:1,...profile,enabled:true,...(configurationError?{configurationError}:{})};
  }
  async lifecycle(id,{action,expectedRevision,operationId}){
    await this.store.ready;
    if(!["archive","restore"].includes(action)||!operationId)throw setupError("invalid_action","請選擇收存或恢復，並提供操作憑據");
    const key=identityKey("lifecycle",id,action,expectedRevision),replay=this.data.agentOperations.find(r=>r.id===operationId);
    if(replay){if(replay.key!==key)throw setupError("receipt_conflict","操作憑據內容衝突");await this.persist();return copy(replay.result);}
    const agent=this.data.agents.find(a=>a.id===id);
    if(!agent||agent.revision!==expectedRevision)throw setupError("revision_conflict","Agent 已變化，請重新核對");
    agent.versions.push({revision:agent.revision,...agentProfile(agent)});
    if(action==="archive")agent.archivedAt=Date.now();else delete agent.archivedAt;
    agent.revision++;agent.updatedAt=Date.now();
    this.data.agentOperations.push({id:operationId,key,result:copy(agent)});await this.persist();return copy(agent);
  }
  async save({id,expectedRevision,operationId,profile}){
    await this.store.ready;
    if(!operationId)throw setupError("operation_required","缺少保存憑據");
    const key=identityKey(id,expectedRevision,profile);
    const replay=this.data.agentOperations.find(r=>r.id===operationId);
    if(replay){if(replay.key!==key)throw setupError("receipt_conflict","保存憑據內容已變化");await this.persist();return copy(replay.result);}
    const old=id&&this.data.agents.find(a=>a.id===id);
    if(id&&!old)throw setupError("agent_missing","Agent 不存在；輸入仍保留");
    if(old&&old.revision!==expectedRevision)throw setupError("revision_conflict","Agent 已在別處更新；請比較後保存");
    const normalized=agentProfile(profile),now=Date.now();
    const next={id:old?.id??crypto.randomUUID(),revision:(old?.revision??0)+1,...normalized,createdAt:old?.createdAt??now,updatedAt:now,
      ...(old?.archivedAt?{archivedAt:old.archivedAt}:{}),versions:old?[...(old.versions??[]),{revision:old.revision,...agentProfile(old)}]:[]};
    if(old)Object.assign(old,next);else this.data.agents.push(next);
    this.data.agentOperations.push({id:operationId,key,result:copy(next)});
    await this.persist();return copy(next);
  }
}
