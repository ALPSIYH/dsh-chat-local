import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createGroupUI} from "../lib/group-ui.js";

const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(v=>v!==null&&v!==undefined&&v!==false)});
const nodes=tree=>{const found=[];const visit=v=>{if(v&&typeof v==="object"){found.push(v);v.children?.forEach(visit);}};visit(tree);return found;};
const content=node=>typeof node==="string"||typeof node==="number"?String(node):(node?.children??[]).map(content).join("");
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function fixture(component,props,respond=async()=>({members:[],defaultParticipantIds:[],environment:{cwd:"",overrides:{}},charter:"",autoDeliver:true,mode:"inherit_dsh"}),storage=new Map()){
  const state=[],dependencies=[],pending=[],cleanups=[],calls=[];let cursor=0,tree;
  const React={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==="function"?initial():initial;return [state[i],v=>{state[i]=typeof v==="function"?v(state[i]):v;}];},useRef(initial){const i=cursor++;return state[i]??(state[i]={current:initial});},useEffect(effect,deps){const i=cursor++;if(!dependencies[i]||deps?.some((v,n)=>v!==dependencies[i][n])){dependencies[i]=deps;pending.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}}};
  const api=async(path,options)=>{const body=options?.body?JSON.parse(options.body):undefined;calls.push({path,body,method:options?.method??"GET"});return respond(path,body,options);};
  const TeamUI={ParticipantPicker:function ParticipantPicker(){},DirectoryField:function DirectoryField(){}};
  const ui=vm.runInNewContext(`(${createGroupUI.toString()})(React,h,api,TeamUI)`,{React,h,api,TeamUI,crypto,structuredClone,Date,JSON,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  const render=next=>{if(next)props={...props,...next};cursor=0;tree=ui[component](props);while(pending.length)pending.shift()();return tree;};
  render();return {render,calls,TeamUI,storage,nodes:()=>nodes(tree),text:()=>content(tree),button(label){return nodes(tree).find(n=>n.type==="button"&&(n.props["aria-label"]===label||content(n)===label));},input(label){return nodes(tree).find(n=>n.props["aria-label"]===label&&["input","textarea","select"].includes(n.type));},unmount(){cleanups.forEach(c=>c?.());}};
}

test("group home keeps a legitimate empty group visible and separates group drafts from conversation drafts",()=>{
  const f=fixture("GroupHome",{groups:[{id:"empty",name:"空白團隊",conversationCount:0},{id:"old",name:"舊群組",archivedAt:1}],drafts:[{id:"g",kind:"group",title:"團隊草稿"},{id:"c",kind:"conversation",title:"對話草稿"}]});
  assert.ok(f.button("開啟群組：空白團隊"));
  assert.match(f.text(),/尚無對話/);
  assert.match(f.text(),/團隊草稿/);
  assert.doesNotMatch(content(f.nodes().find(n=>n.props["aria-label"]==="群組草稿")),/對話草稿/);
  assert.doesNotMatch(f.text(),/舊群組/);
  f.input("搜尋群組").props.onChange({target:{value:"空白"}});f.render();
  assert.ok(f.button("開啟群組：空白團隊"));
});

test("group home offers a temporary conversation without requiring a group or writing data",()=>{
  let opened=0;
  const f=fixture("GroupHome",{groups:[],drafts:[],onNewConversation:()=>{opened++;}});
  assert.match(f.text(),/不需先建立群組/);f.button("臨時對話").props.onClick();
  assert.equal(opened,1);assert.equal(f.calls.length,0);
});

test("conversation drafts have a separate collapsed section with ownership, previews and recovery links",()=>{
  let selected;
  const drafts=[{id:"group-draft",kind:"group",title:"組隊草稿"},{id:"normal",kind:"conversation",groupId:"g",title:"方法討論",text:"先核對識別假設",updatedAt:2},{id:"temporary",kind:"conversation",groupId:null,text:"臨時比對兩份材料",updatedAt:3},{id:"recover",kind:"conversation",title:"待核對話題",start:{operationId:"op"},updatedAt:1},{id:"discard",kind:"conversation",title:"已捨棄",discardedAt:1},{id:"started",kind:"conversation",title:"已開始",startedRoomId:"room"}];
  const f=fixture("GroupHome",{groups:[{id:"g",name:"研究群"}],drafts,onDraft:draft=>{selected=draft;}});
  const conversations=f.nodes().find(n=>n.type==="details"&&n.props["aria-label"]==="對話草稿");assert.ok(conversations);assert.notEqual(conversations.props.open,true);
  assert.match(content(conversations),/方法討論.*研究群.*先核對識別假設/);assert.match(content(conversations),/臨時對話/);assert.match(content(conversations),/開始結果待核對/);
  assert.doesNotMatch(content(conversations),/組隊草稿|已捨棄|已開始/);
  f.button("繼續對話草稿：臨時比對兩份材料").props.onClick();assert.equal(selected.id,"temporary");
  f.button("核對開始結果：待核對話題").props.onClick();assert.equal(selected.id,"recover");
});

test("group settings applies the shared picker without adding new members to future-topic preselection",async()=>{
  const group={id:"g",name:"研究群",revision:3},a={id:"a",alias:"文獻"},b={id:"b",alias:"方法"};
  const config={members:[a],defaultParticipantIds:["a"],environment:{cwd:"/research",overrides:{}},charter:"",autoDeliver:true,mode:"full_access"};
  let saved;
  const f=fixture("GroupSettings",{group,onSaved:value=>{saved=value;}},async(path,body)=>path==="/groups"?[group]:body?{...group,revision:4,defaults:{...body,defaultActionMode:body.mode}}:config);
  await settle();f.render();f.button("加入或調整成員").props.onClick();f.render();
  const picker=f.nodes().find(n=>n.type===f.TeamUI.ParticipantPicker);
  assert.equal(picker.props.target.kind,"group-members");
  picker.props.onApply([a,b]);f.render();
  assert.equal(f.input("預選文獻").props.checked,true);
  assert.equal(f.input("預選方法").props.checked,false);
  f.button("保存群組設定").props.onClick();await settle();f.render();
  const post=f.calls.find(c=>c.method==="POST");
  assert.deepEqual(post.body.defaultParticipantIds,["a"]);
  assert.equal(post.body.members.length,2);
  assert.equal(post.body.mode,"full_access");
  assert.equal(saved.revision,4);
  assert.match(f.text(),/不改既有對話/);
});

test("an uncertain settings save preserves input and retries the exact receipt instead of publishing twice",async()=>{
  const group={id:"g",name:"研究群",revision:3};let attempts=0;
  const f=fixture("GroupSettings",{group},async(path,body)=>{
    if(path==="/groups")return [group];
    if(!body)return {members:[],defaultParticipantIds:[],mode:"inherit_dsh"};
    if(++attempts===1)throw new Error("回覆中斷");
    return {...group,name:body.name,revision:4,defaults:body};
  });
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"保留的新名稱"}});f.render();
  f.button("保存群組設定").props.onClick();await settle();f.render();
  assert.equal(f.input("群組名稱").props.value,"保留的新名稱");
  assert.match(f.text(),/結果尚未確認/);
  f.button("核對並重試這次保存").props.onClick();await settle();f.render();
  const posts=f.calls.filter(c=>c.method==="POST");
  assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);
  assert.match(f.text(),/已保存/);
});

test("a revision conflict keeps edits and requires an explicit readable comparison before rebasing",async()=>{
  let group={id:"g",name:"研究群",revision:3},conflicted=false;
  const f=fixture("GroupSettings",{group},async(path,body)=>{
    if(path==="/groups")return [group];
    if(!body)return {members:[],defaultParticipantIds:[],charter:conflicted?"另一個視窗的章程":"舊章程",mode:"inherit_dsh"};
    if(!conflicted){conflicted=true;group={...group,name:"遠端名稱",revision:4};throw Object.assign(new Error("群組已在別處更新"),{status:409});}
    return {...group,name:body.name,revision:5,defaults:body};
  });
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"我的名稱"}});f.render();f.button("保存群組設定").props.onClick();await settle();f.render();
  assert.equal(f.input("群組名稱").props.value,"我的名稱");
  f.button("讀取最新版本並比較").props.onClick();await settle();f.render();
  assert.equal(f.input("群組名稱").props.value,"我的名稱");assert.match(f.text(),/遠端名稱/);assert.match(f.text(),/另一個視窗的章程/);
  f.button("採用最新版本，捨棄我的未保存修改").props.onClick();f.render();
  assert.equal(f.input("群組名稱").props.value,"遠端名稱");
  assert.equal(f.input("群組共同約定").props.value,"另一個視窗的章程");
  assert.equal(f.calls.filter(c=>c.method==="POST").length,1);
});

test("archiving is blocked by running or pending work and offers direct room navigation",async()=>{
  const group={id:"g",name:"研究群",revision:3};let opened;
  const f=fixture("GroupHome",{groups:[group],onOpenGroup:(...args)=>{opened=args;}},async path=>path==="/groups"?[group]:{running:[{id:"r",name:"進行中的審稿"}],pending:[{roomId:"r2",id:"entry",title:"等待交接"}],monitors:[]});
  f.button("收存群組：研究群").props.onClick();await settle();f.render();
  assert.match(f.text(),/仍有執行或待派送工作/);
  assert.equal(f.button("確認收存").props.disabled,true);
  f.button("查看對話：進行中的審稿").props.onClick();assert.deepEqual(opened,["g","r"]);
  assert.equal(f.calls.filter(call=>call.method==="POST").length,0);
});

test("archiving future monitors requires consent and an uncertain response reuses the original lifecycle receipt",async()=>{
  const group={id:"g",name:"研究群",revision:3};let attempts=0;
  const f=fixture("GroupHome",{groups:[group]},async(path,body)=>{
    if(path==="/groups")return [group];
    if(!body)return {running:[],pending:[],monitors:[{roomId:"r",id:"m",title:"週末核驗"}]};
    if(++attempts===1)throw new Error("connection lost");
    return {...group,revision:4,archivedAt:1};
  });
  f.button("收存群組：研究群").props.onClick();await settle();f.render();
  assert.match(f.text(),/週末核驗/);assert.equal(f.button("確認收存").props.disabled,true);
  f.input("確認暫停此群組的未來監測").props.onChange({target:{checked:true}});f.render();
  f.button("確認收存").props.onClick();await settle();f.render();
  assert.match(f.text(),/結果尚未確認/);f.button("核對並重試這次操作").props.onClick();await settle();f.render();
  const posts=f.calls.filter(call=>call.method==="POST");assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);assert.equal(posts[0].body.confirmPause,true);
  assert.equal(f.button("開啟群組：研究群"),undefined);f.button("已收存").props.onClick();f.render();assert.ok(f.button("開啟群組：研究群"));
});

test("pinning is one action and the recoverable group bin never resumes monitors or deletes native sessions",async()=>{
  let group={id:"g",name:"研究群",revision:1};
  const f=fixture("GroupHome",{groups:[group]},async(path,body)=>{
    if(path==="/groups")return [group];
    if(!body)return {running:[],pending:[],monitors:[]};
    group={...group,revision:group.revision+1};
    if(body.action==="pin")group.pinnedAt=1;
    if(body.action==="trash"){group.archivedAt=2;group.deletedAt=2;}
    if(body.action==="restore"){delete group.archivedAt;delete group.deletedAt;}
    return {...group};
  });
  f.button("置頂群組：研究群").props.onClick();await settle();f.render();
  assert.equal(f.calls.filter(c=>c.method==="POST").length,1);
  f.button("置頂").props.onClick();f.render();assert.ok(f.button("開啟群組：研究群"));
  f.button("移至回收區：研究群").props.onClick();await settle();f.render();
  assert.match(f.text(),/不刪文件或原生會話/);f.button("確認移至回收區").props.onClick();await settle();f.render();
  f.button("回收區").props.onClick();f.render();f.button("恢復群組：研究群").props.onClick();await settle();f.render();
  assert.match(f.text(),/不會重啟監測、排程或舊任務/);f.button("確認恢復群組").props.onClick();await settle();f.render();
  assert.ok(f.button("開啟群組：研究群"));
  assert.deepEqual(f.calls.filter(c=>c.method==="POST").map(c=>c.body.action),["pin","trash","restore"]);
  assert.ok(f.calls.every(call=>!call.path.includes("session")));
});

test("deselecting a group member removes only that member and their preselection while directory overrides remain explicit",async()=>{
  const group={id:"g",name:"研究群",revision:3},a={id:"a",alias:"文獻",enabled:true},b={id:"b",alias:"方法",enabled:true};
  const f=fixture("GroupSettings",{group},async path=>path==="/groups"?[group]:{members:[a,b],defaultParticipantIds:["a","b"],environment:{cwd:"/group",overrides:{a:"/a",b:"/b"},presetOverrides:{a:"reader",b:"writer"}},mode:"inherit_dsh"});
  await settle();f.render();assert.match(f.text(),/文獻：\/a/);assert.match(f.text(),/方法：\/b/);
  f.button("加入或調整成員").props.onClick();f.render();f.nodes().find(n=>n.type===f.TeamUI.ParticipantPicker).props.onApply([{...a,enabled:false},b]);f.render();
  assert.equal(f.input("預選文獻"),undefined);assert.equal(f.input("預選方法").props.checked,true);
  assert.doesNotMatch(f.text(),/文獻：\/a/);
  f.button("全部成員改用群組目錄").props.onClick();f.render();assert.doesNotMatch(f.text(),/方法：\/b/);
});

test("a late settings response cannot overwrite or navigate a different group's settings",async()=>{
  const first={id:"g1",name:"第一群",revision:1},second={id:"g2",name:"第二群",revision:1};let release,saved=0;
  const delayed=new Promise(resolve=>{release=resolve;});
  const f=fixture("GroupSettings",{group:first,onSaved:()=>{saved++;}},async(path,body)=>path==="/groups"?[first,second]:body?delayed:{members:[],defaultParticipantIds:[],mode:"inherit_dsh"});
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"修改第一群"}});f.render();f.button("保存群組設定").props.onClick();await settle();
  f.render({group:second});await settle();f.render();assert.equal(f.input("群組名稱").props.value,"第二群");
  release({...first,name:"修改第一群",revision:2,defaults:{members:[],defaultParticipantIds:[]}});await settle();f.render();
  assert.equal(f.input("群組名稱").props.value,"第二群");assert.equal(saved,0);
});

test("leaving modified group settings requires an explicit discard and cancel keeps the entered text",async()=>{
  const group={id:"g",name:"研究群",revision:1};let closed=0;
  const f=fixture("GroupSettings",{group,onClose:()=>{closed++;}},async path=>path==="/groups"?[group]:{members:[],defaultParticipantIds:[],mode:"inherit_dsh"});
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"還沒保存"}});f.render();
  f.button("返回").props.onClick();f.render();assert.equal(closed,0);f.button("繼續編輯").props.onClick();f.render();assert.equal(f.input("群組名稱").props.value,"還沒保存");
  f.button("返回").props.onClick();f.render();f.button("返回並捨棄未保存修改").props.onClick();assert.equal(closed,1);
  assert.equal(f.calls.filter(c=>c.method==="POST").length,0);
});

test("group settings reload restores an uncertain save with its original revision and operation body",async()=>{
  const group={id:"g",name:"研究群",revision:1};let attempts=0;
  const respond=async(path,body)=>{if(path==="/groups")return [group];if(!body)return {members:[],defaultParticipantIds:[],mode:"inherit_dsh"};if(++attempts===1)throw new Error("lost response");return {...group,name:body.name,revision:2,defaults:body};};
  const f=fixture("GroupSettings",{group},respond);await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"待核對名稱"}});f.render();f.button("保存群組設定").props.onClick();await settle();f.render();
  const original=f.calls.find(call=>call.method==="POST").body;
  assert.ok(f.storage.has("dcl:group-settings:g"));f.unmount();
  const reopened=fixture("GroupSettings",{group},respond,f.storage);await settle();reopened.render();assert.equal(reopened.input("群組名稱").props.value,"待核對名稱");
  reopened.button("核對並重試這次保存").props.onClick();await settle();reopened.render();assert.deepEqual(reopened.calls.find(call=>call.method==="POST").body,original);
  assert.equal(f.storage.has("dcl:group-settings:g"),false);
});

test("group lifecycle reload preserves the original target and receipt until confirmed success",async()=>{
  const group={id:"g",name:"研究群",revision:1};let attempts=0;
  const respond=async(path,body)=>{if(path==="/groups")return [group];if(!body)return {running:[],pending:[],monitors:[]};if(++attempts===1)throw new Error("lost lifecycle response");return {...group,revision:2,archivedAt:1};};
  const f=fixture("GroupHome",{groups:[group]},respond);f.button("收存群組：研究群").props.onClick();await settle();f.render();f.button("確認收存").props.onClick();await settle();f.render();
  const original=f.calls.find(call=>call.method==="POST").body;assert.ok(f.storage.has("dcl:group-lifecycle:pending"));f.unmount();
  const reopened=fixture("GroupHome",{groups:[group]},respond,f.storage);reopened.button("核對並重試這次操作").props.onClick();await settle();reopened.render();
  assert.deepEqual(reopened.calls.find(call=>call.method==="POST").body,original);assert.equal(f.storage.has("dcl:group-lifecycle:pending"),false);
});

test("unsaved local settings survive navigation and a newer server revision is shown without overwriting input",async()=>{
  let group={id:"g",name:"原名稱",revision:1};
  const respond=async path=>path==="/groups"?[group]:{members:[],defaultParticipantIds:[],mode:"inherit_dsh"};
  const f=fixture("GroupSettings",{group},respond);await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"本機輸入"}});f.render();f.unmount();
  group={...group,name:"遠端新名稱",revision:2};const reopened=fixture("GroupSettings",{group},respond,f.storage);await settle();reopened.render();
  assert.equal(reopened.input("群組名稱").props.value,"本機輸入");assert.match(reopened.text(),/遠端新名稱/);assert.equal(reopened.button("保存群組設定").props.disabled,true);
  reopened.button("採用最新版本，捨棄我的未保存修改").props.onClick();reopened.render();assert.equal(f.storage.has("dcl:group-settings:g"),false);
});

test("unavailable browser storage is reported honestly and does not claim unsaved settings were cached",async()=>{
  class UnavailableStorage extends Map{set(){throw new Error("quota");}}
  const group={id:"g",name:"研究群",revision:1};const f=fixture("GroupSettings",{group},async path=>path==="/groups"?[group]:{members:[],defaultParticipantIds:[]},new UnavailableStorage());
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"尚在此頁"}});f.render();
  assert.equal(f.input("群組名稱").props.value,"尚在此頁");assert.match(f.text(),/本機暫存不可用/);assert.doesNotMatch(f.text(),/已暫存在本機/);
});

test("an uncertain settings save later rejected as a conflict unlocks comparison instead of staying frozen",async()=>{
  let group={id:"g",name:"研究群",revision:1},attempts=0;
  const f=fixture("GroupSettings",{group},async(path,body)=>{if(path==="/groups")return [group];if(!body)return {members:[],defaultParticipantIds:[]};if(++attempts===1)throw new Error("network");group={...group,revision:2};throw Object.assign(new Error("conflict"),{status:409});});
  await settle();f.render();f.input("群組名稱").props.onChange({target:{value:"本機名稱"}});f.render();f.button("保存群組設定").props.onClick();await settle();f.render();f.button("核對並重試這次保存").props.onClick();await settle();f.render();
  assert.equal(f.button("核對並重試這次保存"),undefined);assert.ok(f.button("讀取最新版本並比較"));assert.equal(f.nodes().find(n=>n.type==="fieldset").props.disabled,false);
});
