// Isolated browser fixture. It intentionally cannot create or run native Sessions.
// Start: node scripts/ui-fixture.mjs
import {createServer} from "node:http";
import {mkdtemp,mkdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {DshChatLocalService} from "../lib/room-store.js";
import {apply as installActualHttpHandler} from "../lib/index.js";

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const host="127.0.0.1",port=3081;
const fixtureRoot=await mkdtemp(join(tmpdir(),"dcl-ui-fixture-"));
const workspace=join(fixtureRoot,"workspace"),statePath=join(fixtureRoot,"rooms.json");
await mkdir(join(workspace,"papers"),{recursive:true});
await mkdir(join(workspace,"notes"),{recursive:true});
const selection={provider:"fixture",model:"model-a"};
const catalog={groups:[{id:"fixture",name:"測試來源",models:[{id:"model-a",name:"測試模型 A",reasoning:{defaultEffort:"medium",efforts:[{id:"low",name:"低"},{id:"medium",name:"中"},{id:"high",name:"高"}]}},{id:"model-b",name:"測試模型 B"}]}],default:selection};
const counters={nativeCreateAttempts:0,nativeMutationAttempts:0,modelExecutionAttempts:0,deliveryAttempts:0};
const deny=(key,label)=>()=>{counters[key]++;throw new Error(`隔離測試：${label}已停用；未接觸真實 DSH。`);};
const nativeIds=["fixture-native-research","fixture-native-writing"];
const nativeSummaries={
  [nativeIds[0]]:{id:nativeIds[0],displayTitle:"測試原生會話 · 研究",cwd:workspace},
  [nativeIds[1]]:{id:nativeIds[1],displayTitle:"測試原生會話 · 寫作",cwd:workspace}
};
const backendCtx={
  get(name){return this[name];},
  sessions:{get(){return undefined;}},sessionTitle:{get(){return undefined;}},agents:{get(){return undefined;}},
  sessionQuery:{
    async observeSession(sessionId){
      if(!nativeIds.includes(sessionId))throw new Error("隔離測試中不存在這段原生會話");
      return {header:{id:sessionId,cwd:workspace},projections:{values:{modelSelection:{next:structuredClone(selection)},permissions:{currentValue:"read-only"}}},[Symbol.dispose](){}};
    },
    async readTitleSnapshot(sessionId){return nativeSummaries[sessionId]?{session:{id:sessionId,cwd:workspace},title:nativeSummaries[sessionId].displayTitle}:undefined;}
  },
  agentDefaultModel:{currentSelection(){return structuredClone(selection);},saveSelection:deny("nativeMutationAttempts","全局模型變更")},
  llm:{async resolveCallConfig(value){if(value?.provider!=="fixture"||!["model-a","model-b"].includes(value.model))throw new Error("所選測試模型不存在");return structuredClone(value);},call:deny("modelExecutionAttempts","模型執行"),stream:deny("modelExecutionAttempts","模型執行")},
  sessionController:{create:deny("nativeCreateAttempts","原生 Session 建立"),async resolveAgent(){return {error:{message:"隔離測試不載入原生 Agent"}};},rename:deny("nativeMutationAttempts","原生重新命名"),agents:{selectForNextRequest:deny("nativeMutationAttempts","原生模型變更")}},
  permissionPresets:{resolve(preset){return {sandbox:preset,approval:preset==="danger-full-access"?"never":"ask"};},current(){return "read-only";},set:deny("nativeMutationAttempts","原生權限變更")},
  dshBridge:{async status(){return {state:"idle"};},deliverExternal:deny("deliveryAttempts","原生派送")}
};

// Only fixture-owned data is created. A second actual service loads it after seed.close().
const seed=new DshChatLocalService(backendCtx,{path:statePath});
await seed.ready;
await seed.directory.save({operationId:"fixture-agent-method",profile:{alias:"方法顧問",role:"研究設計",mandate:"辨識問題與核驗方法",model:selection}});
await seed.directory.save({operationId:"fixture-agent-engineer",profile:{alias:"工程顧問",role:"工程與測試",mandate:"驗證功能與失敗恢復",model:{provider:"fixture",model:"model-b"}}});
const names=["協調組","審查組","校閱組","方法組","寫作組","編輯組"];
const members=names.map((alias,index)=>({id:`fixture-member-${index+1}`,alias,role:index?"獨立審查":"協調與整理",mandate:"僅供隔離 UI 測試",model:selection,enabled:true}));
let group=await seed.workspace.createGroup({operationId:"fixture-team",name:"示例研究小組",members,environment:{cwd:workspace},mode:"read_only_audit",autoDeliver:true,charter:"這是獨立測試資料，不含真實群聊內容。"});
group=await seed.workspace.updateGroup(group.id,{expectedRevision:group.revision,operationId:"fixture-defaults",defaultParticipantIds:members.slice(0,2).map(member=>member.id)});
const room=await seed.createConversation(group.id,{operationId:"fixture-existing-topic",title:"既有對話 · 工作流程驗證",configuration:{members:group.defaults.members,environment:{cwd:workspace},mode:"read_only_audit",autoDeliver:false,charter:group.defaults.charter}});
await seed.send({roomId:room.id,author:"human:me",authorKind:"human",text:"此對話只供隔離介面驗證。可以調整參與者、建立群組與 Agent；原生 Session、模型執行與真實檔案操作皆已停用。",automaticDelivery:false});
let draft=await seed.workspace.openDraft({kind:"group",another:true});
draft=await seed.workspace.saveDraft(draft.id,{expectedRevision:draft.revision,operationId:"fixture-kept-draft",title:"保留中的團隊草稿",members:group.defaults.members.map((member,index)=>({...member,enabled:index<2})),environment:{cwd:workspace}});
await seed.close();

const disposers=[];
let actualHandler;
backendCtx.effect=effect=>{const dispose=effect();if(typeof dispose==="function")disposers.push(dispose);return dispose;};
backendCtx.on=()=>()=>{};
backendCtx.tools={guard(){return ()=>{};},register(){return ()=>{};}};
backendCtx.webServer={register(route){actualHandler=route.handler;return ()=>{};}};
installActualHttpHandler(backendCtx,{path:statePath,replyTimeoutMs:300,monitorIntervalMs:30_000});
if(!actualHandler)throw new Error("Actual plugin HTTP handler was not registered");

// React is not a dependency of this plugin — the fixture borrows the host's
// bundled copy. Point DSH_MODULES_DIR at the DSH install's node_modules when it
// is not resolvable from here.
function resolveDshModulesDir(){
  if(process.env.DSH_MODULES_DIR)return process.env.DSH_MODULES_DIR;
  const require=createRequire(import.meta.url);
  try{return join(dirname(require.resolve("@deepseek-ai/dsh/package.json")),"node_modules");}catch{}
  throw new Error("找不到 DSH 的安装位置；请设置 DSH_MODULES_DIR 指向 DSH 包内的 node_modules 目录");
}
const dshModules=resolveDshModulesDir();
const trajectoryModules=join(dshModules,"@deepseek-ai/dsh-client-ui-trajectory/node_modules");
const moduleFiles={
  react:join(trajectoryModules,"react/cjs/react.production.js"),
  "react-dom":join(trajectoryModules,"react-dom/cjs/react-dom.production.js"),
  scheduler:join(dshModules,"scheduler/cjs/scheduler.production.js"),
  "react-dom/client":join(trajectoryModules,"react-dom/cjs/react-dom-client.production.js")
};
const sources=await Promise.all(Object.entries(moduleFiles).map(async([id,path])=>({id,path,text:await readFile(path,"utf8")})));
for(const module of sources){
  for(const match of module.text.matchAll(/require\(["']([^"']+)["']\)/g))if(!moduleFiles[match[1]])throw new Error(`Unbundled production dependency ${match[1]} in ${module.path}`);
}
const vendor=`(function(){const definitions=Object.create(null),cache=Object.create(null);\n${sources.map(module=>`definitions[${JSON.stringify(module.id)}]=function(module,exports,require){\n${module.text}\n};`).join("\n")}\nwindow.__fixtureRequire=function require(id){if(cache[id])return cache[id].exports;if(!definitions[id])throw new Error('Unbundled fixture dependency: '+id);const module={exports:{}};cache[id]=module;definitions[id](module,module.exports,require);return module.exports;};})();`;

function browserBootstrap(config){
  const React=window.__fixtureRequire("react"),ReactDOM=window.__fixtureRequire("react-dom/client");
  const h=React.createElement,footerRoot=ReactDOM.createRoot(document.getElementById("fixture-footer"));
  const workbenchHost=document.getElementById("fixture-workbench"),native=document.getElementById("fixture-native-center");
  const records=[],snapshot={ids:config.nativeIds,byId:config.nativeSummaries,current:config.nativeIds[0]};
  window.__fixtureUiErrors=records;
  const record=error=>{records.push(String(error?.message??error));const box=document.getElementById("fixture-errors");box.hidden=false;box.textContent=records.join("\n");};
  window.addEventListener("error",event=>record(event.error??event.message));
  window.addEventListener("unhandledrejection",event=>record(event.reason));
  const forbidden=label=>{throw new Error(`隔離 UI fixture：${label}未接線到真實 DSH`);};
  const stableModelState={status:"ready",groups:config.catalog.groups,current:config.catalog.default};
  const directory={store:{getSnapshot:()=>stableModelState,subscribe:()=>()=>{}},load:async()=>stableModelState};
  const ctx={
    get(name){return this[name];},
    slots:{
      inject(_name,callback){return callback();},
      register(spec,Component){
        if(spec.name==="sidebar.footer.action"){footerRoot.render(h(Component));return ()=>footerRoot.render(null);}
        if(spec.name!=="conversation")throw new Error(`Unexpected fixture slot ${spec.name}`);
        native.hidden=true;workbenchHost.hidden=false;
        const root=ReactDOM.createRoot(workbenchHost,{onUncaughtError:record,onCaughtError:record});root.render(h(Component));
        return ()=>{root.unmount();workbenchHost.hidden=true;native.hidden=false;};
      }
    },
    sessions:{list:{getSnapshot:()=>snapshot,subscribe:()=>()=>{}},subagentAddress:()=>undefined,open:async()=>forbidden("開啟原生會話"),create:async()=>forbidden("建立原生會話"),binding:()=>({session:{rename:async()=>forbidden("重新命名原生會話")}})},
    modelDirectories:{directoryFor:()=>directory},
    remote:{session:{modelCatalog:async()=>({ok:true,value:config.catalog})},directoryPicker:{capabilities:async()=>({kind:"browse"})}},
    uiWorkspace:{
      async listDirectory(path){
        const current=path||config.workspace;
        if(![config.workspace,config.workspace+"/papers",config.workspace+"/notes"].includes(current))throw new Error("測試選擇器只提供隔離工作目錄");
        return {path:current,crumbs:[{name:"隔離工作區",path:config.workspace},...(current===config.workspace?[]:[{name:current.split("/").at(-1),path:current}])],entries:current===config.workspace?[{name:"papers",path:current+"/papers",hidden:false},{name:"notes",path:current+"/notes",hidden:false}]:[],truncated:false};
      },
      async pickDirectory(){return null;}
    }
  };
  window.__fixture={ctx,config,React,ReactDOM,errors:records};
  window.__ModuleLoader__={load(definition){const plugin=definition.factory(name=>{if(name!=="react")throw new Error(`Unexpected plugin require ${name}`);return React;});window.__fixture.plugin=plugin;plugin.apply(ctx);}};
}

const bootstrap=`(${browserBootstrap.toString()})(${JSON.stringify({workspace,catalog,nativeIds,nativeSummaries})});`;
const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 群聊 · 隔離 UI 驗證</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24262c;background:#f6f7f9;--dsw-alias-bg-base:#f7f8fa;--dsw-alias-bg-layer-1:#fff;--dsw-alias-label-primary:#24262c;--dsw-alias-label-secondary:#60656f;--dsw-alias-label-tertiary:#717884;--dsw-alias-border-l2:#e2e5e9;--dsw-alias-border-l1:#cbd0d8;--dsw-alias-color-primary:#5368ad;--dsw-alias-interactive-bg-hover:#f0f2f6;--dsw-alias-interactive-bg-active:#e9edf5;}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}button,input,select,textarea{font:inherit}button{cursor:pointer}[hidden]{display:none!important}.fixture_frame{display:grid;grid-template-columns:214px minmax(0,1fr);height:100vh}.fixture_sidebarCol{display:flex;flex-direction:column;border-right:1px solid #e2e5e9;padding:20px 12px;gap:12px;background:#f7f8fa}.fixture_sidebarCol strong{padding:8px;font-size:15px}.fixture_nav{padding:9px;font-size:13px;color:#68717c}.fixture_centerCol{min-width:0;min-height:0;height:100%;position:relative}.fixture_native{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px}.fixture_native h1{font-size:27px;letter-spacing:-.04em;font-weight:600}.fixture_native p{max-width:580px;color:#68717c;font-size:14px;line-height:1.8}.fixture_tag{font-size:11px;border:1px solid #d4dae5;padding:4px 8px;border-radius:6px}.fixture_path{font-size:11px;overflow-wrap:anywhere}#fixture-footer{margin-top:auto}#fixture-workbench{height:100%;width:100%}#fixture-errors{position:fixed;bottom:0;left:0;right:0;max-height:130px;overflow:auto;z-index:99999;background:#fff0ef;color:#a92820;padding:8px;font:12px monospace;white-space:pre-wrap}body.dclGroupWorkspace .fixture_frame{grid-template-columns:minmax(0,1fr)!important}body.dclGroupWorkspace .fixture_centerCol{grid-column:1}
</style></head><body><div class="fixture_frame"><aside class="fixture_sidebarCol"><strong>DSH</strong><span class="fixture_tag">隔離 UI fixture · 3081</span><div class="fixture_nav">原生會話</div><div class="fixture_nav">測試研究會話</div><div class="fixture_nav">測試寫作會話</div><div id="fixture-footer"></div></aside><main class="fixture_centerCol"><section id="fixture-native-center" class="fixture_native"><span class="fixture_tag">不是正式 DSH</span><h1>群聊工作流程驗證</h1><p>左下「群聊」載入實際插件頁面。React、ReactDOM、client.js、HTTP handler 與協作資料服務均使用本機實際程式。模型與原生 Session 執行已停用。</p><p>請保持「自動協作」關閉來測試純訊息保存；若開啟，fixture 會拒絕任何原生準備或派送。</p><code class="fixture_path">${workspace}</code></section><div id="fixture-workbench" hidden></div></main></div><pre id="fixture-errors" hidden></pre><script src="/__fixture__/vendor.js"></script><script src="/__fixture__/bootstrap.js"></script><script src="/__fixture__/client.js"></script></body></html>`;

function respond(res,status,type,body){res.writeHead(status,{"content-type":type,"cache-control":"no-store","x-content-type-options":"nosniff"});res.end(body);}
let closing=false;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url??"/",`http://${host}:${port}`);
    if(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`)return respond(res,403,"text/plain","Fixture accepts same-origin requests only");
    if(url.pathname==="/")return respond(res,200,"text/html; charset=utf-8",html);
    if(url.pathname==="/__fixture__/vendor.js")return respond(res,200,"text/javascript; charset=utf-8",vendor);
    if(url.pathname==="/__fixture__/bootstrap.js")return respond(res,200,"text/javascript; charset=utf-8",bootstrap);
    if(url.pathname==="/__fixture__/client.js")return respond(res,200,"text/javascript; charset=utf-8",await readFile(join(sourceRoot,"lib/client.js"),"utf8"));
    if(url.pathname==="/__fixture__/status")return respond(res,200,"application/json",JSON.stringify({isolated:true,fixtureRoot,workspace,statePath,counters,seed:{groupId:group.id,roomId:room.id,draftId:draft.id},runtime:moduleFiles}));
    if(url.pathname.startsWith("/api/dsh-chat-local/")){
      // File contents and export destinations are outside this fixture's UI-workflow scope.
      if(/\/(?:artifacts\/preview|share-file)$/.test(url.pathname)||req.method==="POST"&&/\/export$/.test(url.pathname))return respond(res,403,"application/json",JSON.stringify({ok:false,error:"隔離 fixture 不開放檔案內容或匯出；請在專門的檔案測試驗證。"}));
      return await actualHandler(req,res);
    }
    respond(res,404,"text/plain; charset=utf-8","Unknown fixture resource");
  }catch(error){console.error(error);if(!res.headersSent)respond(res,500,"application/json",JSON.stringify({ok:false,error:error.message}));else res.end();}
});
server.on("error",error=>{console.error(error);process.exitCode=1;void shutdown();});
await new Promise(resolve=>server.listen(port,host,resolve));
console.log(JSON.stringify({url:`http://${host}:${port}/`,fixtureRoot,workspace,statePath,counters,seed:{groupId:group.id,roomId:room.id,draftId:draft.id},note:"Actual React/ReactDOM, plugin client, HTTP handler and DshChatLocalService. All native writes and model execution are denied."},null,2));
async function shutdown(){if(closing)return;closing=true;server.close();await Promise.allSettled(disposers.reverse().map(dispose=>dispose()));console.log(`Fixture stopped; isolated state retained at ${statePath}`);}
process.on("SIGINT",()=>void shutdown());process.on("SIGTERM",()=>void shutdown());
