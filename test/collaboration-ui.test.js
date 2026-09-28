import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollaborationUI } from '../lib/collaboration-ui.js';
const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)});
const nodes=tree=>typeof tree==='object'&&tree?[tree,...tree.children.flatMap(nodes)]:[];
const text=tree=>typeof tree==='object'&&tree?tree.children.map(text).join(''):String(tree??'');
function fixture({onChanged=async()=>{},api=async()=>({})}={}) {
  const state=[];let cursor=0;
  const React={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];}};
  const UI=createCollaborationUI(React,h,api);
  const props={room:{id:'room',members:[{sessionId:'a',alias:'作者'}],orchestration:{state:'idle'}},overview:{strategy:'work',revision:7,outcome:'incomplete',unreviewedCount:1,pendingCount:1,requests:[{id:'request',revision:4,state:'needs_resolution',recipient:'a',purpose:'correction',triggerEventId:'message'}]},onChanged};
  return {UI,props,render(){cursor=0;return UI.Overview(props);}};
}
test('idle execution and unreviewed corrections are never rendered as accepted work',()=>{
  const f=fixture(),tree=f.render();assert.match(text(tree),/工作尚未完成/);assert.match(text(tree),/1 項未審閱/);assert.doesNotMatch(text(tree),/已驗收/);
  f.props.overview.outcome='budget_exhausted';assert.match(text(f.render()),/執行額度已用盡/);
});
test('human resolution binds request revision and source; blank disposition cannot submit',async()=>{
  const calls=[];const f=fixture({api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{};}});
  nodes(f.render()).find(n=>n.type==='button'&&text(n)==='記錄處置').props.onClick();
  let tree=f.render();assert.equal(nodes(tree).find(n=>n.type==='button'&&text(n)==='保存處置').props.disabled,true);
  nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'已閱讀更正，按 v2 重驗。'}});
  nodes(f.render()).find(n=>n.props['aria-label']==='已核對依據 1').props.onChange({target:{checked:true}});
  nodes(f.render()).find(n=>n.type==='button'&&text(n)==='保存處置').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{requestId:'request',expectedRevision:4,resolution:{disposition:'answered',summary:'已閱讀更正，按 v2 重驗。'},sourceMessageIds:['message']});
});
test('policy change is versioned, disabled while running, and refresh failure is not reported as failed save',async()=>{
  const calls=[];const f=fixture({api:async(path,options)=>calls.push(JSON.parse(options.body)),onChanged:async()=>{throw Error('offline');}});
  nodes(f.render()).find(n=>n.type==='select').props.onChange({target:{value:'discussion'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{strategy:'discussion',expectedRevision:7}]);assert.match(text(f.render()),/操作已保存/);
  f.props.room.orchestration.state='running';assert.equal(nodes(f.render()).find(n=>n.type==='select').props.disabled,true);
});

test('contract editor selects exact historical input versions without silently adopting the newest',()=>{
 const UI=createCollaborationUI({},h,()=>{}),first={kind:'artifact',artifactId:'a',versionId:'v1',contentHash:'1'.repeat(64)},changes=[];
 const draft={id:'work',inputRefs:[first],requiredWorkIds:['child'],integration:true,allowPartialDelivery:false};
 const artifacts=[{id:'a',logicalName:'report.md',currentVersionId:'v2',versions:['v1','v2'].map((id,i)=>({id,contentHash:String(i+1).repeat(64),snapshot:{storage:'immutable-v1'}}))}];
 const tree=UI.ContractEditor({draft,entries:[{id:'child',kind:'task',title:'核查資料'}],artifacts,onChange:patch=>changes.push(patch)});
 assert.equal(changes.length,0);
 const labels=nodes(tree).filter(node=>node.type==='label');
 assert.equal(nodes(labels.find(label=>text(label).includes('v1'))).find(node=>node.type==='input').props.checked,true);
 assert.equal(nodes(labels.find(label=>text(label).includes('v2'))).find(node=>node.type==='input').props.checked,false);
 nodes(labels.find(label=>text(label).includes('v2'))).find(node=>node.type==='input').props.onChange();
 assert.equal(changes[0].inputRefs[0].versionId,'v1');assert.equal(changes[0].inputRefs[1].versionId,'v2');
});

test('artifact history opens the clicked fixed version and does not claim path-only versions are recoverable',()=>{
 const UI=createCollaborationUI({},h,()=>{}),calls=[];
 const artifact={id:'a',logicalName:'report.md',currentVersionId:'v2',versions:[{id:'old-path',contentHash:'0'.repeat(64)},...['v1','v2'].map((id,i)=>({id,contentHash:String(i+1).repeat(64),snapshot:{storage:'immutable-v1'}}))]};
 const tree=UI.ArtifactHistory({artifacts:[artifact],onRead:(a,v)=>calls.push(v.id),onReadPath:()=>calls.push('path')});
 assert.match(text(tree),/2 個可讀固定版本/);assert.match(text(tree),/僅路徑登記/);
 const old=nodes(tree).find(node=>node.type==='button'&&text(node).includes('111111111111'));old.props.onClick();
 assert.deepEqual(calls,['v1']);
});

test('unknown results require explicit human reconciliation and use real message sources rather than ledger ids',async()=>{
 const calls=[];const f=fixture({api:async(path,options)=>calls.push(JSON.parse(options.body))});
 f.props.overview.requests=[{id:'unknown',revision:9,state:'unknown',recipient:'a',purpose:'handoff',triggerEventId:'ledger:task:3',sourceMessageIds:['delivery-message']}];
 nodes(f.render()).find(node=>node.type==='button'&&text(node)==='記錄處置').props.onClick();
 nodes(f.render()).find(node=>node.type==='textarea').props.onChange({target:{value:'原會話只有讀取，沒有產生新寫入。'}});
 nodes(f.render()).find(node=>node.props['aria-label']==='已核對依據 1').props.onChange({target:{checked:true}});
 assert.equal(nodes(f.render()).find(node=>node.type==='button'&&text(node)==='保存處置').props.disabled,true);
 nodes(f.render()).find(node=>node.props['aria-label']==='已核對未知執行結果').props.onChange({target:{checked:true}});
 nodes(f.render()).find(node=>node.type==='button'&&text(node)==='保存處置').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls[0].resolution.disposition,'result_checked');assert.deepEqual(calls[0].sourceMessageIds,['delivery-message']);
});

test('composer audience explains notify, disabled automatic dispatch, explicit recipients and discussion consistently',()=>{
 const UI=createCollaborationUI({},h,()=>{}),base={strategy:'work',count:3,autoDeliver:true};
 assert.match(UI.audienceLabel({...base,purpose:'notify',all:true}),/不立即喚醒/);
 assert.match(UI.audienceLabel({...base,autoDeliver:false}),/指定收件人後才處理/);
 assert.match(UI.audienceLabel({...base,autoDeliver:false,names:['審閱人']}),/發送給 審閱人/);
 assert.match(UI.audienceLabel({...base,strategy:'discussion',purpose:'auto'}),/討論策略/);
 assert.match(UI.audienceLabel({...base,strategy:'discussion',purpose:'request'}),/工作責任/);
 assert.match(UI.audienceLabel({...base,strategy:'legacy'}),/依次參與/);
});

test('artifact pages remove only generated line prefixes so Markdown and literal source numbering survive',()=>{
 const UI=createCollaborationUI({},h,()=>{});
 assert.equal(UI.artifactPageText({startLine:7,content:'7: # 報告\n8: 1: 來源原本有行號\n9: '}),'# 報告\n1: 來源原本有行號\n');
});

test('overview renders why an unresolved request cannot run',()=>{
 const f=fixture();f.props.overview.requests[0].waitReason='reserved_for_closure';
 assert.match(text(f.render()),/剩餘額度保留給整合與驗收/);
});

test('accepted historical work shows new objections explicitly and never masks unknown execution',()=>{
 const f=fixture();Object.assign(f.props.overview,{outcome:'accepted',acceptedWithNewEvents:true,postAcceptanceIssueCount:1});
 assert.match(text(f.render()),/已驗收 · 新更正／異議待複核/);
 f.props.overview.outcome='unknown';assert.match(text(f.render()),/執行結果未知/);assert.doesNotMatch(text(f.render()).split('項待處理')[0],/已驗收/);
});
