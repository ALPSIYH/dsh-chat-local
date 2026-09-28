import test from 'node:test';
import assert from 'node:assert/strict';
import {runPilotRequest} from '../scripts/dsh-pilot-provider.mjs';

const request={schemaVersion:1,messages:[{role:'system',content:'Persona'},{role:'user',content:'Task'}],parameters:{maxTokens:256}};
function fixture(chunks){let sent,requested;return {ctx:{agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fake-explicitly',reasoningEffort:'low'})},llm:{prepareCall:async(config)=>{requested=config;return {config,adapterDefaults:{},async *stream(options){sent=options;yield*chunks;}}}}},get sent(){return sent;},get requested(){return requested;}};}
test('pilot sends no schemas and no prior history, exposes actual prepared config without attesting internal retries',async()=>{
 const h=fixture([{type:'text-delta',text:'{"ok":true}'},{type:'usage',usage:{totalTokens:10}},{type:'finish',reason:{kind:'stop'}}]);
 const first=await runPilotRequest(h.ctx,request),second=await runPilotRequest(h.ctx,request);
 assert.deepEqual(h.sent.tools,[]);assert.equal(h.sent.system,'Persona');assert.equal(h.sent.messages.length,1);
 assert.notEqual(first.metadata.sessionId,second.metadata.sessionId);assert.equal(first.parameters.maxTokens,256);
 assert.equal(first.metadata.provider,'fixture');assert.equal(first.metadata.transportRetries,'not-observed');assert.equal(first.complete,true);
});
test('tool calls or truncated generations are retained as incomplete instead of successful answers',async()=>{
 for(const chunks of [[{type:'tool-call-delta',index:0,id:'c',name:'bash',argumentsDelta:'{}'},{type:'finish',reason:{kind:'tool-use'}}],[{type:'text-delta',text:'partial'},{type:'finish',reason:{kind:'max-tokens'}}]]){
  const h=fixture(chunks),result=await runPilotRequest(h.ctx,request);assert.equal(result.complete,false);
 }
});
test('pilot refuses unrecognized controls or mismatched model before a provider call',async()=>{
 const h=fixture([]);await assert.rejects(runPilotRequest(h.ctx,{...request,parameters:{seed:4}}),/unsupported/);
 await assert.rejects(runPilotRequest(h.ctx,{...request,model:'other'}),/differs/);assert.equal(h.sent,undefined);
});

test('pilot scoring preserves format and truncation failures rather than rescuing them into success',async()=>{
 const {scoreResponse,CASES}=await import('../scripts/personal-context-pilot.mjs');
 const content=JSON.stringify({releaseDay:'Friday',publicationAuthorized:false,unseenCode:'unknown',plan:'Verify one source.'});
 assert.equal(scoreResponse({text:content,complete:true},CASES[0]).passed,true);
 assert.equal(scoreResponse({text:'```json\n'+content+'\n```',complete:true},CASES[0]).passed,false);
 assert.equal(scoreResponse({text:content,complete:false},CASES[0]).passed,false);
});

test('shared pilot ledger persists a reservation before calls and unknown outcomes stop further spending',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {reserveModelCall,settleModelCall}=await import('../scripts/model-pilot-budget.mjs');
 const dir=await mkdtemp(join(tmpdir(),'pilot-accounting-')),path=join(dir,'budget.json');
 try{
  await writeFile(path,JSON.stringify({schemaVersion:1,calls:6,totalTokens:4247,maxCalls:8,maxObservedTokens:200000,stopBeforeNextAt:150000,deadlineAt:Date.now()+60000,reservations:[]}));
  const id=await reserveModelCall(path,{trialId:'one'});assert.equal(JSON.parse(await readFile(path)).calls,7);
  await assert.rejects(reserveModelCall(path),/pending|unknown/);
  await settleModelCall(path,id,{finishReason:'stop',usage:{totalTokens:400}});
  const second=await reserveModelCall(path,{trialId:'two'});await settleModelCall(path,second,{finishReason:'timeout'});
  await assert.rejects(reserveModelCall(path),/exhausted|unresolved/);
  const ledger=JSON.parse(await readFile(path));assert.equal(ledger.calls,8);assert.equal(ledger.totalTokens,4647);assert.equal(ledger.usageUnknown,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
