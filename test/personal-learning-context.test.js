import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DshChatLocalService} from '../lib/room-store.js';
import {renderPersonalMemory} from '../lib/agent-memory.js';
import {buildPersonalQuery,knowledgeApplicability} from '../lib/personal-context.js';

async function setup(t) {
 const dir=await mkdtemp(join(tmpdir(),'dcl-learning-context-'));
 const calls=[];
 const ctx={agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>calls.push({from,to,text,delivery})},get(n){return this[n];}};
 const service=new DshChatLocalService(ctx,{path:join(dir,'rooms.json'),replyTimeoutMs:5000,memoryLifecycle:{decay:false}});
 await service.ready;
 t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
 const a=await service.directory.save({profile:{alias:'A'},operationId:'create-a'});
 const b=await service.directory.save({profile:{alias:'B'},operationId:'create-b'});
 const room=await service.createRoom({name:'work',autoDeliver:false,members:[{kind:'session',sessionId:'a',alias:'A',agentId:a.id},{kind:'session',sessionId:'b',alias:'B',agentId:b.id}]});
 const second=await service.createRoom({name:'other work',autoDeliver:false,members:[{kind:'session',sessionId:'a2',alias:'A',agentId:a.id}]});
 let seq=0;
 const observe=async(text,session='a')=>{
   const id=`observed-${++seq}`;
   await service.observeSessionEvent(session,{type:'user/message',data:{message:{id,content:[{type:'text',text}]}}});
   const memory=await service.agentMemory(session,{query:text});
   const item=memory.experiences.find(item=>item.evidenceId.includes(id));
   assert.ok(item,'receipt must be recallable');
   return {sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId};
 };
 const candidate=async(evidence,extra={})=>service.updatePersonalMemory('a',{action:'lesson',operationId:`candidate-${++seq}`,claim:'Check the actual release before using API fields.',conditions:'When adapting to a changed host API.',evidence:[evidence],trigger:{kind:'correction',evidence:[evidence]},...extra});
 return {service,room,second,a,b,calls,observe,candidate};
}

test('lesson candidates require observed sources, remain private and do not enter the default prompt',async t=>{
 const h=await setup(t),source=await h.observe('Correction: the installed API has a distinct release boundary.');
 const persona=await h.service.directory.persona(h.a.id);
 await assert.rejects(h.candidate(source,{trigger:{kind:'correction',evidence:[{...source,evidenceId:'never-observed'}]}}),/personally observed/);
 await assert.rejects(h.candidate(source,{reviewSnapshotId:'silently-ignored'}),/unsupported.*reviewSnapshotId/);
 const first=await h.candidate(source,{operationId:'one-candidate'});
 const replay=await h.candidate(source,{operationId:'one-candidate'});
 assert.equal(replay.lessonId,first.lessonId);assert.equal(replay.eventId,first.eventId);
 assert.deepEqual((await h.service.agentMemory('a')).lessons??[],[]);
 const explicit=await h.service.agentMemory('a2',{includeCandidates:true});
 assert.equal(explicit.learningCandidates.length,1);
 assert.equal(explicit.learningCandidates[0].status,'candidate');
 assert.doesNotMatch(renderPersonalMemory(explicit).text??'',/Check the actual release/);
 assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('b',{includeCandidates:true})),/Check the actual release/);
 assert.equal((await h.service.directory.persona(h.a.id)).hash,persona.hash);
 await assert.rejects(h.service.updatePersonalMemory('b',{action:'adopt_lesson',operationId:'other-adopt',lessonId:first.lessonId,resultEvidence:[source],reason:'Looks right.'}),/current own/);
});

test('adoption needs a result, creates a revision, and retirement never revives its candidate after reload',async t=>{
 const h=await setup(t),source=await h.observe('Correction: verify installed release before changing fields.');
 const first=await h.candidate(source);
 await assert.rejects(h.service.updatePersonalMemory('a',{action:'adopt_lesson',operationId:'no-result',lessonId:first.lessonId,reason:'I think so.'}),/original personally observed/);
 const result=await h.observe('Verification passed: runtime 0.1.7 matches the tested schema.');
 const adopted=await h.service.updatePersonalMemory('a',{action:'adopt_lesson',operationId:'adopt',lessonId:first.lessonId,resultEvidence:[result],reason:'Checked with the installed runtime.'});
 assert.notEqual(adopted.lessonId,first.lessonId);
 const memory=await h.service.agentMemory('a',{includeCandidates:true});
 assert.equal(memory.lessons.length,1);assert.equal(memory.learningCandidates?.length??0,0);
 assert.equal(memory.lessons[0].supersedes,first.lessonId);
 assert.equal(memory.lessons[0].resultEvidence[0].evidenceId,result.evidenceId);
 assert.match(renderPersonalMemory(memory).text,/已採納方法/);
 await h.service.updatePersonalMemory('a',{action:'retire_lesson',operationId:'retire',lessonId:adopted.lessonId,reason:'A later API changed the condition.'});
 const restarted=new DshChatLocalService(h.service.ctx,{path:h.service.path});
 try {await restarted.ready;const recalled=await restarted.agentMemory('a',{includeCandidates:true});assert.deepEqual(recalled.lessons??[],[]);assert.deepEqual(recalled.learningCandidates??[],[]);}
 finally {await restarted.close();}
});

test('lesson provenance cannot cite belief, itself, suppressed evidence or another person; invalid support can still be retired',async t=>{
 const h=await setup(t),source=await h.observe('Original fact used as a test source.');
 const belief=await h.service.updatePersonalMemory('a',{action:'belief',operationId:'belief',claim:'Tentative interpretation.',evidence:[source]});
 await assert.rejects(h.candidate({...source,evidenceId:belief.eventId}),/original personally observed/);
 const candidate=await h.candidate(source);
 await assert.rejects(h.candidate({...source,evidenceId:candidate.eventId}),/original personally observed/);
 const foreign=await h.observe('Private source owned by B.','b');
 await assert.rejects(h.candidate(foreign),/original personally observed/);
 await h.service.updatePersonalMemory('a',{action:'suppress',operationId:'suppress',...source});
 await assert.rejects(h.service.updatePersonalMemory('a',{action:'adopt_lesson',operationId:'invalid',lessonId:candidate.lessonId,resultEvidence:[source],reason:'invalid'}),/valid original evidence/);
 await h.service.updatePersonalMemory('a',{action:'reject_lesson',operationId:'reject-invalid',lessonId:candidate.lessonId,reason:'Source was suppressed.'});
 await h.service.updatePersonalMemory('a',{action:'restore',operationId:'restore',...source});
 assert.deepEqual((await h.service.agentMemory('a',{includeCandidates:true})).learningCandidates??[],[]);
});

test('same person cannot concurrently adopt one candidate from two rooms',async t=>{
 const h=await setup(t),source=await h.observe('Result verified by an observed instrument.');
 const candidate=await h.candidate(source);
 const actions=await Promise.allSettled([
  h.service.updatePersonalMemory('a',{roomId:h.room.id,action:'adopt_lesson',operationId:'race-a',lessonId:candidate.lessonId,resultEvidence:[source],reason:'Confirmed here.'}),
  h.service.updatePersonalMemory('a2',{roomId:h.second.id,action:'adopt_lesson',operationId:'race-b',lessonId:candidate.lessonId,resultEvidence:[source],reason:'Confirmed there.'})]);
 assert.equal(actions.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await h.service.agentMemory('a',{includeCandidates:true})).lessons.length,1);
});

test('belief scope and validity remain explicit; counterevidence creates a needs_review revision',async t=>{
 const h=await setup(t),source=await h.observe('The release date was described as Friday.');
 const belief=await h.service.updatePersonalMemory('a',{action:'belief',operationId:'scoped',claim:'Friday is provisional.',evidence:[source],scope:{roomId:h.room.id,topic:'release'},validUntil:1});
 assert.deepEqual((await h.service.agentMemory('a2',{roomId:h.second.id})).beliefs,[]);
 let memory=await h.service.agentMemory('a',{roomId:h.room.id});
 assert.equal(memory.beliefs[0].status,'needs_review');assert.equal(memory.beliefs[0].outsideValidity,true);
 const counter=await h.observe('Correction: release date is unknown.');
 const revised=await h.service.updatePersonalMemory('a',{action:'challenge_belief',operationId:'challenge',beliefId:belief.beliefId,counterEvidence:[counter],reason:'The owner retracted the date.'});
 memory=await h.service.agentMemory('a',{roomId:h.room.id});
 assert.equal(memory.beliefs.length,1);assert.equal(memory.beliefs[0].beliefId,revised.beliefId);assert.equal(memory.beliefs[0].supersedes,belief.beliefId);
 assert.equal(memory.beliefs[0].counterEvidence[0].evidenceId,counter.evidenceId);
 assert.match(renderPersonalMemory(memory).text,/需重查/);
 assert.equal(knowledgeApplicability({status:'candidate',validUntil:1}).status,'candidate','expired candidates never become adopted methods');
});

test('native context uses the actual claimed input query without recording that claim as experience',async t=>{
 const h=await setup(t);
 await h.observe('水晶計畫的數據需要先核對時區');
 for(let n=0;n<8;n++) await h.observe(`無關的水果採購紀錄${n}`);
 await h.service.observeSessionEvent('a2',{type:'turn/start',data:{turn:7}});
 h.service.observeNativeInputClaim({agent:{session:{id:'a2'}},turn:7,message:{id:'pending-claim',content:[{type:'text',text:'請檢查水晶計畫的時區'}]}});
 const context=await h.service.nativeAgentContext('a2');
 assert.match(context,/水晶計畫的數據/);
 assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('a2')),/pending-claim|請檢查水晶計畫/);
 assert.match(context,/chat_memory_update\(action="lesson"\)/);
 assert.match(buildPersonalQuery({task:{title:'Release',details:'Validate runtime',acceptanceCriteria:'Verify live fields'}}),/Validate runtime[\s\S]*Verify live fields/);
});

test('review snapshots freeze observed prefixes and state an honest exposure boundary',async t=>{
 const h=await setup(t),source=await h.observe('Original result visible before review.');
 const frozen=await h.service.updatePersonalMemory('a',{action:'review_snapshot',operationId:'freeze',excludedEvidence:[]});
 assert.equal(frozen.blindness,'not_certified');
 await h.observe('A peer verdict published after the review cutoff.');
 const memory=await h.service.agentMemory('a2',{reviewSnapshotId:frozen.reviewSnapshotId});
 assert.match(JSON.stringify(memory),/Original result visible/);assert.doesNotMatch(JSON.stringify(memory),/peer verdict published/);
 assert.equal(memory.reviewSnapshot.nativeSessionKnowledge,'not-erased');
 const exposed=await h.service.updatePersonalMemory('a',{action:'review_snapshot',operationId:'exposed',excludedEvidence:[source]});
 assert.equal(exposed.blindness,'known_exposure');assert.equal(exposed.knownExposure.length,1);
 const filtered=await h.service.agentMemory('a',{reviewSnapshotId:exposed.reviewSnapshotId});
 assert.doesNotMatch(JSON.stringify(filtered.experiences),/Original result visible/);
 await assert.rejects(h.service.agentMemory('b',{reviewSnapshotId:frozen.reviewSnapshotId}),/own review snapshot/);
});

test('later suppressions and belief revisions remain effective inside a review snapshot',async t=>{
 const h=await setup(t),source=await h.observe('Evidence that must be suppressible after freezing.');
 const belief=await h.service.updatePersonalMemory('a',{action:'belief',operationId:'old',claim:'Old belief must not reappear.',evidence:[source]});
 const snapshot=await h.service.updatePersonalMemory('a',{action:'review_snapshot',operationId:'snapshot'});
 await h.service.updatePersonalMemory('a',{action:'belief',operationId:'new',claim:'New belief after review cutoff.',evidence:[source],supersedes:belief.beliefId});
 let memory=await h.service.agentMemory('a',{reviewSnapshotId:snapshot.reviewSnapshotId});
 assert.deepEqual(memory.beliefs,[],'neither the revoked predecessor nor future interpretation belongs in the snapshot');
 await h.service.updatePersonalMemory('a',{action:'suppress',operationId:'hide',...source});
 memory=await h.service.agentMemory('a',{reviewSnapshotId:snapshot.reviewSnapshotId});
 assert.deepEqual(memory.experiences,[]);
});

test('review snapshot rejects a changed source set and a changed verified prefix',async t=>{
 const h=await setup(t);await h.observe('A source existing before cutoff.');
 const snapshot=await h.service.updatePersonalMemory('a',{action:'review_snapshot',operationId:'snapshot'});
 const read=h.service.journal.readEvents.bind(h.service.journal);
 h.service.journal.readEvents=async roomId=>{const events=await read(roomId);return events.length?events.map((event,i)=>i===0?{...event,hash:'changed'}:event):events;};
 try{await assert.rejects(h.service.agentMemory('a',{reviewSnapshotId:snapshot.reviewSnapshotId}),/prefix changed/);}finally{h.service.journal.readEvents=read;}
 await h.service.createRoom({name:'New source after snapshot',autoDeliver:false,members:[{kind:'session',sessionId:'a3',alias:'A',agentId:h.a.id}]});
 await assert.rejects(h.service.agentMemory('a',{reviewSnapshotId:snapshot.reviewSnapshotId}),/source set changed/);
});

test('group delivery recalls current task material rather than later unrelated memories',async t=>{
 const h=await setup(t);
 await h.observe('Kestrel coolant requires a pressure measurement before release.');
 for(let n=0;n<8;n++) await h.observe(`Unrelated grocery notes item ${n}`);
 const task=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'Kestrel coolant pressure',details:'Find pressure measurement',acceptanceCriteria:'Observed measurement before release',ownerSessionId:'a'});
 await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'處理這項工作',mentions:['a'],workId:task.id,purpose:'request'});
 const until=Date.now()+3000;while(!h.calls.length&&Date.now()<until) await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(h.calls.length);
 const digest=h.calls[0].text.split('你的個人經歷與看法')[1]?.split('若這次有明確')[0];
 assert.match(digest??'',/Kestrel coolant requires/);
 assert.match(h.calls[0].text,/chat_memory_update\(action="lesson"\)/);
});

test('reset removes support without letting later re-observation revive a lesson',async t=>{
 const h=await setup(t);
 const message=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'Room result accepted after checking original evidence.',automaticDelivery:false});
 await h.service.roomMemory(h.room.id,'a');
 const source=(await h.service.agentMemory('a')).experiences.find(item=>item.text.includes('Room result accepted'));
 const ref={sourceRoomId:source.sourceRoomId,evidenceId:source.evidenceId};
 const candidate=await h.candidate(ref);
 const adopted=await h.service.updatePersonalMemory('a',{action:'adopt_lesson',operationId:'adopt-room',lessonId:candidate.lessonId,resultEvidence:[ref],reason:'Observed result.'});
 assert.equal((await h.service.agentMemory('a')).lessons.length,1);
 await h.service.relationshipIntervention(h.room.id,{action:'clear',appliedBy:'human',mechanism:'test',memoryScope:'all'});
 assert.deepEqual((await h.service.agentMemory('a')).lessons??[],[]);
 await h.service.roomMemory(h.room.id,'a');
 assert.match(JSON.stringify((await h.service.agentMemory('a')).experiences),/Room result accepted/);
 assert.deepEqual((await h.service.agentMemory('a')).lessons??[],[],'new receipt is not the evidence receipt the lesson cited');
 await h.service.updatePersonalMemory('a',{action:'retire_lesson',operationId:'retire-reset',lessonId:adopted.lessonId,reason:'Old evidence epoch is gone.'});
 assert.ok(message.id);
});

test('review exclusions canonicalize a message alias and remove its dependent belief',async t=>{
 const h=await setup(t);
 const message=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'Peer assessment must be excluded from this review.',automaticDelivery:false});
 await h.service.roomMemory(h.room.id,'a');
 const evidence={sourceRoomId:h.room.id,evidenceId:message.id};
 await h.service.updatePersonalMemory('a',{action:'belief',operationId:'peer-belief',claim:'Interpretation from peer assessment.',evidence:[evidence]});
 const snapshot=await h.service.updatePersonalMemory('a',{action:'review_snapshot',operationId:'exclude-alias',excludedEvidence:[evidence]});
 const memory=await h.service.agentMemory('a',{reviewSnapshotId:snapshot.reviewSnapshotId});
 assert.equal(snapshot.blindness,'known_exposure');
 assert.doesNotMatch(JSON.stringify(memory.experiences),/Peer assessment/);assert.deepEqual(memory.beliefs,[]);
});

test('actual reviewer dispatch fixes a snapshot and later recall cannot opt out of its cutoff',async t=>{
 const h=await setup(t);await h.observe('Reviewer previous personally observed release checklist.','b');
 let task=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'Review release checklist',acceptanceCriteria:'List checked evidence',ownerSessionId:'a',reviewerSessionId:'b',contractVersion:1});
 const source=await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'Produce the checklist for independent review',mentions:['a'],workId:task.id,purpose:'request'});
 const wait=async index=>{const until=Date.now()+5000;while(!h.calls[index]&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(h.calls[index]);return h.calls[index];};
 const begin=async(index)=>{const call=await wait(index);await h.service.observeSessionEvent(call.to,{type:'turn/start',data:{turn:index+1}});await h.service.observeSessionEvent(call.to,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]`}]}});return call;};
 await begin(0);
 const operation=(action,extra={})=>({action,operationId:action,entryId:task.id,expectedRevision:task.revision,sourceMessageIds:[source.id],summary:'Checked this version',...extra});
 task=await h.service.operateWork(h.room.id,'a',operation('acknowledge'));
 const artifact=await h.service.publishArtifact(h.room.id,'a',{entryId:task.id,expectedRevision:task.revision,operationId:'publish',content:'Release checklist: checked evidence',logicalName:'checklist.md'});
 task=await h.service.operateWork(h.room.id,'a',operation('submit',{deliverable:'checklist.md',artifactRefs:[artifact.artifactRef],coverage:{satisfied:['List checked evidence'],missing:[],impact:''}}));
 await h.service.observeSessionEvent('a',{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
 const reviewer=await begin(1);assert.equal(reviewer.to,'b');assert.match(reviewer.text,/本次評審個人記憶快照/);assert.match(reviewer.text,/not_certified/);
 const frozen=await h.service.agentMemory('b');assert.ok(frozen.reviewSnapshot.reviewSnapshotId);assert.equal(frozen.reviewSnapshot.workId,task.id);
 await h.service.observeSessionEvent('b',{type:'tool/result',data:{message:{id:'late-review-source',content:[{type:'text',text:'Later reviewer source outside the frozen memory cutoff.'}]}}});
 assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('b')),/Later reviewer source/);
 await assert.rejects(h.service.agentMemory('b',{reviewSnapshotId:'other-snapshot'}),/fixed snapshot/);
 assert.ok((await h.service.eventsFor(h.room.id)).some(event=>event.type==='memory.review'));
});
