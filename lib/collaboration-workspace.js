import {isAbsolute} from "node:path";
import {stat} from "node:fs/promises";
import {createHash} from "node:crypto";

const clone=value=>structuredClone(value);
const text=(value,label,max=200)=>{if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw new Error(`${label}不能为空且不得超过 ${max} 字符`);return value.trim();};
const fingerprint=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const modes=new Set(["discuss_only","read_only_audit","inherit_dsh","workspace_write","full_access"]);

export function workspaceState(input) {
  if(input===undefined)return {drafts:[],rosters:[],groupOperations:[],agents:[],agentOperations:[],participations:[],nativePreviews:[]};
  if(!input||!["drafts","rosters","groupOperations"].every(key=>Array.isArray(input[key])))throw new Error("Invalid collaboration workspace; source data preserved");
  for(const key of ["drafts","rosters"]){const ids=new Set();for(const item of input[key]){if(!item?.id||ids.has(item.id))throw new Error(`Invalid duplicate ${key} identity`);ids.add(item.id);}}
  const result=clone(input);
  for(const field of ["agents","agentOperations","participations","nativePreviews"]){
    if(result[field]===undefined)result[field]=[];
    if(!Array.isArray(result[field]))throw new Error(`Invalid workspace ${field}; source data preserved`);
  }
  return result;
}

export function rosterMembers(input,{draft=false}={}) {
  if(!Array.isArray(input)||input.length>32)throw new Error("每套阵容最多 32 位成员");
  const ids=new Set(),aliases=new Set(),sessions=new Set();
  return input.map(member=>{
    const id=text(member.id??crypto.randomUUID(),"成员配置 ID");
    if(ids.has(id))throw new Error("同一成员已在阵容中；需要第二个角色时请建立独立配置");ids.add(id);
    const alias=draft?String(member.alias??"").slice(0,120):text(member.alias,"成员名称",120);
    if(!draft&&aliases.has(alias.toLocaleLowerCase()))throw new Error("本次成员名称需要可区分，方便准确 @");aliases.add(alias.toLocaleLowerCase());
    if(member.context?.sessionId){if(sessions.has(member.context.sessionId))throw new Error("同一原生會話不能在一段對話扮演兩位 Agent；請改用獨立上下文");sessions.add(member.context.sessionId);}
    const model=member.model??member.config?.model;
    if(!draft&&(!model?.provider||!model?.model))throw new Error(`请为 ${alias} 选择模型`);
    return {id,revision:Math.max(1,Number(member.revision)||1),alias,
      ...(member.agentId?{agentId:text(member.agentId,"Agent ID"),agentRevision:Math.max(1,Number(member.agentRevision)||1)}:{}),
      ...(member.context?.kind==="continue"?{context:{kind:"continue",sessionId:text(member.context.sessionId,"DSH 會話"),token:text(member.context.token,"預覽憑據")}}:{}),
      role:typeof member.role==="string"?member.role.slice(0,1000):"",mandate:typeof member.mandate==="string"?member.mandate.slice(0,8000):"",
      model:{provider:draft?String(model?.provider??""):text(model.provider,"模型来源"),model:draft?String(model?.model??""):text(model.model,"模型 ID",500),...(model?.reasoningEffort?{reasoningEffort:text(model.reasoningEffort,"推理强度")}: {})},enabled:member.enabled!==false};
  });
}

export function environmentOf(input={}, {draft=false}={}) {
  const cwd=typeof input.cwd==="string"?input.cwd.trim():"";
  if(!draft&&cwd&&!isAbsolute(cwd))throw new Error("工作目录需要完整绝对路径");
  const overrides={};
  for(const [id,path] of Object.entries(input.overrides??{})){if(typeof path!=="string"||!isAbsolute(path))throw new Error("成员环境需要绝对路径");overrides[id]=path;}
  const presetOverrides=Object.fromEntries(Object.entries(input.presetOverrides??{}).map(([id,value])=>[id,text(value,"成员 Agent 配置")]));
  return {cwd,overrides,...(Object.keys(presetOverrides).length?{presetOverrides}:{}),...(input.agentPreset?{agentPreset:text(input.agentPreset,"Agent 配置")}: {})};
}

// The interface owns draft identity, immutable roster choices and start recovery.
// Native Session creation remains in the existing DSH adapter, not in this module.
export class CollaborationWorkspace {
  constructor(store,persist,defaults){this.store=store;this.persist=persist;this.defaults=defaults;this.starts=new Map();}
  get data(){return this.store.state.workspace;}
  async list(){await this.store.ready;return clone({drafts:this.data.drafts.filter(draft=>!draft.discardedAt&&!draft.startedRoomId&&!draft.groupCreatedId),rosters:this.data.rosters.filter(roster=>!roster.archivedAt)});}
  async configuration(groupId,{all=false}={}){
    await this.store.ready;
    if(!groupId)return {members:[],environment:{cwd:"",overrides:{}},charter:"",autoDeliver:true,mode:"read_only_audit"};
    const defaults=await this.defaults(groupId);
    const members=rosterMembers(defaults.members.map(member=>({...member,model:member.config?.model??member.model,
      enabled:all||!defaults.defaultParticipantIds||defaults.defaultParticipantIds.includes(member.id)})),{draft:true});
    const paths=defaults.members.map(member=>member.config?.cwd).filter(Boolean),unique=[...new Set(paths)];
    const environment=defaults.environment??{cwd:unique.length===1?unique[0]:"",overrides:Object.fromEntries(defaults.members.filter(member=>member.config?.cwd).map(member=>[member.id,member.config.cwd])),presetOverrides:Object.fromEntries(defaults.members.filter(member=>member.config?.agentPreset).map(member=>[member.id,member.config.agentPreset]))};
    return {members,defaultParticipantIds:defaults.defaultParticipantIds??members.filter(m=>m.enabled).map(m=>m.id),environment:environmentOf(environment),charter:defaults.charter??"",autoDeliver:defaults.autoDeliver!==false,mode:defaults.defaultActionMode??"read_only_audit"};
  }
  async updateGroup(groupId,{expectedRevision,operationId,...patch}){
    await this.store.ready;
    if(!operationId)throw new Error("缺少修改憑據");
    const key=fingerprint({groupId,expectedRevision,patch}),replay=this.data.groupOperations.find(r=>r.id===operationId);
    if(replay){if(replay.fingerprint!==key)throw new Error("修改憑據內容衝突");await this.persist();return clone(replay.result);}
    const group=this.store.state.groups.find(g=>g.id===groupId);
    if(!group||group.archivedAt||group.deletedAt)throw new Error("群組不存在或已收存，請先恢復");
    if(group.revision!==expectedRevision)throw Object.assign(new Error("群組已在別處更新；請比較後保存"),{status:409});
    for(const field of Object.keys(patch))if(!["name","members","defaultParticipantIds","environment","charter","mode","autoDeliver"].includes(field))throw new Error(`unknown group setting ${field}`);
    const name=patch.name===undefined?group.name:text(patch.name,"群組名稱",120);
    if(this.store.state.groups.some(g=>g.id!==groupId&&!g.deletedAt&&g.name===name))throw new Error("已有同名群組，請改名");
    const existing=group.defaults;
    if(patch.members?.some(m=>m.context))throw new Error("接續原生會話只能加入具體對話，不能存為群組預設");
    let environment=patch.environment===undefined?existing.environment:environmentOf(patch.environment);
    if(patch.members&&!environment)environment=(await this.configuration(groupId,{all:true})).environment;
    if(group.revision!==expectedRevision||group.archivedAt||group.deletedAt)throw Object.assign(new Error("群組已在讀取期間更新；請重新核對"),{status:409});
    const plan=patch.members?this.store.directory.planMembers(rosterMembers(patch.members,{draft:true}),`group-change:${operationId}`,{allowArchivedIds:existing.members.map(m=>m.agentId)}):{members:clone(existing.members),created:[]};
    const ids=new Set(plan.members.map(m=>m.id));
    const defaults=patch.defaultParticipantIds??(existing.defaultParticipantIds??existing.members.map(m=>m.id)).filter(id=>ids.has(id));
    if(!Array.isArray(defaults)||new Set(defaults).size!==defaults.length||defaults.some(id=>!ids.has(id)))throw new Error("預選名單必須來自群組成員");
    const mode=patch.mode??existing.defaultActionMode??"read_only_audit";
    if(!modes.has(mode))throw new Error("未知權限模式");
    const next={...group,name,revision:group.revision+1,updatedAt:Date.now(),defaults:{...existing,frozen:patch.members||patch.environment?true:existing.frozen,members:plan.members,defaultParticipantIds:defaults,
      ...(environment?{environment}:{}),defaultActionMode:mode,charter:patch.charter===undefined?existing.charter:String(patch.charter).slice(0,20000),autoDeliver:patch.autoDeliver??existing.autoDeliver}};
    this.store.directory.publish(plan);Object.assign(group,next);
    this.data.groupOperations.push({id:operationId,fingerprint:key,result:clone(next)});
    await this.persist();return clone(next);
  }
  async saveRoster({id,name,members,expectedRevision,operationId}) {
    await this.store.ready;
    const key=fingerprint({id,name,members,expectedRevision});
    const replay=operationId&&this.data.rosters.find(item=>item.lastSave?.operationId===operationId);
    if(replay){if(replay.lastSave.fingerprint!==key)throw new Error("阵容保存凭据内容冲突");await this.persist();return clone(replay);}
    const normalized=rosterMembers(members).map(({context,...member})=>member),old=id&&this.data.rosters.find(item=>item.id===id);
    if(id&&!old)throw new Error("阵容不存在");
    if(old&&old.revision!==Number(expectedRevision))throw new Error("阵容已更新，请刷新后另存或重试");
    const next={id:old?.id??crypto.randomUUID(),name:text(name,"阵容名称",120),members:normalized,revision:(old?.revision??0)+1,updatedAt:Date.now(),...(operationId?{lastSave:{operationId,fingerprint:key}}:{})};
    if(old){old.versions??=[];old.versions.push({revision:old.revision,members:clone(old.members),name:old.name});Object.assign(old,next);}else this.data.rosters.push(next);
    await this.persist();return clone(next);
  }
  async createGroup(input) {
    await this.store.ready;
    const operationId=text(input.operationId,"创建凭据"),name=text(input.name,"群组名称",120);
    const members=rosterMembers(input.members??[],{draft:true}),environment=environmentOf(input.environment),mode=input.mode??"read_only_audit";
    if(members.some(m=>m.context))throw new Error("接續原生會話只能加入具體對話；群組僅能保存配置");
    if(!modes.has(mode))throw new Error("未知权限模式");
    const key=fingerprint({name,members,environment,mode,autoDeliver:input.autoDeliver!==false,charter:input.charter??""});
    const previous=this.data.groupOperations.find(item=>item.id===operationId);
    if(previous){if(previous.fingerprint!==key)throw new Error("创建凭据内容已变化");await this.persist();return clone(this.store.state.groups.find(group=>group.id===previous.groupId));}
    const draft=input.draftId&&this.data.drafts.find(item=>item.id===input.draftId);
    if(input.draftId&&(!draft||draft.kind!=="group"||draft.discardedAt||draft.start||draft.groupCreatedId||draft.revision!==Number(input.expectedRevision)))throw new Error("群组草稿已变化，请重新核对");
    if(this.store.state.groups.some(group=>!group.deletedAt&&group.name===name))throw new Error("已有同名群组，请换一个名称");
    const plan=this.store.directory.planMembers(members,`group:${operationId}`);
    const group={id:crypto.randomUUID(),name,revision:1,createdAt:Date.now(),defaults:{frozen:true,defaultParticipantIds:plan.members.filter(m=>m.enabled).map(m=>m.id),autoDeliver:input.autoDeliver!==false,charter:String(input.charter??"").slice(0,20000),defaultActionMode:mode,environment,members:plan.members.map(member=>({...member,config:{model:member.model,cwd:environment.overrides[member.id]??environment.cwd}}))}};
    this.store.directory.publish(plan);
    this.store.state.groups.push(group);this.data.groupOperations.push({id:operationId,fingerprint:key,groupId:group.id});
    if(draft)draft.groupCreatedId=group.id;
    await this.persist();return clone(group);
  }
  async openDraft({groupId=null,sourceGroupId=null,another=false,kind="conversation",ephemeral=false}={}) {
    await this.store.ready;
    if(!["conversation","group"].includes(kind))throw new Error("未知草稿类型");
    if(kind==="group")groupId=null;
    if(groupId){const target=this.store.state.groups.find(g=>g.id===groupId);if(!target||target.archivedAt||target.deletedAt)throw new Error("群組已收存或不存在，請先恢復");}
    const existing=!another&&this.data.drafts.findLast(draft=>draft.groupId===groupId&&draft.kind===kind&&!draft.discardedAt&&!draft.startedRoomId&&!draft.groupCreatedId);
    if(existing)return clone(existing);
    const configuration=await this.configuration(kind==="group"?sourceGroupId:groupId);
    if(kind==="group"){
      configuration.environment={cwd:"",overrides:{}};
      configuration.mode="inherit_dsh";
      configuration.charter="";
    }
    // Recheck after asynchronous native configuration observation.
    const raced=!another&&this.data.drafts.findLast(draft=>draft.groupId===groupId&&draft.kind===kind&&!draft.discardedAt&&!draft.startedRoomId&&!draft.groupCreatedId);
    if(raced)return clone(raced);
    const draft={id:crypto.randomUUID(),kind,groupId,revision:1,title:"",text:"",...configuration,createdAt:Date.now(),updatedAt:Date.now()};
    if(ephemeral)return {...draft,ephemeral:true};
    this.data.drafts.push(draft);await this.persist();return clone(draft);
  }
  async saveDraft(id,{expectedRevision,operationId,seed,...input}) {
    await this.store.ready;
    let mutated=false;
    try {
    let draft=this.data.drafts.find(item=>item.id===id),fresh=false;
    if(!draft&&seed&&expectedRevision===1&&/^[\da-f-]{36}$/i.test(id)&&["group","conversation"].includes(seed.kind)){
      const groupId=seed.kind==="group"?null:seed.groupId??null;
      if(groupId){const group=this.store.state.groups.find(g=>g.id===groupId);if(!group||group.archivedAt||group.deletedAt)throw new Error("群組已收存或不存在；輸入仍保留");}
      draft={id,kind:seed.kind,groupId,revision:1,title:"",text:"",members:[],environment:{cwd:"",overrides:{}},charter:"",autoDeliver:true,mode:seed.kind==="group"?"inherit_dsh":"read_only_audit",createdAt:Date.now(),updatedAt:Date.now()};fresh=true;
    }
    if(!draft||draft.discardedAt||draft.startedRoomId||draft.groupCreatedId||draft.start)throw new Error("草稿已开始或不可编辑；请查看开始结果");
    const key=fingerprint({expectedRevision,input,...(seed?{seed}:{})});
    if(operationId&&draft.lastSave?.operationId===operationId){if(draft.lastSave.fingerprint!==key)throw new Error("草稿保存凭据内容冲突");await this.persist();return clone(draft);}
    if(draft.revision!==Number(expectedRevision))throw new Error("草稿在别处已更新；输入保留，请重新载入后比较");
    const next={...draft};
    for(const key of Object.keys(input))if(!["title","text","members","environment","charter","autoDeliver","mode","rosterSource","background","origin"].includes(key))throw new Error(`unsupported draft field: ${key}`);
    if(input.title!==undefined)next.title=String(input.title).slice(0,120);
    if(input.text!==undefined){if(typeof input.text!=="string"||input.text.length>200000)throw new Error("草稿内容过长");next.text=input.text;}
    if(input.members!==undefined)next.members=rosterMembers(input.members,{draft:true});
    if(input.environment!==undefined)next.environment=environmentOf(input.environment,{draft:true});
    if(input.mode!==undefined){if(!modes.has(input.mode))throw new Error("未知权限模式");next.mode=input.mode;}
    if(input.charter!==undefined)next.charter=String(input.charter).slice(0,20000);
    if(input.autoDeliver!==undefined)next.autoDeliver=Boolean(input.autoDeliver);
    if(input.rosterSource!==undefined)next.rosterSource=clone(input.rosterSource);
    // Origins are created only from server-verified selected messages, never from an arbitrary draft body.
    if(input.origin!==undefined||input.background!==undefined)throw new Error("背景必须从对话消息的分支入口选择");
    Object.assign(draft,next,{revision:draft.revision+1,updatedAt:Date.now(),...(operationId?{lastSave:{operationId,fingerprint:key}}:{})});if(fresh)this.data.drafts.push(draft);mutated=true;await this.persist();return clone(draft);
    }catch(error){if(!mutated)error.status=/别处已更新/u.test(error.message)?409:400;throw error;}
  }
  async discardDraft(id,expectedRevision){await this.store.ready;const draft=this.data.drafts.find(item=>item.id===id);if(!draft||draft.revision!==Number(expectedRevision)||draft.start||draft.groupCreatedId||draft.startedRoomId)throw new Error("草稿已变化或开始，请先核对");draft.discardedAt=Date.now();draft.revision++;await this.persist();return {discarded:true};}
  async preflight(draft) {
    const checks=[];
    for(const member of draft.members.filter(item=>item.enabled)){
      let kind="environment";
      try{
        let model=member.model;
        let cwd=draft.environment.overrides[member.id]??draft.environment.cwd;
        if(member.context){kind="context";const config=await this.store.directory.validateNative(member.context,{kind:"conversation-draft",id:draft.id});cwd=config.cwd;model=config.model;}
        kind="environment";
        if(!cwd||!isAbsolute(cwd)||!(await stat(cwd)).isDirectory())throw new Error("请选择存在的工作目录（完整绝对路径）");
        kind="model";
        const llm=this.store.ctx.get?.("llm")??this.store.ctx.llm;
        if(!llm?.resolveCallConfig)throw new Error("DSH 模型配置服务不可用");
        if(!model?.provider||!model?.model)throw new Error("尚未選擇模型；請為這位成員選擇可用模型");
        const resolved=await llm.resolveCallConfig(model);
        if(resolved.provider!==model.provider||resolved.model!==model.model)throw new Error("所选模型不再可用，未替换模型");
        checks.push({id:member.id,alias:member.alias,ok:true});
      }catch(error){checks.push({id:member.id,alias:member.alias,ok:false,kind,error:String(error.message??error)});}
    }
    return checks;
  }
  async startDraft(id,input){
    await this.store.ready;
    const key=fingerprint(input),running=this.starts.get(id);
    if(running){if(running.key!==key)throw new Error("此草稿正在以另一套配置开始");return clone(await running.promise);}
    const promise=this.startOnce(id,input);this.starts.set(id,{key,promise});
    try{return clone(await promise);}finally{this.starts.delete(id);}
  }
  async startOnce(id,{expectedRevision,confirmRisk=false}) {
    const draft=this.data.drafts.find(item=>item.id===id);
    if(!draft||draft.discardedAt||draft.kind!=="conversation")throw new Error("对话草稿不存在");
    if(draft.revision!==Number(expectedRevision))throw new Error("草稿已更新，请核对后开始");
    if(draft.startedRoomId){await this.persist();return {room:await this.store.resolveRoom(draft.startedRoomId),state:draft.start.state};}
    if(!draft.text.trim())throw new Error("请先输入讨论内容；只需保存团队时使用保存群组");
    if(!draft.start){
      if(["inherit_dsh","workspace_write","full_access"].includes(draft.mode)&&!confirmRisk)throw new Error("请确认本次执行权限及工作环境");
      const checks=await this.preflight(draft);
      if(draft.discardedAt||draft.startedRoomId||draft.revision!==Number(expectedRevision))throw new Error("预检期间草稿已更新或取消；未开始");
      if(checks.some(check=>!check.ok))return {state:"needs_configuration",checks};
      rosterMembers(draft.members.filter(member=>member.enabled));
      const snapshot=clone({...draft,start:undefined});
      draft.start={operationId:crypto.randomUUID(),state:"saved",snapshot,authorization:confirmRisk?fingerprint(snapshot):null,createdAt:Date.now()};
      try{await this.persist();}catch(error){delete draft.start;throw error;}
    }
    const start=draft.start,snapshot=start.snapshot;
    let groupId=snapshot.groupId;
    if(!groupId){
      let group=this.store.state.groups.find(item=>item.unclassified);
      if(!group){group={id:crypto.randomUUID(),name:"未分类",unclassified:true,revision:1,createdAt:Date.now(),defaults:{frozen:true,members:[],charter:"",autoDeliver:true,defaultActionMode:"read_only_audit"}};this.store.state.groups.push(group);}
      groupId=group.id;await this.persist();
    }
    const selected=snapshot.members.filter(member=>member.enabled);
    const authorized=start.authorization===fingerprint(snapshot);
    if(["inherit_dsh","workspace_write","full_access"].includes(snapshot.mode)&&!authorized)throw new Error("开始记录缺少与配置匹配的权限确认；未投递，请联系维护者核对记录");
    let room;
    try{room=await this.store.createConversation(groupId,{operationId:`draft:${start.operationId}`,title:snapshot.title||undefined,selectionTarget:{kind:"conversation-draft",id:draft.id},configuration:{members:selected,environment:snapshot.environment,charter:snapshot.charter,autoDeliver:snapshot.autoDeliver,mode:snapshot.mode},confirmRisk:authorized});}
    catch(error){
      // A rejected preparation is editable again. An unknown persisted result is never reset or replayed.
      if(["preview_required","native_changed","native_busy"].includes(error.code)&&!this.store.state.rooms.some(r=>r.creation?.operationId===`draft:${start.operationId}`)){delete draft.start;await this.persist();}
      throw error;
    }
    start.roomId=room.id;await this.persist();
    const prior=(await this.store.messages(room.id,500)).find(message=>message.clientOperationId===`draft-first:${start.operationId}`);
    if(!prior){
      await this.store.send({roomId:room.id,author:"human:me",authorKind:"human",authorAlias:"我",text:snapshot.text,clientOperationId:`draft-first:${start.operationId}`,automaticDelivery:false});
    }
    // Persist before crossing Host. A restart at/after this point requires result inspection, never blind replay.
    if(start.state==="saved"){
      start.state="dispatching";try{await this.persist();}catch(error){start.state="saved";throw error;}
      try{await this.store.deliverSavedMessage(room.id,`draft-first:${start.operationId}`);}catch(error){if(error.definitelyNotDispatched){start.state="saved";await this.persist().catch(()=>{});}throw error;}
      start.state=selected.length&&snapshot.autoDeliver?"started":"note_saved";
    }else if(start.state==="dispatching")start.state="check_results";
    draft.startedRoomId=room.id;await this.persist();return {room:await this.store.resolveRoom(room.id),state:start.state};
  }
}
