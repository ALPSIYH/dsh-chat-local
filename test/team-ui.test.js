import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createTeamUI} from "../lib/team-ui.js";

const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(item=>item!==null&&item!==undefined&&item!==false)});
const nodes=tree=>{const out=[];const visit=item=>{if(item&&typeof item==="object"){out.push(item);item.children?.forEach(visit);}};visit(tree);return out;};
const content=node=>typeof node==="string"?node:node?.children?.map(content).join("")??"";
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function harness(name,props={},context={},respond=async()=>[],globals={}) {
  const slots=[],pending=[],calls=[],cleanups=[];let index=0,tree;
  const React={
    useRef(value){const i=index++;return slots[i]??(slots[i]={current:value});},
    useState(value){const i=index++;if(!(i in slots))slots[i]=typeof value==="function"?value():value;return [slots[i],next=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},
    useEffect(fn,deps){const i=index++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old[j]))){slots[i]=deps;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},
  };
  const api=async(path,options)=>{const body=options?.body?JSON.parse(options.body):undefined;calls.push({path,method:options?.method??"GET",body});return respond(path,body,options);};
  const ctx={remote:{session:{modelCatalog:async()=>({ok:true,value:{groups:[]}})}},...context};
  const types=vm.runInNewContext(`(${createTeamUI.toString()})(React,h,api,ctx)`,{React,h,api,ctx,crypto,structuredClone,setTimeout,clearTimeout,AbortController,...globals});
  const render=()=>{index=0;tree=types[name](props);return tree;};
  const effects=async()=>{while(pending.length)pending.shift()();await settle();render();};
  render();return {types,render,effects,calls,nodes:()=>nodes(tree),find:label=>nodes(tree).find(node=>node.props["aria-label"]===label),button:label=>nodes(tree).find(node=>node.type==="button"&&content(node)===label),text:()=>content(tree),unmount:()=>cleanups.forEach(fn=>fn?.())};
}

test("new Agent editing remains a local draft and never guesses the first catalog model",async()=>{
  let saved;
  const f=harness("AgentEditor",{initial:{},onSave:value=>{saved=value;},onCancel(){},submitLabel:"加入草稿",scope:"本次草稿"},{remote:{session:{modelCatalog:async()=>({ok:true,value:{groups:[{id:"p",models:[{id:"first",name:"第一模型"}]}]}})}}});
  await f.effects();f.find("Agent 名稱").props.onChange({target:{value:"方法顧問"}});f.render();
  await f.nodes().find(node=>node.type==="form").props.onSubmit({preventDefault(){}});
  assert.equal(saved.alias,"方法顧問");assert.equal(saved.model.model,"");assert.equal(f.calls.length,0);
});

test("mixed participant selection is local until apply and cancelling a new Agent preserves the parent selection",async()=>{
  const original=[{id:"member-a",agentId:"agent-a",alias:"既有顧問",model:{provider:"p",model:"m"},enabled:true}];let applied,closed=0;
  const f=harness("ParticipantPicker",{members:original,target:{kind:"group-draft",id:"d"},onApply:value=>{applied=value;},onClose:()=>{closed++;}});
  await f.effects();f.button("新建 Agent").props.onClick();f.render();
  let editor=f.nodes().find(node=>node.type===f.types.AgentEditor);editor.props.onCancel();f.render();
  assert.match(f.text(),/既有顧問/);f.button("新建 Agent").props.onClick();f.render();editor=f.nodes().find(node=>node.type===f.types.AgentEditor);
  editor.props.onSave({alias:"新顧問",role:"審閱",model:{provider:"",model:""}});f.render();
  assert.equal(f.calls.filter(call=>call.method==="POST").length,0);assert.equal(original.length,1);
  await f.button("使用這 2 位").props.onClick();assert.equal(applied.length,2);assert.equal(applied[1].agentId,undefined);assert.equal(original.length,1);assert.equal(closed,0);
});

test("an active conversation model is locked while alias and role remain editable",async()=>{
  const f=harness("AgentEditor",{initial:{alias:"顧問",lockedModel:true,model:{provider:"p",model:"m"}},onSave(){},onCancel(){}});
  await f.effects();assert.equal(f.find("Agent 模型").props.disabled,true);assert.equal(f.find("Agent 名稱").props.disabled,false);assert.match(f.text(),/已開始對話的模型請在參與者面板調整/);
});

test("native sessions stay behind an explicit import flow and a busy session cannot be continued",async()=>{
  const f=harness("ParticipantPicker",{members:[],target:{kind:"conversation-draft",id:"d"},onApply(){},onClose(){}},{sessions:{list:{getSnapshot:()=>({ids:["s"],byId:{s:{title:"原生研究",cwd:"/work",running:true}}})}}},async(path,body)=>path==="/native-preview"?{title:"原生研究",busy:true,sharedWith:[{id:"r",name:"既有討論"}],config:{cwd:"/work",model:{provider:"p",model:"m"}}}:[]);
  await f.effects();assert.doesNotMatch(f.text(),/原生研究/);f.button("從 DSH 會話匯入／接續").props.onClick();f.render();
  await f.button("原生研究").props.onClick();f.render();assert.equal(f.find("接續原生會話").props.disabled,true);assert.match(f.text(),/既有討論/);
  f.button("匯入配置為新 Agent").props.onClick();f.render();const editor=f.nodes().find(node=>node.type===f.types.AgentEditor);assert.equal(editor.props.initial.context,undefined);assert.equal(f.calls.filter(call=>call.path==="/agents"&&call.method==="POST").length,0);
});

test("directory selection probes the declared capability and native cancellation preserves the current path",async()=>{
  const changes=[],calls=[];
  const f=harness("DirectoryField",{value:"/original",onChange:value=>changes.push(value)},{uiWorkspace:{async listDirectory(){calls.push("list");throw {message:"native backend",rpcError:{code:"directory-picker/unavailable",details:{capability:"native"}}};},async pickDirectory(){calls.push("pick");return null;}}});
  await f.button("選擇資料夾").props.onClick();f.render();assert.deepEqual(calls,["list","pick"]);assert.deepEqual(changes,[]);assert.match(f.text(),/original/);
});

test("archiving an Agent requires a usage-aware confirmation and never creates a native session",async()=>{
  const profile={id:"agent",revision:3,alias:"方法顧問",role:"審查",model:{provider:"p",model:"m"},usages:[{kind:"group",id:"g",name:"研究小組"}]};
  const f=harness("AgentLibrary",{}, {},async(path,body)=>path.includes("lifecycle")?{...profile,archivedAt:123,revision:4}:[profile]);
  await f.effects();f.find("歸檔 方法顧問").props.onClick();f.render();assert.match(f.text(),/研究小組/);assert.equal(f.calls.filter(call=>call.method==="POST").length,0);
  await f.button("確認歸檔").props.onClick();f.render();assert.equal(f.calls.at(-1).body.action,"archive");assert.equal(f.calls.at(-1).body.expectedRevision,3);assert.match(f.text(),/現有群組與對話/);
});

test("a new draft Agent can be deselected and selected again without being published",async()=>{
  let applied;const f=harness("ParticipantPicker",{members:[{id:"draft-agent",alias:"新顧問",model:{provider:"",model:""},enabled:true}],target:{kind:"group-draft",id:"d"},onApply:value=>{applied=value;},onClose(){}});
  await f.effects();f.find("本次不選 新顧問").props.onClick();f.render();const choice=f.nodes().find(node=>node.type==="input"&&node.props.type==="checkbox"&&node.props["aria-label"]?.startsWith("選擇 新顧問"));assert.ok(choice);
  await choice.props.onChange();await settle();f.render();await f.button("使用這 1 位").props.onClick();assert.equal(applied[0].enabled,true);assert.equal(f.calls.filter(call=>call.method!=="GET").length,0);
});

test("a rejected participant apply preserves edits and group membership is not mutated",async()=>{
  const original=[{id:"a",agentId:"a",alias:"A",enabled:true},{id:"b",agentId:"b",alias:"B",enabled:true}];let attempts=0;
  const f=harness("ParticipantPicker",{members:original,groupMembers:original,target:{kind:"conversation-members",id:"r"},extraContent:h("p",null,"本次執行範圍"),onApply:async()=>{attempts++;throw new Error("B 仍有未交接任務");},onClose(){}});
  await f.effects();f.find("本次不選 B").props.onClick();f.render();await f.button("使用這 1 位").props.onClick();f.render();
  assert.match(f.text(),/B 仍有未交接任務/);assert.match(f.text(),/本次執行範圍/);assert.equal(original[1].enabled,true);assert.equal(f.button("使用這 1 位").props.disabled,false);assert.equal(attempts,1);
});

test("same-name Agent identities stay separate and aliases must be disambiguated before apply",async()=>{
  let applied=0;const f=harness("ParticipantPicker",{members:[{id:"m1",agentId:"a1",alias:"顧問"},{id:"m2",agentId:"a2",alias:"顧問"}],target:{kind:"conversation-draft",id:"d"},onApply:()=>{applied++;},onClose(){}});
  await f.effects();await f.button("使用這 2 位").props.onClick();f.render();assert.match(f.text(),/重名/);assert.equal(applied,0);
  const edits=f.nodes().filter(node=>node.props["aria-label"]==="編輯 顧問");edits[1].props.onClick();f.render();const editor=f.nodes().find(node=>node.type===f.types.AgentEditor);editor.props.onSave({...editor.props.initial,alias:"方法顧問"});f.render();await f.button("使用這 2 位").props.onClick();assert.equal(applied,1);
});

test("directory browse selects only a server-returned path and unknown capabilities never open native UI",async()=>{
  const changes=[];let picks=0;
  const f=harness("DirectoryField",{value:"/before",onChange:path=>changes.push(path)},{uiWorkspace:{listDirectory:async()=>({path:"/host/chosen",entries:[],crumbs:[{name:"home",path:"/host"}]}),pickDirectory:async()=>{picks++;}}});
  await f.button("選擇資料夾").props.onClick();f.render();await f.button("使用此資料夾").props.onClick();assert.deepEqual(changes,["/host/chosen"]);assert.equal(picks,0);
  const unknown=harness("DirectoryField",{value:"/before",onChange:path=>changes.push(path)},{uiWorkspace:{listDirectory:async()=>{throw {message:"unsupported",rpcError:{code:"directory-picker/unavailable",details:{capability:"future-kind"}}};},pickDirectory:async()=>{picks++;}}});
  await unknown.button("選擇資料夾").props.onClick();unknown.render();assert.equal(picks,0);assert.match(unknown.text(),/原路徑未變更/);
});

test("Agent save response loss reuses one operation receipt and retains the editor",async()=>{
  let first=true;const f=harness("AgentLibrary",{}, {},async(path,body)=>{if(path!=="/agents")return [];if(first){first=false;throw new Error("connection lost");}return {id:"saved-agent",revision:1,...body.profile};});
  await f.effects();f.button("新建 Agent").props.onClick();f.render();let editor=f.nodes().find(node=>node.type===f.types.AgentEditor);const profile={alias:"顧問",role:"",model:{provider:"",model:""}};
  await assert.rejects(editor.props.onSave(profile),/connection lost/);f.render();editor=f.nodes().find(node=>node.type===f.types.AgentEditor);assert.ok(editor);await editor.props.onSave(profile);f.render();
  const writes=f.calls.filter(call=>call.path==="/agents");assert.equal(writes[0].body.operationId,writes[1].body.operationId);assert.match(f.text(),/Agent 已保存/);
});

test("IME composition cannot submit or close an Agent editor",async()=>{
  let saved=0,closed=0,stopped=0;const f=harness("AgentEditor",{initial:{alias:"顧問"},onSave:()=>{saved++;},onCancel:()=>{closed++;}}),form=f.nodes().find(node=>node.type==="form");
  form.props.onCompositionStart();form.props.onKeyDown({key:"Escape",preventDefault(){},stopPropagation(){stopped++;}});await form.props.onSubmit({preventDefault(){}});assert.equal(saved,0);assert.equal(closed,0);assert.equal(stopped,1);
  form.props.onCompositionEnd();form.props.onKeyDown({key:"Escape",preventDefault(){},stopPropagation(){}});assert.equal(closed,1);
});

test("Dialog owns focus, preserves an already-inert surface, and restores its invoker",async()=>{
  const doc={activeElement:null,body:{}};const trigger={isConnected:true,focus(){doc.activeElement=this;}};doc.activeElement=trigger;
  const first={getClientRects:()=>[{}],focus(){doc.activeElement=this;}},last={getClientRects:()=>[{}],focus(){doc.activeElement=this;}},other={inert:false},already={inert:true};
  const parent={parentElement:doc.body},backdrop={parentElement:parent};parent.children=[backdrop,other,already];doc.body.children=[parent];
  const element={parentElement:backdrop,querySelector:()=>first,querySelectorAll:()=>[first,last],focus(){doc.activeElement=this;}};backdrop.children=[element];
  const f=harness("Dialog",{title:"選人",onClose(){}},{},async()=>[],{document:doc});f.nodes().find(node=>node.props.role==="dialog").props.ref.current=element;await f.effects();
  assert.equal(doc.activeElement,first);assert.equal(other.inert,true);const modal=f.nodes().find(node=>node.props.role==="dialog");doc.activeElement=last;let prevented=0,stopped=0;modal.props.onKeyDown({key:"Tab",preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(doc.activeElement,first);assert.equal(prevented,1);assert.equal(stopped,1);
  f.unmount();assert.equal(doc.activeElement,trigger);assert.equal(other.inert,false);assert.equal(already.inert,true);
});

test("editing after an uncertain Agent creation must reconcile the original operation before writing a new version",async()=>{
  let first=true;const f=harness("AgentLibrary",{}, {},async(path,body)=>{if(path!=="/agents")return [];if(first){first=false;throw new Error("response lost");}return {id:"one-agent",revision:body.id?2:1,...body.profile};});
  await f.effects();f.button("新建 Agent").props.onClick();f.render();let editor=f.nodes().find(node=>node.type===f.types.AgentEditor);
  await assert.rejects(editor.props.onSave({alias:"原稱呼",model:{provider:"",model:""}}),/response lost/);f.render();editor=f.nodes().find(node=>node.type===f.types.AgentEditor);
  await assert.rejects(editor.props.onSave({alias:"新稱呼",model:{provider:"",model:""}}),/先核對/);assert.equal(f.calls.filter(call=>call.path==="/agents").length,1);
  f.render();await f.button("核對上次保存結果").props.onClick();f.render();editor=f.nodes().find(node=>node.type===f.types.AgentEditor);assert.ok(editor);assert.equal(editor.props.initial.id,"one-agent");
  await editor.props.onSave({alias:"新稱呼",model:{provider:"",model:""}});const writes=f.calls.filter(call=>call.path==="/agents");assert.equal(writes[0].body.operationId,writes[1].body.operationId);assert.equal(writes[2].body.id,"one-agent");assert.equal(writes[2].body.expectedRevision,1);
});

test("an uncertain standalone Agent save survives leaving and reopening the library",async()=>{
  const store=new Map(),globals={localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
  const first=harness("AgentLibrary",{}, {},async(path)=>{if(path==="/agents")throw new Error("offline");return [];},globals);
  await first.effects();first.button("新建 Agent").props.onClick();first.render();await assert.rejects(first.nodes().find(node=>node.type===first.types.AgentEditor).props.onSave({alias:"保留顧問",model:{provider:"",model:""}}),/offline/);first.unmount();
  const second=harness("AgentLibrary",{}, {},async(path,body)=>path==="/agents"?{id:"same-agent",revision:1,...body.profile}:[],globals);await second.effects();assert.ok(second.button("核對上次保存結果"));await second.button("核對上次保存結果").props.onClick();
  assert.equal(first.calls.find(call=>call.path==="/agents").body.operationId,second.calls.find(call=>call.path==="/agents").body.operationId);assert.equal(store.size,0);
});

test("selecting a group member uses that group's snapshot, not newer global Agent defaults",async()=>{
  let applied;const f=harness("ParticipantPicker",{members:[],groupMembers:[{id:"membership",agentId:"agent",agentRevision:2,alias:"本群方法顧問",role:"本群分工",model:{provider:"p",model:"group-model"}}],target:{kind:"conversation-draft",id:"d"},onApply:value=>{applied=value;},onClose(){}},{},async(path)=>{if(path.endsWith("/selection"))throw new Error("must preserve group defaults");return [{id:"agent",revision:3,alias:"全局新名字",role:"另一種職務",model:{provider:"p",model:"global-model"}}];});
  await f.effects();assert.match(f.text(),/本群方法顧問/);const choice=f.nodes().find(node=>node.type==="input"&&node.props.type==="checkbox");choice.props.onChange();await settle();f.render();await f.button("使用這 1 位").props.onClick();assert.equal(applied[0].alias,"本群方法顧問");assert.equal(applied[0].agentRevision,2);assert.equal(applied[0].model.model,"group-model");
});

test("participant candidates use two lines by default and disambiguate only duplicate names with meaningful identity and group hints",async()=>{
  const profiles=[
    {id:"legacy-agent-111111112222222233333333abcd1234",alias:"方法顧問",role:"設計",model:{provider:"p",model:"m"}},
    {id:"legacy-agent-111111112222222233333333eeee5678",alias:"顧問",role:"校閱",model:{provider:"p",model:"m"},usages:[{id:"g1",name:"研究群組"}]},
    {id:"agent-999999992222222233333333ffff9012",alias:"顧問",role:"開發",model:{provider:"p",model:"m"},usages:[{id:"g2",name:"程式群組"}]},
  ];
  const f=harness("ParticipantPicker",{members:[],target:{kind:"group-draft",id:"d"},onApply(){},onClose(){}},{},async()=>profiles);await f.effects();
  const cards=f.nodes().filter(node=>node.type==="label"&&node.props.className?.startsWith("dclTeamCandidate")),unique=cards[0];
  assert.equal(nodes(unique).filter(node=>node.type==="small").length,1);assert.doesNotMatch(content(unique),/abcd1234|legacy-agent-/);assert.match(unique.props.title,/legacy-agent-111111112222222233333333abcd1234/);
  assert.match(nodes(unique).find(node=>node.type==="input").props["aria-label"],/abcd1234/);
  assert.match(content(cards[1]),/eeee5678/);assert.match(content(cards[1]),/研究群組/);assert.match(content(cards[2]),/ffff9012/);assert.match(content(cards[2]),/程式群組/);assert.doesNotMatch(content(cards[1]),/legacy-agent-/);
});

test("group targets describe native import as configuration only while conversation targets retain explicit continuation",async()=>{
  for(const kind of ["group-draft","group-members"]){
    const f=harness("ParticipantPicker",{members:[],target:{kind,id:"target"},onApply(){},onClose(){}});await f.effects();
    assert.ok(f.button("從 DSH 會話匯入配置"));assert.equal(f.button("從 DSH 會話匯入／接續"),undefined);
    f.button("從 DSH 會話匯入配置").props.onClick();f.render();assert.ok(f.nodes().find(node=>node.type==="h3"&&content(node)==="從 DSH 會話匯入配置"));
  }
  const conversation=harness("ParticipantPicker",{members:[],target:{kind:"conversation-draft",id:"d"},onApply(){},onClose(){}});await conversation.effects();assert.ok(conversation.button("從 DSH 會話匯入／接續"));
});

test("editing an existing or named draft Agent with an unknown model never fills in the DSH default",async()=>{
  const context={remote:{session:{modelCatalog:async()=>({ok:true,value:{default:{provider:"p",model:"default"},groups:[{id:"p",models:[{id:"default"}]}]}})}}};
  for(const initial of [{id:"legacy",agentId:"agent",alias:"舊顧問",model:{}},{id:"draft-person",alias:"草稿顧問",model:{}},{alias:"已命名顧問",model:{}}]){
    let saved;const f=harness("AgentEditor",{initial,onSave:profile=>{saved=profile;},onCancel(){}},context);await f.effects();f.find("Agent 名稱").props.onChange({target:{value:"改名顧問"}});f.render();await f.nodes().find(node=>node.type==="form").props.onSubmit({preventDefault(){}});assert.equal(saved.model.provider??"","");assert.equal(saved.model.model??"","");
  }
  let fresh;const blank=harness("AgentEditor",{initial:{},onSave:profile=>{fresh=profile;},onCancel(){}},context);await blank.effects();blank.find("Agent 名稱").props.onChange({target:{value:"全新顧問"}});blank.render();await blank.nodes().find(node=>node.type==="form").props.onSubmit({preventDefault(){}});assert.equal(fresh.model.model,"default");
});

test("picker header close cancels the whole picker while editor cancel and Escape return to its list",async()=>{
  let closed=0,applied=0;const f=harness("ParticipantPicker",{members:[],target:{kind:"group-draft",id:"d"},initialMode:"new",onClose:()=>{closed++;},onApply:()=>{applied++;}});await f.effects();
  let dialog=f.nodes().find(node=>node.type===f.types.Dialog);dialog.props.onClose();assert.equal(closed,1);assert.equal(applied,0);
  let editor=f.nodes().find(node=>node.type===f.types.AgentEditor);editor.props.onCancel();f.render();assert.ok(f.button("新建 Agent"));assert.equal(closed,1);
  f.button("新建 Agent").props.onClick();f.render();dialog=f.nodes().find(node=>node.type===f.types.Dialog);dialog.props.onEscape();f.render();assert.ok(f.button("新建 Agent"));assert.equal(closed,1);
  let escaped=0,headerClosed=0;const layer=harness("Dialog",{title:"選人",onClose:()=>{headerClosed++;},onEscape:()=>{escaped++;}});layer.find("關閉選人").props.onClick();layer.nodes().find(node=>node.props.role==="dialog").props.onKeyDown({key:"Escape",preventDefault(){},stopPropagation(){}});assert.equal(headerClosed,1);assert.equal(escaped,1);
});

test("native directory waiting is visible and can abort into manual entry without changing the path",async()=>{
  let signal,legacyCalls=0;const changes=[];
  const f=harness("DirectoryField",{value:"/original",onChange:path=>changes.push(path)},{uiWorkspace:{listDirectory:async()=>{throw {rpcError:{code:"directory-picker/unavailable",details:{capability:"native"}}};},pickDirectory:async()=>{legacyCalls++;return "/wrong";}},remote:{directoryPicker:{pick:received=>{signal=received;return new Promise((resolve,reject)=>received.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));}}}});
  await f.effects();const work=f.button("選擇資料夾").props.onClick();await settle();f.render();assert.match(f.text(),/等待系統資料夾視窗/);assert.match(f.text(),/後方/);assert.equal(signal.aborted,false);f.button("取消選擇").props.onClick();await work;f.render();assert.equal(signal.aborted,true);assert.equal(legacyCalls,0);assert.deepEqual(changes,[]);assert.equal(f.find("工作目錄").props.disabled,false);assert.equal(f.nodes().find(node=>node.type==="details").props.open,true);assert.equal(f.button("選擇資料夾").props.disabled,false);
});

test("native remote results are unwrapped and leaving aborts the picker without applying a late result",async()=>{
  const changes=[],uiWorkspace={listDirectory:async()=>{throw {rpcError:{code:"directory-picker/unavailable",details:{capability:"native"}}};}};
  const saved=harness("DirectoryField",{value:"/original",onChange:path=>changes.push(path)},{uiWorkspace,remote:{directoryPicker:{pick:async()=>({ok:true,value:"/chosen"})}}});await saved.button("選擇資料夾").props.onClick();assert.deepEqual(changes,["/chosen"]);
  let signal,finish;const leaving=harness("DirectoryField",{value:"/original",onChange:path=>changes.push(path)},{uiWorkspace,remote:{directoryPicker:{pick:received=>{signal=received;return new Promise(resolve=>{finish=resolve;});}}}});await leaving.effects();const work=leaving.button("選擇資料夾").props.onClick();await settle();leaving.unmount();assert.equal(signal.aborted,true);finish({ok:true,value:"/late"});await work;assert.deepEqual(changes,["/chosen"]);
});

test("Agent library opens the stable identity's personality editor without publishing a profile",async()=>{
  const profile={id:"stable-agent",revision:4,alias:"方法顧問",model:{provider:"p",model:"m"}};
  const f=harness("AgentLibrary",{}, {},async()=>[profile]);await f.effects();
  f.find("編輯 方法顧問 的人格").props.onClick();f.render();
  const editor=f.nodes().find(node=>node.type===f.types.PersonaEditor);
  assert.equal(editor.props.agent.id,"stable-agent");
  assert.equal(f.calls.filter(call=>call.method==="POST").length,0);
  editor.props.onClose();f.render();assert.equal(f.nodes().some(node=>node.type===f.types.PersonaEditor),false);
});

test("personality templates remain unconfigured until an edited Markdown save carries the read hash",async()=>{
  let saved;const profile={agentId:"agent/a",markdown:"<!-- persona:unconfigured -->\n# 人格\n尚未設定。",hash:"template-hash",configured:false};
  const f=harness("PersonaEditor",{agent:{id:"agent/a",alias:"顧問"},onClose(){},onSaved:value=>{saved=value;}},{},async(path,body)=>body?{...profile,markdown:body.markdown,hash:"saved-hash",configured:true}:profile);
  await f.effects();assert.equal(f.calls[0].path,"/agents/agent%2Fa/persona");
  assert.match(f.text(),/尚未設定人格/);assert.doesNotMatch(f.find("Agent 人格 Markdown").props.value,/persona:unconfigured/);
  assert.equal(f.button("保存人格").props.disabled,true);
  f.find("Agent 人格 Markdown").props.onChange({target:{value:"# 人格\n偏好先核對證據。"}});f.render();
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});f.render();
  const write=f.calls.find(call=>call.method==="POST");
  assert.deepEqual(write.body,{markdown:"# 人格\n偏好先核對證據。",expectedHash:"template-hash"});
  assert.equal(saved.configured,true);assert.match(f.text(),/已設定人格/);assert.equal(f.button("保存人格").props.disabled,true);
});

test("personality conflict retains local Markdown and cannot overwrite until the user compares versions",async()=>{
  const old={agentId:"a",markdown:"# 原人格",hash:"old",configured:true},latest={...old,markdown:"# 另一處修改",hash:"new"};
  let reads=0,writes=0;
  const f=harness("PersonaEditor",{agent:{id:"a",alias:"顧問"},onClose(){}},{},async(path,body)=>{
    if(!body)return reads++===0?old:latest;
    if(writes++===0)throw Object.assign(new Error("changed"),{status:409});
    return {...latest,markdown:body.markdown,hash:"final"};
  });
  await f.effects();f.find("Agent 人格 Markdown").props.onChange({target:{value:"# 我的修改"}});f.render();
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});f.render();
  assert.equal(f.find("Agent 人格 Markdown").props.value,"# 我的修改");
  assert.equal(f.find("最新已保存人格").props.value,"# 另一處修改");
  assert.equal(f.button("保存人格").props.disabled,true);
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});assert.equal(writes,1,"a stale form submit cannot bypass comparison");
  f.button("已比較，保留我的修改").props.onClick();f.render();
  assert.equal(f.find("Agent 人格 Markdown").props.value,"# 我的修改");assert.equal(writes,1,"comparison is not an automatic write");
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});f.render();
  assert.equal(f.calls.filter(call=>call.method==="POST")[1].body.expectedHash,"new");
  assert.equal(f.find("Agent 人格 Markdown").props.value,"# 我的修改");
});

test("personality drafts survive close and reopening without silently adopting a newer server hash",async()=>{
  const storage=new Map(),globals={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
  const original={agentId:"a",markdown:"# Original",hash:"h1",configured:true};let closed=0;
  const first=harness("PersonaEditor",{agent:{id:"a"},onClose:()=>{closed++;}},{},async()=>original,globals);
  await first.effects();first.find("Agent 人格 Markdown").props.onChange({target:{value:"# Local draft"}});first.render();
  first.button("關閉").props.onClick();assert.equal(closed,1);first.unmount();
  const second=harness("PersonaEditor",{agent:{id:"a"},onClose(){}},{},async()=>({...original,markdown:"# Server edit",hash:"h2"}),globals);
  await second.effects();assert.equal(second.find("Agent 人格 Markdown").props.value,"# Local draft");
  assert.equal(second.find("最新已保存人格").props.value,"# Server edit");assert.equal(second.button("保存人格").props.disabled,true);
  assert.equal(second.calls.filter(call=>call.method==="POST").length,0);
  second.button("採用最新版本，捨棄我的修改").props.onClick();second.render();
  assert.equal(second.find("Agent 人格 Markdown").props.value,"# Server edit");assert.equal(storage.size,0);
});

test("an uncertain personality save preserves input and reconciles an already-written server copy",async()=>{
  let stored={agentId:"a",markdown:"# Before",hash:"before",configured:true},writes=0;
  const f=harness("PersonaEditor",{agent:{id:"a"},onClose(){}},{},async(path,body)=>{
    if(!body)return stored;
    if(writes++===0){stored={...stored,markdown:body.markdown,hash:"after"};throw new Error("response lost");}
    throw Object.assign(new Error("changed"),{status:409});
  });
  await f.effects();f.find("Agent 人格 Markdown").props.onChange({target:{value:"# My personality"}});f.render();
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});f.render();
  assert.match(f.text(),/保存未確認/);assert.equal(f.find("Agent 人格 Markdown").props.value,"# My personality");
  await f.find("編輯 Agent 人格").props.onSubmit({preventDefault(){}});f.render();
  assert.match(f.text(),/已核對伺服器版本/);assert.equal(f.find("人格版本衝突"),undefined);assert.equal(f.button("保存人格").props.disabled,true);
  assert.deepEqual(f.calls.filter(call=>call.method==="POST").map(call=>call.body.expectedHash),["before","before"]);
});

test("personality IME cannot submit and failed draft caching does not silently discard edits",async()=>{
  let closed=0;const f=harness("PersonaEditor",{agent:{id:"a"},onClose:()=>{closed++;}},{},async()=>({agentId:"a",markdown:"# Before",hash:"h",configured:true}));
  await f.effects();f.find("Agent 人格 Markdown").props.onChange({target:{value:"# Input"}});f.render();
  const form=f.find("編輯 Agent 人格");form.props.onCompositionStart();await form.props.onSubmit({preventDefault(){}});
  assert.equal(f.calls.filter(call=>call.method==="POST").length,0);form.props.onCompositionEnd();
  f.button("關閉").props.onClick();f.render();assert.equal(closed,0);assert.match(f.text(),/草稿暫存不可用/);
  f.button("返回編輯").props.onClick();f.render();assert.equal(f.find("Agent 人格 Markdown").props.value,"# Input");
});
