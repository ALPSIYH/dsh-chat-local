import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

const wait=async predicate=>{const deadline=Date.now()+8000;while(!await predicate()){if(Date.now()>deadline)throw Error('delivery timeout');await new Promise(resolve=>setTimeout(resolve,10));}};
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'dcl-collaboration-tools-')),tools=new Map(),calls=[];let handler;
 const ctx={effect(fn){return fn();},on(){return()=>{};},tools:{register(tool){tools.set(tool.name,tool);},guard(){}},webServer:{register(route){handler=route.handler;}},
  sessions:{get(){return{header:{cwd:directory}};}},agents:{get(){return{cancel(){}};}},dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>{calls.push({from,to,text,delivery});}},get(name){return this[name];}};
 const service=apply(ctx,{path:join(directory,'rooms.json'),replyTimeoutMs:20_000,maxReplies:8,maxTurnsPerParticipant:4,monitorIntervalMs:3_600_000});await service.ready;
 t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
 const request=async(path,body)=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url='/api/dsh-chat-local'+path;req.method=body===undefined?'GET':'POST';let status,result;await handler(req,{writeHead(code){status=code;},end(text){result=JSON.parse(text);}});return{status,...result};};
 const http=async(path,body)=>{const result=await request(path,body);assert.equal(result.status,200,result.error);return result.value;};
 const execute=(name,sessionId,args)=>tools.get(name).execute(args,{agent:{session:{id:sessionId}}});
 const begin=async index=>{await wait(()=>calls.length>index);const call=calls[index];await service.observeSessionEvent(call.to,{type:'turn/start',data:{turn:index+1}});await service.observeSessionEvent(call.to,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}`}]}});return call;};
 const end=async index=>{await service.observeSessionEvent(calls[index].to,{type:'turn/end',data:{turn:index+1,reason:{kind:'completed'}}});};
 return{directory,tools,calls,service,request,http,execute,begin,end};
}

test('public HTTP and registered tools carry a work contract through fixed publication and independent exact-version review',async t=>{
 const h=await fixture(t),room=await h.http('/rooms',{name:'對外入口整合',members:['owner','reviewer'].map(sessionId=>({kind:'session',sessionId,alias:sessionId}))});
 assert.equal((await h.http(`/rooms/${room.id}/collaboration`)).strategy,'work');
 let task=await h.http(`/rooms/${room.id}/ledger`,{kind:'task',title:'產生可核查報告',acceptanceCriteria:'列明樣本與限制',ownerSessionId:'owner',reviewerSessionId:'reviewer',integration:true});
 const source=await h.http(`/rooms/${room.id}/messages`,{authorKind:'human',author:'human:me',text:'請分析給定的五項資料',workId:task.id,purpose:'request',clientOperationId:'start'});
 assert.equal((await h.begin(0)).to,'owner');
 const work=(action,extra={})=>({room:room.id,operationId:action,action,entryId:task.id,expectedRevision:task.revision,summary:'依指定材料與版本處理',sourceMessageIds:[source.id],...extra});
 task=await h.execute('chat_work','owner',work('acknowledge'));
 const published=await h.execute('chat_publish_artifact','owner',{room:room.id,entryId:task.id,expectedRevision:task.revision,operationId:'publish',content:'# 報告\n五項資料，缺少原始測量。',logicalName:'report.md'});
 await assert.rejects(h.execute('chat_publish_artifact','reviewer',{room:room.id,entryId:task.id,expectedRevision:task.revision,operationId:'forged',content:'forged'}));
 const original=await h.http(`/rooms/${room.id}/artifacts/read-version`,published.artifactRef);assert.match(original.content,/五項資料/);
 task=await h.execute('chat_work','owner',work('submit',{deliverable:'report.md 固定版',artifactRefs:[published.artifactRef],coverage:{satisfied:['列明樣本與限制'],missing:[],impact:''}}));
 const outstanding=await h.execute('chat_collaboration','owner',{room:room.id});
 const request=outstanding.requests.find(item=>item.triggerEventId===source.id&&item.recipient==='owner'&&!['resolved','obsolete'].includes(item.state));
 if(request)await h.execute('chat_resolve_request','owner',{room:room.id,requestId:request.id,expectedRevision:request.revision,resolution:'已發布固定報告並提交獨立驗收',sourceMessageIds:[source.id]});
 await h.end(0);assert.equal((await h.begin(1)).to,'reviewer');
 const read=await h.execute('chat_read_artifact','reviewer',{room:room.id,...published.artifactRef});assert.equal(read.memoryReceipt.status,'recorded');
 const stale=await h.request(`/rooms/${room.id}/ledger/${task.id}`,{expectedRevision:task.revision,expectedContractHash:'0'.repeat(64),expectedSubmissionRevision:task.submission.revision,artifactRefs:task.submission.artifactRefs,patch:{status:'done',reviewSummary:'過期重送'}});
 assert.notEqual(stale.status,200);
 await assert.rejects(h.execute('chat_work','reviewer',work('review',{verdict:'approve',expectedContractHash:'0'.repeat(64),expectedSubmissionRevision:task.submission.revision,artifactRefs:task.submission.artifactRefs})),/contract|revision/);
 task=await h.execute('chat_work','reviewer',work('review',{verdict:'approve',expectedContractHash:task.contractHash,expectedSubmissionRevision:task.submission.revision,artifactRefs:task.submission.artifactRefs}));
 assert.equal(task.status,'done');assert.equal(task.review.contractHash,task.contractHash);
 await h.end(1);await wait(async()=>!['queued','running'].includes((await h.service.resolveRoom(room.id)).orchestration.state));
 assert.equal((await h.http(`/rooms/${room.id}/collaboration`)).outcome,'accepted');
 await assert.rejects(h.execute('chat_collaboration','outsider',{room:room.id}),/member/);

 for(const name of ['chat_publish_artifact','chat_read_artifact','chat_collaboration','chat_resolve_request'])assert.ok(h.tools.has(name));
});

test('public human correction preserves one request identity and requires a versioned disposition',async t=>{
 const h=await fixture(t),room=await h.http('/rooms',{name:'更正',autoDeliver:false,members:[{sessionId:'owner',kind:'session',alias:'owner'}]});
 const body={authorKind:'human',author:'human:me',text:'之前的樣本數錯了，應為五。',purpose:'correction',clientOperationId:'correction-1'};
 const first=await h.http(`/rooms/${room.id}/messages`,body),second=await h.http(`/rooms/${room.id}/messages`,body);assert.equal(first.id,second.id);
 const overview=await h.http(`/rooms/${room.id}/collaboration`),request=overview.requests.find(item=>item.triggerEventId===first.id);assert.ok(request);
 const stale=await h.request(`/rooms/${room.id}/collaboration/resolve`,{requestId:request.id,expectedRevision:request.revision+1,resolution:'更正已記錄',sourceMessageIds:[first.id]});assert.notEqual(stale.status,200);
 await h.http(`/rooms/${room.id}/collaboration/resolve`,{requestId:request.id,expectedRevision:request.revision,resolution:'核對五項來源後採納更正',sourceMessageIds:[first.id]});
 const next=await h.http(`/rooms/${room.id}/collaboration`);assert.equal(next.requests.filter(item=>item.triggerEventId===first.id).length,1);assert.equal(next.requests.find(item=>item.id===request.id).state,'resolved');assert.notEqual(next.outcome,'accepted');
});


test('portable snapshot restore HTTP accepts fixed bytes above the normal message body limit',async t=>{
 const h=await fixture(t),room=await h.http('/rooms',{name:'可攜備份',autoDeliver:false,members:[{sessionId:'owner',kind:'session',alias:'owner'}]});
 const task=await h.http(`/rooms/${room.id}/ledger`,{kind:'task',title:'大型成果',ownerSessionId:'owner'});
 const path=join(h.directory,'report.md');await writeFile(path,'x'.repeat(900000));
 const published=await h.http(`/rooms/${room.id}/artifacts/publish`,{operationId:'large',entryId:task.id,expectedRevision:task.revision,path});
 const snapshot=JSON.parse((await h.http(`/rooms/${room.id}/snapshot`)).content);assert.ok(JSON.stringify(snapshot).length>1_000_000);
 await h.http(`/rooms/${room.id}/restore-from-snapshot`,{snapshot,confirm:true});
 assert.equal((await h.http(`/rooms/${room.id}/artifacts`))[0].versions[0].contentHash,published.artifactRef.contentHash);
 const tooLarge=await h.request(`/rooms/${room.id}/messages`,{authorKind:'human',author:'human:me',text:'x'.repeat(1_000_001)});assert.equal(tooLarge.status,413);
});

test('overview tool does not invent observation receipts for source text it never returns',async t=>{
 const h=await fixture(t),room=await h.http('/rooms',{name:'概要不等於閱讀',autoDeliver:false,members:[{sessionId:'owner',kind:'session',alias:'owner'}]});
 await h.service.send({roomId:room.id,authorKind:'human',author:'human:me',text:'UNREAD_7432 原始證據不能因概要查詢而變成親歷。',purpose:'notify',automaticDelivery:false});
 await h.service.settledAudit();const before=(await h.service.eventsFor(room.id)).filter(event=>event.type==='memory.observed').length;
 const result=await h.execute('chat_collaboration','owner',{room:room.id});assert.doesNotMatch(JSON.stringify(result),/UNREAD_7432/);
 await h.service.settledAudit();assert.equal((await h.service.eventsFor(room.id)).filter(event=>event.type==='memory.observed').length,before);
 assert.doesNotMatch(JSON.stringify(await h.execute('chat_recall','owner',{room:room.id,query:'UNREAD_7432'})),/UNREAD_7432/);
 assert.equal(h.tools.get('chat_send').parameters.properties.requestId,undefined);
 assert.ok(h.tools.get('chat_resolve_request').parameters.properties.resolution.oneOf.some(schema=>schema.properties?.disposition?.enum?.includes('needs_evidence')));
});
