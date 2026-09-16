import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {workProtocol} from "../lib/work-protocol.js";

const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
const helpers=source.slice(source.indexOf("    function DecisionChoices("),source.indexOf("    function LedgerCard("));
const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
const nodes=tree=>tree&&typeof tree==="object"?[tree,...(tree.children??[]).flatMap(nodes)]:[];
const text=tree=>typeof tree==="string"?tree:(tree?.children??[]).map(text).join("");

test("actual multi-relation editor preserves all other selected links when one changes",()=>{
  let selected=["a","b","c"];
  const context=vm.createContext({h,ledgerKindLabel:kind=>kind,props:{entries:["a","b","c","d"].map(id=>({id,kind:"task",title:id})),selected,onChange:next=>{selected=Array.from(next);}}});
  const tree=vm.runInContext(`${helpers}\nLedgerRelationsEditor(props)`,context);
  nodes(tree).filter(node=>node.type==="input")[3].props.onChange({target:{checked:true}});
  assert.deepEqual(selected,["a","b","c","d"]);
  nodes(tree).filter(node=>node.type==="input")[1].props.onChange({target:{checked:false}});
  assert.deepEqual(selected,["a","c"]);
});

test("recovery panel acknowledges a saved handoff even when the next list refresh fails",async()=>{
  const state=[],calls=[];let cursor=0;
  const React={Fragment:"fragment",useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=initial;return[state[slot],value=>state[slot]=typeof value==="function"?value(state[slot]):value];},useRef(initial){const slot=cursor++;return state[slot]??(state[slot]={current:initial});},useEffect(){}};
  const report={checkedAt:Date.now(),files:[],unresolvedEntryIds:[],canRetry:true,limitation:"只读检查"};
  const props={roomId:"r",entry:{id:"a",kind:"task",status:"open",revision:2},related:[],async onRefresh(){throw new Error("refresh offline");}};
  const api=async(path,options)=>{calls.push({path,options});return options?{id:"a",handoff:{state:"waiting_report"}}:report;};
  const context=vm.createContext({h,React,props,api,workProtocol,crypto:{randomUUID},ledgerStatusLabel:x=>x});vm.runInContext(helpers,context);
  const render=()=>{cursor=0;return vm.runInContext("RecoveryPanel(props)",context);};
  nodes(render()).find(node=>node.type==="button"&&text(node)==="通知负责人开始").props.onClick();
  for(let count=0;count<50&&!text(render()).includes("操作已保存");count++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls.filter(call=>call.options?.method==="POST").length,1);
  assert.match(text(render()),/接手请求已保存/);assert.match(text(render()),/操作已保存，但列表刷新失败/);
  const sent=JSON.parse(calls[0].options.body);assert.equal(sent.expectedRevision,2);assert.ok(sent.operationId);assert.equal(sent.note,"");
});

test("shared work protocol distinguishes blocked, queued, missing-report and reviewed outcomes",()=>{
  const members=new Set(["owner","reviewer"]),entry={kind:"task",status:"blocked",ownerSessionId:"owner"};
  assert.equal(workProtocol.needsUser(entry,members),true);
  assert.equal(workProtocol.needsUser({...entry,handoff:{state:"queued"}},members),false);
  assert.equal(workProtocol.needsUser({...entry,handoff:{state:"needs_report"}},members),true);
  assert.equal(workProtocol.needsUser({...entry,handoff:{state:"reported"}},members),true);
  assert.equal(workProtocol.needsUser({...entry,status:"done",handoff:{state:"reported"}},members),false);
  assert.equal(workProtocol.needsUser({...entry,ownerSessionId:"gone",handoff:{state:"queued"}},members),true);
});

test("ignore and archive confirmations accept an empty explanation and retry with the same operation id",async()=>{
  for(const action of ["dismiss_blocker","archive"]){
    const state=[],calls=[],saved=[];let cursor=0;
    const React={Fragment:"fragment",useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=initial;return[state[slot],value=>state[slot]=value];},useRef(initial){const slot=cursor++;return state[slot]??(state[slot]={current:initial});}};
    const props={roomId:"r",entry:{id:"a",title:"过时问题",status:"blocked",revision:3},action,onSaved:item=>saved.push(item)};
    const api=async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});if(calls.length===1)throw new Error("uncertain response");return{id:"a",status:action==="archive"?"archived":"open"};};
    const context=vm.createContext({h,React,props,api,crypto:{randomUUID}});vm.runInContext(helpers,context);
    const render=()=>{cursor=0;return vm.runInContext("LedgerTriagePanel(props)",context);};
    const confirm=()=>nodes(render()).find(node=>node.type==="button"&&text(node).startsWith("确认"));
    assert.equal(confirm().props.disabled,false);confirm().props.onClick();
    for(let n=0;n<30&&!text(render()).includes("uncertain response");n++)await new Promise(resolve=>setTimeout(resolve,5));
    confirm().props.onClick();for(let n=0;n<30&&!saved.length;n++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(saved.length,1);assert.deepEqual(calls[0].body,calls[1].body);assert.equal(calls[1].body.note,"");assert.equal(calls[1].body.expectedRevision,3);
  }
});

test("the recovery panel exposes ignore and remove independently of failed preflight",()=>{
  const selected=[];
  const React={Fragment:"fragment",useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial}),useEffect(){}};
  const props={roomId:"r",entry:{id:"a",title:"旧阻断",status:"blocked"},related:[],onTriage:(entry,action)=>selected.push(action)};
  const context=vm.createContext({h,React,props,workProtocol,ledgerStatusLabel:x=>x});
  const tree=vm.runInContext(`${helpers}\nRecoveryPanel(props)`,context);
  for(const label of ["忽略此旧阻断…","移除事项…"]){const button=nodes(tree).find(node=>node.type==="button"&&text(node)===label);assert.equal(button.props.disabled,false);button.props.onClick();}
  assert.deepEqual(selected,["dismiss_blocker","archive"]);
});

test("a delivered task folds its earlier failure report as history, not a current blocker",()=>{
  const card=source.slice(source.indexOf("    function LedgerCard("),source.indexOf("    function localDateTimeValue("));
  const entry={id:"a",kind:"task",title:"审阅",status:"in_review",progress:{summary:"旧权限报错",at:1000,actor:"s1"},submission:{summary:"已读取并提交",at:2000,actor:"s1"}};
  const context=vm.createContext({h,React:{Fragment:"fragment"},HUMAN_ID:"human:me",props:{entry,members:new Map()},ledgerOrphanRoles:()=>[],closedLedgerStatus:workProtocol.closed,ledgerKindLabel:x=>x,ledgerStatusLabel:x=>x,ledgerStatusOptions:()=>[],LedgerSources:()=>null});
  vm.runInContext(card,context);
  const tree=vm.runInContext("LedgerCard(props)",context);
  const flat=nodes(tree),actions=flat.findIndex(node=>node.props?.className==="dclLedgerActions");
  const submission=flat.findIndex(node=>node.type==="details"&&text(node).includes("阅读完整交付"));
  assert.ok(actions>=0&&submission>actions,"Task actions must precede the folded full submission");
  const historical=nodes(tree).find(node=>node.type==="details"&&node.children[0]?.type==="summary"&&text(node.children[0]).includes("历史进展"));
  assert.ok(historical);assert.equal(historical.props.open,undefined);assert.ok(!text(tree).includes("最近报告"));
  entry.status="blocked";
  assert.ok(text(vm.runInContext("LedgerCard(props)",context)).includes("最近报告"));
});
