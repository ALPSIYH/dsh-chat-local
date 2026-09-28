import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DshChatLocalService} from '../lib/room-store.js';
import {addRequest,assertWorkClosure,reconcileLedgerRequests} from '../lib/collaboration-requests.js';
import {normalizeCollaboration} from '../lib/collaboration-policy.js';
import {newBudgetAccount,reserveExecution} from '../lib/collaboration-budget.js';
const wait=async predicate=>{const deadline=Date.now()+10_000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('condition timed out');};
async function fixture(t,config={}){
 const dir=await mkdtemp(join(tmpdir(),'collaboration-runtime-')),path=join(dir,'rooms.json'),calls=[];
 const ctx={dshBridge:{deliverExternal:async(from,to,text,delivery)=>{calls.push({from,to,text,delivery});}},agents:{get:()=>({cancel(){}})},get(name){return this[name];}};
 const service=new DshChatLocalService(ctx,{path,maxTurnsPerParticipant:3,maxReplies:8,replyTimeoutMs:5000,...config});await service.ready;
 t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
 const room=await service.createRoom({name:'工作',members:['a','b','c'].map(id=>({sessionId:id,alias:id,kind:'session'}))});
 const begin=async index=>{await wait(()=>calls.length>index);const call=calls[index],turn=index+1;
 await service.observeSessionEvent(call.to,{type:'turn/start',data:{turn}});
 await service.observeSessionEvent(call.to,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}`}]}});return call;};
 const end=async(index,text='(pass)')=>{const call=calls[index],turn=index+1;
 await service.observeSessionEvent(call.to,{type:'assistant/message',data:{turn,step:1,message:{content:[{type:'text',text}]}}});
 await service.observeSessionEvent(call.to,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});};
 const idle=()=>wait(()=>!['running','queued'].includes(service.state.rooms[0].orchestration.state));
 return {service,room,calls,path,dir,begin,end,idle};
}

test('new work rooms route one owner, ordinary @ text does not delegate, and notify does not supersede',async t=>{
 const h=await fixture(t);
 const first=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'請研究 @b 的說法'});
 await h.begin(0);assert.equal(h.calls[0].to,'a');
 const epoch=h.service.state.rooms[0].epoch;
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'notify',text:'補充材料'});
 assert.equal(h.service.state.rooms[0].epoch,epoch);
 await h.end(0,'我在報告引用 @b，不是請他回覆');
 await h.begin(1);assert.equal(h.calls[1].to,'a');assert.match(h.calls[1].text,/unreviewed/);
 await h.end(1);await h.idle();
 assert.equal(h.calls.length,2);
 const view=await h.service.collaborationOverview(h.room.id);
 assert.equal(view.unreviewedCount,1);assert.equal(view.outcome,'incomplete');
 assert.equal(view.budgetAccounts[0].reservations.filter(r=>r.state!=='released').length,2);
 assert.equal(view.requests.find(r=>r.triggerEventId===first.id&&r.purpose==='request').state,'resolved');
});

test('explicit discussion invites once; every pass spends durable executions and reopening does not reset it',async t=>{
 const h=await fixture(t,{maxReplies:3});
 await h.service.setCollaborationPolicy(h.room.id,{strategy:'discussion',expectedRevision:1,budget:{maxExecutions:3,maxPerMember:2,integrationReserve:0,reviewReserve:0}});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'各自思考一次'});
 for(let i=0;i<3;i++){await h.begin(i);await h.end(i);}
 await h.idle();const before=await h.service.collaborationOverview(h.room.id);
 assert.equal(before.budgetAccounts[0].reservations.length,3);assert.equal(before.budgetAccounts[0].visibleReplies,0);
 await h.service.close();
 const restarted=new DshChatLocalService({get(){return undefined;}},{path:h.path});await restarted.ready;
 try{const after=await restarted.collaborationOverview(h.room.id);assert.deepEqual(after.budgetAccounts,before.budgetAccounts);}finally{await restarted.close();}
});

test('correction is a request, remains unresolved after pass, and unrelated member cannot resolve it',async t=>{
 const h=await fixture(t);
 const root=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'開始'});await h.begin(0);
 const correction=await h.service.send({roomId:h.room.id,author:'a',authorKind:'session',purpose:'correction',recipientSessionIds:['b'],text:'材料錯誤',clientOperationId:'correction-1'});
 const repeated=await h.service.send({roomId:h.room.id,author:'a',authorKind:'session',purpose:'correction',recipientSessionIds:['b'],text:'材料錯誤',clientOperationId:'correction-1'});
 assert.equal(correction.id,repeated.id);
 const request=h.service.state.rooms[0].collaboration.requests.find(item=>item.triggerEventId===correction.id);
 await assert.rejects(h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'自己結清',sourceMessageIds:[root.id]},'a'),/recipient/);
 await h.end(0);await h.begin(1);assert.equal(h.calls[1].to,'b');await h.end(1);await h.idle();
 assert.equal(request.state,'needs_resolution');
 const view=await h.service.collaborationOverview(h.room.id);assert.equal(view.requests.filter(item=>item.triggerEventId===correction.id).length,1);
});

test('debit is on disk before Host dispatch and interrupted dispatch becomes unknown without a refund',async t=>{
 const h=await fixture(t);
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'開始'});await wait(()=>h.calls.length===1);
 const disk=JSON.parse(await readFile(h.path,'utf8'));
 const account=disk.rooms[0].collaboration.budgetAccounts[0];assert.equal(account.reservations.length,1);assert.equal(account.reservations[0].state,'dispatched');
 // Simulate restart from the durable pre-reply image in another isolated file.
 const restartPath=join(h.dir,'restart','rooms.json');const {mkdir}=await import('node:fs/promises');await mkdir(join(h.dir,'restart'));
 await writeFile(restartPath,JSON.stringify(disk));
 const restored=new DshChatLocalService({get(){return undefined;}},{path:restartPath});await restored.ready;
 try{const view=await restored.collaborationOverview(h.room.id);assert.equal(view.requests[0].state,'unknown');assert.equal(view.budgetAccounts[0].reservations[0].state,'unknown');assert.equal(view.outcome,'unknown');}finally{await restored.close();}
});

test('old room state keeps legacy policy instead of silently reinterpreting routing',async t=>{
 const h=await fixture(t);await h.service.close();
 const disk=JSON.parse(await readFile(h.path,'utf8'));delete disk.rooms[0].collaboration;await writeFile(h.path,JSON.stringify(disk));
 const restored=new DshChatLocalService({get(){return undefined;}},{path:h.path});await restored.ready;
 try{assert.equal((await restored.collaborationOverview(h.room.id)).strategy,'legacy');}finally{await restored.close();}
});

test('one shared blocker request and reserves protect integrator and reviewer slots',()=>{
 const room={roomSeq:1,members:[{sessionId:'a'},{sessionId:'b'}],ledger:[],collaboration:normalizeCollaboration({strategy:'work'})};
 const event={type:'handoff',actor:'human:me',summary:'resume'};
 const make=id=>({id,kind:'task',status:'blocked',contractHash:'same',ownerSessionId:'a',blocker:{kind:'material',summary:'missing',filePaths:['x']},handoff:{id:'h'+id,purpose:'recovery',state:'queued',sessionIds:['a'],text:'read'}});
 const first=make('one'),second=make('two');reconcileLedgerRequests(room,first,null,event);reconcileLedgerRequests(room,second,null,event);
 assert.equal(room.collaboration.requests.length,1);assert.equal(first.handoff.requestId,second.handoff.requestId);assert.equal(first.handoff.state,undefined);
 // A later explicit recovery after the first issue was disposed must not be
 // swallowed by its old dedup key (for example, the missing file now exists).
 room.collaboration.requests[0].state='resolved';reconcileLedgerRequests(room,make('new-check'),null,event);assert.equal(room.collaboration.requests.length,2);
 const work={id:'integrate',kind:'task',integration:true,status:'in_progress',ownerSessionId:'a',reviewerSessionId:'b'};room.ledger.push(work);
 const account=newBudgetAccount(room,{id:'source'},{maxExecutions:4,maxPerMember:2});
 assert.ok(reserveExecution(room,account,{id:'r1',recipient:'a',purpose:'assignment'}).reservation);
 assert.equal(reserveExecution(room,account,{id:'r2',recipient:'a',purpose:'assignment'}).denied,'member_limit');
 assert.ok(reserveExecution(room,account,{id:'r3',recipient:'b',purpose:'assignment'}).reservation);
 assert.ok(reserveExecution(room,account,{id:'r4',recipient:'a',purpose:'integration'}).reservation);
 assert.ok(reserveExecution(room,account,{id:'r5',recipient:'b',purpose:'review'}).reservation);
 assert.equal(account.reservations.length,4);
});

test('integration closure rejects unresolved issues and unreviewed material',()=>{
 const room={roomSeq:2,members:[{sessionId:'a'}],ledger:[],collaboration:normalizeCollaboration({strategy:'work'})},entry={id:'i',kind:'task',integration:true,requiredWorkIds:[]};
 const issue=addRequest(room,{workId:'i',triggerEventId:'m',recipient:'a',purpose:'objection'});
 assert.throws(()=>assertWorkClosure(room,entry),/unresolved/);
 issue.state='resolved';room.collaboration.unreviewed.push({messageId:'m2',state:'unreviewed',workId:null});assert.throws(()=>assertWorkClosure(room,entry),/unreviewed/);
 room.collaboration.unreviewed[0].state='reviewed';assert.doesNotThrow(()=>assertWorkClosure(room,entry));
});

test('dispatcher spends reserved integration and review slots and closes only a fixed reviewed result',async t=>{
 const h=await fixture(t,{replyTimeoutMs:5000});
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:4,maxPerMember:2,integrationReserve:1,reviewReserve:1}});
 let work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'整合',integration:true,acceptanceCriteria:'核對材料與結論',ownerSessionId:'b',reviewerSessionId:'c'});
 assert.equal((await h.service.collaborationOverview(h.room.id)).coordinatorSessionId,'a','an integration owner does not silently replace the room coordinator setting');
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',workId:work.id,text:'準備整合報告'});
 await h.begin(0);assert.equal(h.calls[0].to,'b');
 work=await h.service.operateWork(h.room.id,'b',{action:'acknowledge',entryId:work.id,expectedRevision:work.revision,operationId:'ack',sourceMessageIds:[source.id],summary:'確認範圍'});
 await h.service.send({roomId:h.room.id,author:'b',authorKind:'session',purpose:'request',recipientSessionIds:['a'],workId:work.id,text:'請檢查資料'});
 await h.end(0);await h.begin(1);assert.equal(h.calls[1].to,'a');await h.end(1,'核查完成：資料中的值為 42。');
 await h.begin(2);assert.equal(h.calls[2].to,'b');
 let view=await h.service.collaborationOverview(h.room.id),closing=view.requests.find(r=>r.purpose==='integration');
 assert.equal(view.budgetAccounts[0].reservations[2].phase,'integration');
 const evidence=view.unreviewed.map(item=>item.messageId);assert.equal(evidence.length,1);
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:closing.id,expectedRevision:closing.revision,resolution:{disposition:'accepted',summary:'已核對原始資料並納入成品'},sourceMessageIds:evidence},'b');
 const published=await h.service.publishArtifact(h.room.id,'b',{operationId:'publish',entryId:work.id,expectedRevision:work.revision,content:'固定報告：42。',logicalName:'report.md'});
 work=await h.service.operateWork(h.room.id,'b',{action:'submit',entryId:work.id,expectedRevision:work.revision,operationId:'submit',sourceMessageIds:[source.id,...evidence],summary:'提交已核查成品',deliverable:'report.md',artifactRefs:[published.artifactRef],coverage:{satisfied:['核對材料與結論'],missing:[],impact:''}});
 await h.end(2);await h.begin(3);assert.equal(h.calls[3].to,'c');
 await h.service.readArtifactVersion(h.room.id,'c',published.artifactRef);
 work=await h.service.operateWork(h.room.id,'c',{action:'review',entryId:work.id,expectedRevision:work.revision,operationId:'review',sourceMessageIds:[source.id],summary:'獨立核驗固定報告與材料',expectedContractHash:work.contractHash,expectedSubmissionRevision:work.submission.revision,artifactRefs:work.submission.artifactRefs,verdict:'approve'});
 await h.end(3);await h.idle();view=await h.service.collaborationOverview(h.room.id);
 assert.equal(work.status,'done');assert.equal(view.outcome,'accepted');assert.equal(view.pendingCount,0);assert.equal(view.unreviewedCount,0);
 assert.deepEqual(view.budgetAccounts[0].reservations.map(item=>item.phase),['work','work','integration','review']);assert.equal(h.calls.length,4);
});

test('a status inquiry and an internal handoff never replenish the current execution budget',async t=>{
 const h=await fixture(t);
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:1,maxPerMember:1,integrationReserve:0,reviewReserve:0}});
 let work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'處理材料',acceptanceCriteria:'核查',ownerSessionId:'a',reviewerSessionId:'b'});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',workId:work.id,text:'做一次'});await h.begin(0);await h.end(0,'本次核對已完成');await h.idle();
 const accountId=(await h.service.collaborationOverview(h.room.id)).budgetAccounts[0].id;
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'status',text:'進度如何'});await h.idle();
 let view=await h.service.collaborationOverview(h.room.id);assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].id,accountId);assert.equal(h.calls.length,1);assert.equal(view.execution.endReason,'budget_exhausted');
 work=await h.service.requestLedgerHandoff(h.room.id,work.id,{operationId:'handoff-one',expectedRevision:work.revision});
 await h.idle();view=await h.service.collaborationOverview(h.room.id);
 assert.equal(view.budgetAccounts.length,1);assert.equal(h.calls.length,1);assert.equal(view.requests.find(r=>r.handoffId).budgetAccountId,accountId);
 assert.ok(view.requests.find(r=>r.handoffId).triggerEventId!==view.requests.find(r=>r.handoffId).deliveryMessageId);
 assert.equal(source.budgetAccountId,accountId);
});

test('resolving an unseen source is rejected and reading it does not itself dismiss an objection',async t=>{
 const h=await fixture(t);
 for(let i=0;i<30;i++)await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'notify',text:`材料 ${i}`,automaticDelivery:false});
 const oldest=h.service.state.rooms[0].messages[0];
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'request',recipientSessionIds:['b'],text:'核對'});await h.begin(0);
 const issue=await h.service.send({roomId:h.room.id,author:'b',authorKind:'session',purpose:'objection',recipientSessionIds:['c'],text:'不同意結論'});await h.end(0);await h.begin(1);
 const request=h.service.state.rooms[0].collaboration.requests.find(r=>r.triggerEventId===issue.id);
 await assert.rejects(h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'核對了',sourceMessageIds:[oldest.id]},'c'),/personally observed/);
 await h.service.roomMemory(h.room.id,'c');assert.equal(request.state,'dispatched');
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:{disposition:'needs_evidence',summary:'缺乏可見證據'},sourceMessageIds:[issue.id]},'c');
 assert.equal(request.state,'needs_resolution');await h.end(1);await h.service.stopRoom(h.room.id);
});

test('work strategy preserves charter review and objection return through the same bounded request queue',async t=>{
 const h=await fixture(t,{replyTimeoutMs:5000});
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:5,maxPerMember:3,integrationReserve:0,reviewReserve:0}});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'把核查要求写入章程'});await h.begin(0);
 let proposal=await h.service.proposeCharter(h.room.id,'a',{baseRevision:1,charter:'每個結論提供可核查證據',reason:'明確证据规则',sourceMessageIds:[source.id]});
 await h.end(0,'已提交修訂');await h.begin(1);assert.equal(h.calls[1].to,'b');
 proposal=await h.service.reviewCharter(h.room.id,'b',{proposalId:proposal.id,verdict:'request_changes',comment:'需要列出證據無法取得的例外'});
 await h.end(1);await h.begin(2);assert.equal(h.calls[2].to,'a');assert.match(h.calls[2].text,/charter_rework/);
 const replacement=await h.service.proposeCharter(h.room.id,'a',{baseRevision:1,charter:'每個結論提供可核查證據；無法取得時明示缺件',reason:'加入缺件規則',sourceMessageIds:[source.id],replacesProposalId:proposal.id});
 await h.end(2);await h.begin(3);assert.equal(h.calls[3].to,'b');await h.service.reviewCharter(h.room.id,'b',{proposalId:replacement.id,verdict:'approve',comment:'缺件規則可接受'});await h.end(3);
 await h.begin(4);assert.equal(h.calls[4].to,'c');await h.service.reviewCharter(h.room.id,'c',{proposalId:replacement.id,verdict:'approve',comment:'已核驗條款'});await h.end(4);await h.idle();
 const view=await h.service.collaborationOverview(h.room.id);
 assert.equal((await h.service.resolveRoom(h.room.id)).profile.revision,2);assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].reservations.length,5);
 assert.ok(view.requests.filter(request=>request.proposalId).every(request=>['resolved','obsolete'].includes(request.state)));
});

test('stopping keeps unstarted requests visible but cannot silently replay them on a later status message',async t=>{
 const h=await fixture(t);
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,strategy:'discussion',budget:{maxExecutions:4,maxPerMember:2,integrationReserve:0,reviewReserve:0}});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'各自檢查'});await h.begin(0);await h.service.stopRoom(h.room.id);await h.idle();
 const pending=(await h.service.collaborationOverview(h.room.id)).requests.filter(request=>['b','c'].includes(request.recipient));
 assert.equal(pending.length,2);assert.ok(pending.every(request=>request.state==='needs_resolution'&&request.waitReason==='user_stopped'));
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'status',recipientSessionIds:['a'],text:'狀態如何'});await h.begin(1);await h.end(1,'之前的工作已停止，尚未處理的項目保留');await h.idle();
 assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.to==='a'));
});

test('human status and correction join an active run without cancelling the current worker or granting a new budget',async t=>{
 const h=await fixture(t);await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:3,maxPerMember:3,integrationReserve:0,reviewReserve:0}});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'處理工作'});await h.begin(0);
 const room=h.service.state.rooms[0],epoch=room.epoch;
 await h.service.send({roomId:room.id,author:'human:me',authorKind:'human',purpose:'status',text:'進度如何'});
 const corrected=await h.service.send({roomId:room.id,author:'human:me',authorKind:'human',purpose:'correction',text:'材料第2段有錯'});
 assert.equal(room.epoch,epoch);assert.equal(room.collaboration.budgetAccounts.length,1);assert.equal(room.messages[0].deliveries[0].status,'delivered');
 await h.end(0,'第一部分處理完成');await h.begin(1);assert.match(h.calls[1].text,/"purpose":"correction"/);
 const request=room.collaboration.requests.find(r=>r.triggerEventId===corrected.id);await h.service.resolveCollaborationRequest(room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'已核對並修正',sourceMessageIds:[corrected.id]},'a');
 await h.end(1);await h.begin(2);await h.end(2,'已修正材料，餘下工作待驗收');await h.idle();assert.equal(h.calls.length,3);
});

test('an explicitly enabled monitor uses the existing account and cannot replenish exhausted executions',async t=>{
 const h=await fixture(t,{monitorMinuteMs:200,monitorIntervalMs:25,replyTimeoutMs:5000});
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:2,maxPerMember:2,integrationReserve:0,reviewReserve:0}});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'建立工作範圍'});await h.begin(0);await h.end(0,'已記錄範圍');await h.idle();
 const work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'等待核對',ownerSessionId:'b',reviewerSessionId:'c',acceptanceCriteria:'核對來源',monitor:{enabled:true,coordinatorSessionId:'a',idleMinutes:1}});
 await h.begin(1);assert.equal(h.calls[1].to,'a');assert.match(h.calls[1].text,/停滞监控/);await h.end(1);await h.idle();
 await wait(()=>h.service.state.rooms[0].collaboration.requests.some(request=>request.workId===work.id&&request.waitReason==='execution_limit'));
 await h.idle();const view=await h.service.collaborationOverview(h.room.id);
 assert.equal(h.calls.length,2);assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].reservations.length,2);
 assert.ok(view.requests.some(request=>request.workId===work.id&&request.waitReason==='execution_limit'));
});

test('human-confirmed retry reconciles unknown results and preserves the original debit and account',async t=>{
 const h=await fixture(t,{replyTimeoutMs:100});await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:3,maxPerMember:3,integrationReserve:0,reviewReserve:0}});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'開始核查'});await h.begin(0);await h.idle();
 let view=await h.service.collaborationOverview(h.room.id);assert.equal(view.requests[0].state,'unknown');assert.equal(view.budgetAccounts[0].reservations[0].state,'unknown');
 await assert.rejects(h.service.retryFailedDeliveries(h.room.id,source.id,['a'],{mode:'original'}),/核对结果/);
 h.service.replyTimeoutMs=5000;
 const continued=await h.service.retryFailedDeliveries(h.room.id,source.id,['a'],{mode:'current',operationId:'checked-retry',expectedPolicyRevision:1,confirmResultChecked:true});
 await h.begin(1);await h.end(1,'已核查剩餘部分');await h.idle();view=await h.service.collaborationOverview(h.room.id);
 assert.equal(continued.budgetAccountId,source.budgetAccountId);assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].reservations.length,2);
 assert.equal(view.requests.find(request=>source.requestIds.includes(request.id)).resolution.disposition,'result_checked');
 assert.equal(view.budgetAccounts[0].reservations[0].state,'unknown');assert.equal(view.budgetAccounts[0].reservations[1].state,'completed');assert.equal(h.calls.length,2);
});

test('explicit monitor enablement may establish the first bounded account without an earlier chat request',async t=>{
 const h=await fixture(t,{monitorMinuteMs:200,monitorIntervalMs:25,replyTimeoutMs:5000});
 await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:1,maxPerMember:1,integrationReserve:0,reviewReserve:0}});
 const work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'核查',ownerSessionId:'b',reviewerSessionId:'c',acceptanceCriteria:'核實',monitor:{enabled:true,coordinatorSessionId:'a',idleMinutes:1}});
 await h.begin(0);assert.equal(h.calls[0].to,'a');await h.end(0);await h.idle();
 await wait(()=>h.service.state.rooms[0].collaboration.requests.some(request=>request.workId===work.id&&request.waitReason==='execution_limit'));
 const view=await h.service.collaborationOverview(h.room.id);assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].reservations.length,1);assert.equal(h.calls.length,1);
 assert.equal(view.budgetAccounts[0].authorization.workId,work.id);assert.equal(view.budgetAccounts[0].authorization.revision,work.revision);assert.equal(view.budgetAccounts[0].authorization.actor,'human:me');
});

test('collaboration overview verifies membership but never creates observations of undisplayed messages',async t=>{
 const h=await fixture(t);await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'notify',text:'尚未看過的材料',automaticDelivery:false});
 await h.service.settledAudit();const before=await h.service.eventLog.read(h.room.id);
 await h.service.collaborationOverview(h.room.id,'b');await assert.rejects(h.service.collaborationOverview(h.room.id,'outsider'),/member|visible|binding/);
 await h.service.settledAudit();const after=await h.service.eventLog.read(h.room.id);
 assert.deepEqual(after.filter(event=>event.type==='memory.observed'),before.filter(event=>event.type==='memory.observed'));
});

test('explicitly resuming a stopped handoff preserves its request/account and the resume operation is idempotent',async t=>{
 const h=await fixture(t);await h.service.setCollaborationPolicy(h.room.id,{expectedRevision:1,budget:{maxExecutions:3,maxPerMember:3,integrationReserve:0,reviewReserve:0}});
 let work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'工作',ownerSessionId:'a',reviewerSessionId:'b',acceptanceCriteria:'檢查'});
 work=await h.service.requestLedgerHandoff(h.room.id,work.id,{operationId:'initial-handoff',expectedRevision:work.revision});await h.begin(0);await h.end(0);await h.idle();
 const first=(await h.service.collaborationOverview(h.room.id)).requests.find(request=>request.handoffId);
 assert.equal(first.state,'needs_resolution');
 const options={operationId:'resume-handoff',expectedRevision:work.revision,note:'請繼續核對'};
 await h.service.requestLedgerHandoff(h.room.id,work.id,options);await h.begin(1);await h.end(1);await h.idle();
 const before=await h.service.collaborationOverview(h.room.id);await h.service.requestLedgerHandoff(h.room.id,work.id,options);const after=await h.service.collaborationOverview(h.room.id);
 assert.deepEqual(after.requests,before.requests);assert.equal(after.requests.filter(request=>request.handoffId).length,1);assert.equal(after.budgetAccounts.length,1);assert.equal(after.budgetAccounts[0].reservations.length,2);assert.equal(h.calls.length,2);
 await assert.rejects(h.service.requestLedgerHandoff(h.room.id,work.id,{...options,note:'changed'}),/reused/);
});

test('an initial explicit human correction receives one bounded account without requiring a prior general request',async t=>{
 const h=await fixture(t);const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'correction',text:'應使用新版樣本數'});
 await h.begin(0);assert.equal(h.calls[0].to,'a');const before=await h.service.collaborationOverview(h.room.id);
 const request=before.requests.find(item=>item.triggerEventId===source.id);await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'已確認此次依據為新版',sourceMessageIds:[source.id]},'a');
 await h.end(0);await h.idle();const view=await h.service.collaborationOverview(h.room.id);assert.equal(view.budgetAccounts.length,1);assert.equal(view.requests.find(item=>item.id===request.id).state,'resolved');
});

test('contract changes and cancellation preserve explicit issues until an evidenced disposition',async t=>{
 const h=await fixture(t);let work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'整合',integration:true,ownerSessionId:'a',reviewerSessionId:'b',acceptanceCriteria:'原標準'});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'correction',workId:work.id,text:'輸入證據有誤，不能直接驗收',automaticDelivery:false});
 const before=(await h.service.collaborationOverview(h.room.id)).requests.find(request=>request.triggerEventId===source.id);
 work=await h.service.updateLedgerEntry(h.room.id,work.id,{acceptanceCriteria:'修訂後標準'},{expectedRevision:work.revision});
 let request=(await h.service.collaborationOverview(h.room.id)).requests.find(request=>request.id===before.id);
 assert.equal(request.state,'pending');assert.equal(request.basisVersion,before.basisVersion);assert.equal(request.currentBasisVersion,work.contractHash);assert.equal(request.basisChanges.length,1);
 assert.throws(()=>assertWorkClosure(h.service.state.rooms[0],work),/unresolved/);
 work=await h.service.updateLedgerEntry(h.room.id,work.id,{status:'cancelled'},{expectedRevision:work.revision});
 request=(await h.service.collaborationOverview(h.room.id)).requests.find(request=>request.id===before.id);assert.equal(request.state,'needs_resolution');assert.equal(request.waitReason,'work_inactive');
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:{disposition:'rejected',summary:'此次工作已取消；原始更正保留供後續參考'},sourceMessageIds:[source.id]});
 assert.equal((await h.service.collaborationOverview(h.room.id)).requests.find(request=>request.id===before.id).state,'resolved');
});

test('notify followup reaches the work owner and the owner reply does not create an endless closure chain',async t=>{
 const h=await fixture(t);const work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'B工作',ownerSessionId:'b',reviewerSessionId:'c',acceptanceCriteria:'核對'});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'整理進度'});await h.begin(0);assert.equal(h.calls[0].to,'a');
 const notice=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'notify',workId:work.id,text:'B工作的新增材料'});await h.end(0,'進度已整理');
 await h.begin(1);assert.equal(h.calls[1].to,'b');const request=(await h.service.collaborationOverview(h.room.id)).requests.find(item=>item.purpose==='unreviewed');
 assert.equal(request.workId,work.id);await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'已閱讀本工作的材料',sourceMessageIds:[notice.id]},'b');
 await h.end(1,'已核查材料，稍後依原標準交付');await h.idle();assert.equal(h.calls.length,2);assert.equal((await h.service.collaborationOverview(h.room.id)).unreviewedCount,0);
});

test('pre-acceptance notify is reviewed before dispatching reviewer; post-acceptance replies and issues preserve the frozen result visibly',async t=>{
 const h=await fixture(t);let work=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'整合報告',integration:true,ownerSessionId:'a',reviewerSessionId:'b',acceptanceCriteria:'核對資料'});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',workId:work.id,text:'交付報告'});await h.begin(0);
 work=await h.service.operateWork(h.room.id,'a',{action:'acknowledge',entryId:work.id,expectedRevision:work.revision,operationId:'post-ack',sourceMessageIds:[source.id],summary:'確認'});
 const artifact=await h.service.publishArtifact(h.room.id,'a',{operationId:'post-publish',entryId:work.id,expectedRevision:work.revision,content:'固定結論',logicalName:'result.md'});
 work=await h.service.operateWork(h.room.id,'a',{action:'submit',entryId:work.id,expectedRevision:work.revision,operationId:'post-submit',sourceMessageIds:[source.id],summary:'提交',deliverable:'result.md',artifactRefs:[artifact.artifactRef],coverage:{satisfied:['核對資料'],missing:[],impact:''}});
 const notice=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'notify',workId:work.id,text:'驗收前必須核對的補充'});await h.end(0,'已提交固定成品');
 await h.begin(1);assert.equal(h.calls[1].to,'a','unreviewed material is handled before consuming reviewer budget');
 let view=await h.service.collaborationOverview(h.room.id),closing=view.requests.find(request=>request.purpose==='integration');
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:closing.id,expectedRevision:closing.revision,resolution:'已核查補充且不影響固定結論',sourceMessageIds:[notice.id]},'a');await h.end(1,'補充已核查');
 await h.begin(2);assert.equal(h.calls[2].to,'b');await h.service.readArtifactVersion(h.room.id,'b',artifact.artifactRef);
 work=await h.service.operateWork(h.room.id,'b',{action:'review',entryId:work.id,expectedRevision:work.revision,operationId:'post-review',sourceMessageIds:[source.id,notice.id],summary:'獨立核查通過',expectedContractHash:work.contractHash,expectedSubmissionRevision:work.submission.revision,artifactRefs:work.submission.artifactRefs,verdict:'approve'});
 const cutoff=work.review.eventCutoffRoomSeq;await h.end(2,'固定版本已驗收通過。');await h.idle();view=await h.service.collaborationOverview(h.room.id);
 assert.equal(h.calls.length,3);assert.equal(view.outcome,'accepted');assert.equal(view.acceptanceCutoffRoomSeq,cutoff);assert.equal(view.acceptedWithNewEvents,true);assert.equal(view.postAcceptanceUnreviewedCount,1);assert.equal(view.postAcceptanceIssueCount,0);
 const issue=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',purpose:'objection',workId:work.id,text:'我對剛驗收的版本有新異議',automaticDelivery:false});view=await h.service.collaborationOverview(h.room.id);
 assert.equal(view.outcome,'accepted');assert.equal(view.acceptedWithNewEvents,true);assert.equal(view.postAcceptanceIssueCount,1);assert.ok(view.requests.some(request=>request.triggerEventId===issue.id&&request.state==='pending'));
  work=await h.service.updateLedgerEntry(h.room.id,work.id,{acceptanceCriteria:'新驗收標準'},{expectedRevision:work.revision});view=await h.service.collaborationOverview(h.room.id);assert.notEqual(view.outcome,'accepted');assert.equal(view.acceptedWithNewEvents,false);assert.equal(work.status,'open');
});

test('modern decision notification projects canonical request state and reaches every recipient on one bounded account',async t=>{
 const h=await fixture(t);
 const tasks=[];
 for(const ownerSessionId of ['a','b']) tasks.push(await h.service.createLedgerEntry(h.room.id,{kind:'task',title:`${ownerSessionId}工作`,ownerSessionId,reviewerSessionId:'c',acceptanceCriteria:'核查'}));
 const decision=await h.service.createLedgerEntry(h.room.id,{kind:'decision',title:'採用方案',relatedEntryIds:tasks.map(task=>task.id)});
 const result=await h.service.updateLedgerEntry(h.room.id,decision.id,{status:'decided',notifyParticipants:true},{expectedRevision:decision.revision});
 assert.ok(['deferred','sending','sent'].includes(result.notification.state));assert.ok(['queued','sending','waiting_report'].includes(result.handoff.state));
 assert.equal(h.service.state.rooms[0].ledger.find(entry=>entry.id===decision.id).handoff.state,undefined,'compatibility state is a projection, never another stored authority');
 await h.begin(0);assert.equal(h.calls[0].to,'a');
 let view=await h.service.collaborationOverview(h.room.id),request=view.requests.find(item=>item.handoffId===result.handoff.id&&item.recipient==='a');
 const noticeId=request.deliveryMessageId;
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'已核對決定',sourceMessageIds:[request.deliveryMessageId]},'a');await h.end(0);
 await h.begin(1);assert.equal(h.calls[1].to,'b');
 const active=(await h.service.listLedger(h.room.id)).find(entry=>entry.id===decision.id);
 assert.equal(active.handoff.state,'waiting_report');
 assert.equal((await h.service.roomMemory(h.room.id,'b')).ledger.find(entry=>entry.id===decision.id).handoff.state,'waiting_report');
 view=await h.service.collaborationOverview(h.room.id);request=view.requests.find(item=>item.handoffId===result.handoff.id&&item.recipient==='b');
 await h.service.resolveCollaborationRequest(h.room.id,{requestId:request.id,expectedRevision:request.revision,resolution:'已核對決定',sourceMessageIds:[noticeId]},'b');
 await h.end(1);await h.idle();view=await h.service.collaborationOverview(h.room.id);
 assert.equal(view.budgetAccounts.length,1);assert.equal(view.budgetAccounts[0].reservations.length,2);assert.equal(h.calls.length,2);
 assert.equal((await h.service.listLedger(h.room.id)).find(entry=>entry.id===decision.id).handoff.state,'delivered');
 const stored=JSON.parse(await readFile(h.path,'utf8')).rooms[0].ledger.find(entry=>entry.id===decision.id);assert.equal(stored.handoff.state,undefined);
});
