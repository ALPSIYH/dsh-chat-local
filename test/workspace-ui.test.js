import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createWorkspaceComposer} from "../lib/workspace-ui.js";
import {readFile} from "node:fs/promises";

const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(value=>value!==null&&value!==undefined)});
const nodes=tree=>{const result=[];const visit=value=>{if(value&&typeof value==="object"){result.push(value);value.children?.forEach(visit);}};visit(tree);return result;};
const base={id:"draft",kind:"conversation",revision:1,members:[],environment:{cwd:"",overrides:{}},title:"",text:"A",charter:"",mode:"read_only_audit",autoDeliver:true};
function harness({initial=base,local=null,respond}={}){
  const values=[],effects=[],calls=[],storage=new Map(local?[["dcl:workspace-draft:draft",JSON.stringify(local)]]:[]);let index=0,tree,closed=0,completed=0;
  const React={useRef(value){const i=index++;return values[i]??(values[i]={current:value});},useState(value){const i=index++;if(!(i in values))values[i]=typeof value==="function"?value():value;return [values[i],next=>{values[i]=typeof next==="function"?next(values[i]):next;}];},useEffect(fn){effects.push(fn);}};
  const api=async(path,options)=>{const body=options?.body&&JSON.parse(options.body);calls.push({path,body});return respond?respond(path,body):{...initial,...body,revision:2};};
  const ctx={remote:{session:{modelCatalog:async()=>({ok:true,value:{groups:[]}})}}};
  const Component=vm.runInNewContext(`(${createWorkspaceComposer.toString()})(React,h,api,ctx)`,{React,h,api,ctx,crypto,structuredClone,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setTimeout:()=>1,clearTimeout(){}});
  const render=()=>{index=0;tree=Component({initial:structuredClone(initial),rosters:[],onClose(){closed++;},onComplete(){completed++;}});return tree;};
  render();return {render,nodes:()=>nodes(tree),calls,storage,effects,get closed(){return closed;},get completed(){return completed;}};
}
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const button=(fixture,text)=>fixture.nodes().find(node=>node.type==="button"&&node.children.includes(text));
const textInput=fixture=>fixture.nodes().find(node=>node.type==="textarea"&&node.props.className.includes("dclStartText"));

test("draft reopens newer local typing after a saved-response loss by matching the operation receipt",()=>{
  const f=harness({initial:{...base,revision:2,lastSave:{operationId:"save-A"}},local:{data:{...base,text:"AB"},revision:1,change:2,saved:0,pending:{version:1,body:{operationId:"save-A"}}}});
  assert.equal(textInput(f).props.value,"AB");assert.ok(!button(f,"明确使用服务器版本"));
});

test("divergent local typing without a pending request stays visible with an explicit conflict choice",()=>{
  const f=harness({initial:{...base,revision:2,text:"server"},local:{data:{...base,text:"local"},revision:1,change:1,saved:0,pending:null}});
  assert.equal(textInput(f).props.value,"local");assert.ok(button(f,"明确使用服务器版本"));
});

test("a rejected validation payload can be replaced with corrected input instead of being resent forever",async()=>{
  const f=harness({respond:async(path,body)=>{if(body.environment.cwd==="~/bad")throw Object.assign(new Error("validation"),{status:400});return {...base,...body,revision:2};}});
  const cwd=()=>f.nodes().find(node=>node.type==="input"&&node.props.placeholder==="选择一个已有工作目录的完整路径");
  cwd().props.onChange({target:{value:"~/bad"}});f.render();button(f,"返回 · 保留草稿").props.onClick();await settle();f.render();assert.equal(f.closed,0);
  cwd().props.onChange({target:{value:"/valid"}});f.render();button(f,"返回 · 保留草稿").props.onClick();await settle();
  assert.deepEqual(f.calls.map(call=>call.body.environment.cwd),["~/bad","/valid"]);assert.equal(f.closed,1);
});

test("unknown save outcomes reuse the exact operation before saving later edits",async()=>{
  let first=true;const f=harness({respond:async(path,body)=>{if(first){first=false;throw new Error("connection lost");}return {...base,...body,revision:body.expectedRevision+1};}});
  textInput(f).props.onChange({target:{value:"A1"}});f.render();button(f,"返回 · 保留草稿").props.onClick();await settle();f.render();textInput(f).props.onChange({target:{value:"A2"}});f.render();button(f,"返回 · 保留草稿").props.onClick();await settle();
  assert.equal(f.calls[0].body.operationId,f.calls[1].body.operationId);assert.equal(f.calls[1].body.text,"A1");assert.equal(f.calls[2].body.text,"A2");assert.equal(f.closed,1);
});

test("finishing after unmount cannot steal navigation back from another conversation",async()=>{
  let release,entered;const reached=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>release=resolve);
  const f=harness({respond:async()=>{entered();await pending;return {state:"note_saved",room:{id:"room"}};}});
  const cleanups=f.effects.slice(0,3).map(effect=>effect());button(f,"保存笔记").props.onClick();await reached;for(const cleanup of cleanups)if(typeof cleanup==="function")cleanup();release();await settle();assert.equal(f.completed,0);
});

test("discarding does not try to save invalid unwanted configuration first",async()=>{
  const f=harness({respond:async(path,body)=>path==="/workspace"?{drafts:[base]}:{discarded:true}});
  const cwd=f.nodes().find(node=>node.type==="input"&&node.props.placeholder==="选择一个已有工作目录的完整路径");cwd.props.onChange({target:{value:"~/invalid"}});f.render();button(f,"捨弃草稿").props.onClick();f.render();button(f,"确认舍弃").props.onClick();await settle();
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].path,"/workspace");assert.deepEqual(f.calls[1].body,{expectedRevision:1});assert.equal(f.closed,1);
});

test("native catalog access declares both remote service and its session namespace",async()=>{
  const client=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");const inject=client.match(/const inject = \[(.*?)\]/u)[1];assert.match(inject,/"remote"/u);assert.match(inject,/"remote.session"/u);
});

test("discard cannot delete an unseen newer revision when both receipts are absent",async()=>{
  const f=harness({respond:async()=>({drafts:[{...base,revision:2,text:"another window"}]})});button(f,"捨弃草稿").props.onClick();f.render();button(f,"确认舍弃").props.onClick();await settle();f.render();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,"/workspace");assert.equal(f.closed,0);assert.match(JSON.stringify(f.nodes()),/别处已更新/);
});

test("management dialog leaves focus ownership to the workspace and restores its invoker",async()=>{
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const panel=source.slice(source.indexOf("function ManagementPanel("),source.indexOf("function ManagementPanel(")+2000);
  assert.doesNotMatch(panel,/root\.current\?\.focus\(/u);
  const begin=source.indexOf("          const previous=document.activeElement;",source.indexOf("if(!(pendingRemoval"));
  const end=source.indexOf("\n        }, [Boolean(pendingRemoval)",begin);
  const document={activeElement:null};
  const trigger={isConnected:true,focus(){document.activeElement=this;}};
  const control={getClientRects:()=>[{}],focus(){document.activeElement=this;}};
  const background={inert:false,contains:()=>false};
  const modal={contains:element=>element===control,querySelector:()=>null,querySelectorAll:()=>[control],addEventListener(){},removeEventListener(){}};
  const workspaceRef={current:{querySelector:()=>modal,querySelectorAll:()=>[background]}};
  document.activeElement=trigger;
  const cleanup=vm.runInNewContext(`(()=>{${source.slice(begin,end)}})()`,{document,workspaceRef});
  assert.equal(document.activeElement,control);assert.equal(background.inert,true);
  cleanup();assert.equal(document.activeElement,trigger);assert.equal(background.inert,false);
});

test("the actual draft shell renders both group and conversation views with the DSH exit callback",async()=>{
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const start=source.indexOf('workspaceDraft?h("main"');
  const end=source.indexOf('\n          h("main", { className: "dclMain",style:workspaceDraft?',start);
  const expression=source.slice(start,end).trim().replace(/,$/u,"");
  let exited=0;
  for(const kind of ["group","conversation"]){
    const tree=vm.runInNewContext(expression,{h,workspaceDraft:{id:"draft",kind},props:{onClose(){exited++;}},lineIcon:()=>null,roomSidebarOpen:true,setRoomSidebarOpen(){},groups:[],WorkspaceComposer:"composer",workspaceRequest:{current:1},workspaceData:{rosters:[]},closeWorkspace(){},completeWorkspace(){},setWorkspaceData(){}});
    const exit=nodes(tree).find(node=>node.props["aria-label"]==="返回 DSH 主页面");
    assert.equal(typeof exit.props.onClick,"function");exit.props.onClick();
  }
  assert.equal(exited,2);
});
