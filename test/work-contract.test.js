import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateSnapshot } from '../lib/room-export.js';
import { tmpdir } from 'node:os';
import { DshChatLocalService } from '../lib/room-store.js';
import { docxFixture } from './docx-fixture.js';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(),'dcl-contract-'));
  const workspace = join(directory,'workspace'); await mkdir(workspace);
  const calls=[];
  const ctx={sessions:{get:()=>({header:{cwd:workspace}})},agents:{get:()=>({cancel(){}})},
    dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>{calls.push({from,to,text,delivery});}},
    get(name){return this[name];}};
  const config={path:join(directory,'state','rooms.json'),replyTimeoutMs:5000,maxTurnsPerParticipant:1,maxReplies:1,monitorIntervalMs:3_600_000};
  let service=new DshChatLocalService(ctx,config), sequence=0;
  const room=await service.createRoom({name:'契約與固定成品',autoDeliver:false,collaboration:{strategy:'legacy'},members:['owner','reviewer','other'].map(sessionId=>({kind:'session',sessionId,alias:sessionId}))});
  const h={get service(){return service;},directory,workspace,room,
    command(source,input){return {operationId:`operation-${++sequence}`,sourceMessageIds:[source.id],summary:'核對本次工作狀態與證據',...input};},
    async task(extra={}){return service.createLedgerEntry(room.id,{kind:'task',title:'交付報告',acceptanceCriteria:'提供可核查結論',ownerSessionId:'owner',reviewerSessionId:'reviewer',contractVersion:1,...extra});},
    async current(entry){return (await service.listLedger(room.id,{includeArchived:true})).find(item=>item.id===entry.id);},
    async activate(sessionId='owner'){
      await service.stopRoom(room.id);const index=calls.length;
      const source=await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'處理此工作並核查確切版本',mentions:[sessionId]});
      const deadline=Date.now()+3000;
      while(!calls[index]){if(Date.now()>deadline)throw new Error('delivery did not start');await new Promise(r=>setTimeout(r,5));}
      const call=calls[index],turn=index+1;
      await service.observeSessionEvent(sessionId,{type:'turn/start',data:{turn}});
      await service.observeSessionEvent(sessionId,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}`}]}});
      return source;
    },
    async acknowledge(entry,source){return service.operateWork(room.id,'owner',h.command(source,{action:'acknowledge',entryId:entry.id,expectedRevision:entry.revision}));},
    async publish(entry,content='可核查結論與證據',extra={}){return service.publishArtifact(room.id,null,{operationId:`publish-${++sequence}`,entryId:entry.id,expectedRevision:entry.revision,content,logicalName:'report.md',...extra});},
    async submit(entry,source,ref,missing=[]){return service.operateWork(room.id,'owner',h.command(source,{action:'submit',entryId:entry.id,expectedRevision:entry.revision,deliverable:'report.md 固定版本',artifactRefs:[ref],coverage:{satisfied:['提供結論'],missing,impact:missing.length?'尚缺原始資料，結論暫定':''}}));},
    review(entry,source,extra={}){return service.operateWork(room.id,'reviewer',h.command(source,{action:'review',entryId:entry.id,expectedRevision:entry.revision,expectedContractHash:entry.contractHash,expectedSubmissionRevision:entry.submission.revision,artifactRefs:entry.submission.artifactRefs,verdict:'approve',...extra}));},
    async reopen(){await service.close();service=new DshChatLocalService(ctx,config);await service.ready;}
  };
  try{await run(h);}finally{await service.close();await rm(directory,{recursive:true,force:true});}
}

test('fixed artifacts survive source overwrite, restart and path removal; references are room scoped',()=>fixture(async h=>{
  const entry=await h.task(),path=join(h.workspace,'paper.md');await writeFile(path,'version one');
  const first=await h.service.publishArtifact(h.room.id,null,{operationId:'path-1',entryId:entry.id,expectedRevision:entry.revision,path});
  await writeFile(path,'version two');
  const second=await h.service.publishArtifact(h.room.id,null,{operationId:'path-2',entryId:entry.id,expectedRevision:entry.revision,path});
  assert.equal(first.artifactRef.artifactId,second.artifactRef.artifactId);
  assert.notEqual(first.artifactRef.versionId,second.artifactRef.versionId);
  await rm(path);await h.reopen();
  assert.match((await h.service.readArtifactVersion(h.room.id,null,first.artifactRef)).content,/version one/);
  assert.match((await h.service.readArtifactVersion(h.room.id,null,second.artifactRef)).content,/version two/);
  const other=await h.service.createRoom({name:'另一房間',members:[],autoDeliver:false});
  await assert.rejects(h.service.readArtifactVersion(other.id,null,first.artifactRef),/in this room/);
  const blob=h.service.artifactVersions.pathFor(first.artifactRef.contentHash);
  await writeFile(blob,'corrupted');
  await assert.rejects(h.service.readArtifactVersion(h.room.id,null,first.artifactRef),/integrity/);
}));

test('publication is idempotent and a failed state commit is not reported as a published result',()=>fixture(async h=>{
  const entry=await h.task(),request={operationId:'same-publication',entryId:entry.id,expectedRevision:entry.revision,content:'fixed',logicalName:'result.md'};
  const [a,b]=await Promise.all([h.service.publishArtifact(h.room.id,null,request),h.service.publishArtifact(h.room.id,null,request)]);
  assert.deepEqual(a.artifactRef,b.artifactRef);
  await assert.rejects(h.service.publishArtifact(h.room.id,null,{...request,content:'different'}),/reused/);
  const commit=h.service.journal.commit.bind(h.service.journal);let fail=true;
  h.service.journal.commit=async state=>{if(fail){fail=false;throw new Error('simulated state write failure');}return commit(state);};
  const retry={...request,operationId:'commit-retry',content:'another'};
  await assert.rejects(h.service.publishArtifact(h.room.id,null,retry),/state write failure/);
  const published=await h.service.publishArtifact(h.room.id,null,retry);
  await h.reopen();
  assert.match((await h.service.readArtifactVersion(h.room.id,null,published.artifactRef)).content,/another/);
  const state=JSON.parse(await readFile(join(h.directory,'state','rooms.json'),'utf8'));
  assert.equal(state.rooms[0].artifacts.flatMap(a=>a.publications??[]).filter(p=>p.operationId==='commit-retry').length,1);
}));

test('publication checks capacity, symlinks and stale work after awaited I/O without creating live references',()=>fixture(async h=>{
  let entry=await h.task();
  const publish=h.service.artifactVersions.publish.bind(h.service.artifactVersions);
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  h.service.artifactVersions.publish=async bytes=>{entered();await gate;return publish(bytes);};
  const waiting=h.publish(entry);await reached;
  entry=await h.service.updateLedgerEntry(h.room.id,entry.id,{acceptanceCriteria:'新的標準'},{expectedRevision:entry.revision});
  release();await assert.rejects(waiting,/revision conflict/);
  assert.equal((await h.service.listArtifacts(h.room.id)).length,0);
  h.service.artifactVersions.publish=publish;
  h.service.capacity.hardBytes=0;h.service.capacity.recoveryReserveBytes=0;h.service.capacity.softBytes=0;
  await assert.rejects(h.publish(entry),/capacity/);
  assert.equal((await h.service.listArtifacts(h.room.id)).length,0);
  h.service.capacity.hardBytes=2*1024**3;
  await rm(h.service.artifactVersions.directory,{recursive:true,force:true});
  await symlink(h.workspace,h.service.artifactVersions.directory);
  await assert.rejects(h.publish(entry),/regular directory/);
}));

test('real active-turn submit/review binds contract and exact artifact, while comments preserve acceptance target',()=>fixture(async h=>{
  let entry=await h.task(),source=await h.activate();entry=await h.acknowledge(entry,source);
  const contract=entry.contractHash;
  await assert.rejects(h.service.publishArtifact(h.room.id,'reviewer',{operationId:'forged',entryId:entry.id,expectedRevision:entry.revision,content:'not mine'}),/active|participant/);
  const published=await h.service.publishArtifact(h.room.id,'owner',{operationId:'owner-publish',entryId:entry.id,expectedRevision:entry.revision,content:'report'});
  entry=await h.submit(entry,source,published.artifactRef);
  assert.equal(entry.submission.contractHash,contract);assert.equal(entry.submission.versionStatus,'fixed');
  entry=await h.service.operateWork(h.room.id,'owner',h.command(source,{action:'comment',entryId:entry.id,expectedRevision:entry.revision}));
  assert.equal(entry.contractHash,contract);assert.ok(entry.revision>entry.submission.revision);
  source=await h.activate('reviewer');
  await assert.rejects(h.review(entry,source,{expectedContractHash:'0'.repeat(64)}),/current contract/);
  await assert.rejects(h.review(entry,source,{artifactRefs:[{...published.artifactRef,contentHash:'0'.repeat(64)}]}),/do not match/);
  entry=await h.review(entry,source);assert.equal(entry.status,'done');assert.equal(entry.review.contractHash,contract);
  const acceptedRevision=entry.review.submissionRevision;
  entry=await h.service.triageLedgerEntry(h.room.id,entry.id,{action:'archive',operationId:'fixed-archive',expectedRevision:entry.revision});
  entry=await h.service.triageLedgerEntry(h.room.id,entry.id,{action:'show',operationId:'fixed-show',expectedRevision:entry.revision});
  assert.equal(entry.status,'done');assert.equal(entry.review.contractHash,contract);

  entry=await h.service.updateLedgerEntry(h.room.id,entry.id,{acceptanceCriteria:'需加入反證'},{expectedRevision:entry.revision});
  assert.equal(entry.status,'open');assert.notEqual(entry.contractHash,contract);assert.equal(entry.review,undefined);
  assert.ok(entry.history.some(event=>event.before?.review?.submissionRevision===acceptedRevision));
}));

test('partial delivery cannot be accepted by either reviewer or human without a new authorized contract',()=>fixture(async h=>{
  let entry=await h.task(),source=await h.activate();entry=await h.acknowledge(entry,source);
  const published=await h.publish(entry);entry=await h.submit(entry,source,published.artifactRef,['尚缺原始資料']);
  await assert.rejects(h.service.operateWork(h.room.id,'owner',h.command(source,{action:'amend',entryId:entry.id,expectedRevision:entry.revision,fields:{allowPartialDelivery:true}})),/only the user/);
  await assert.rejects(h.service.updateLedgerEntry(h.room.id,entry.id,{status:'done',expectedContractHash:entry.contractHash,expectedSubmissionRevision:entry.submission.revision,artifactRefs:entry.submission.artifactRefs},{expectedRevision:entry.revision}),/partial delivery/);
  source=await h.activate('reviewer');await assert.rejects(h.review(entry,source),/partial delivery/);
  const previousHash=entry.contractHash;
  entry=await h.service.updateLedgerEntry(h.room.id,entry.id,{allowPartialDelivery:true},{expectedRevision:entry.revision});
  assert.notEqual(entry.contractHash,previousHash);assert.equal(entry.status,'open');assert.equal(entry.submission,undefined);
  source=await h.activate();entry=await h.acknowledge(entry,source);entry=await h.submit(entry,source,published.artifactRef,['尚缺原始資料']);
  source=await h.activate('reviewer');entry=await h.review(entry,source);assert.equal(entry.status,'done');assert.deepEqual(entry.review.coverage.missing,['尚缺原始資料']);
}));

test('required work graphs reject cycles and inputs pin a submitted version instead of current file contents',()=>fixture(async h=>{
  let child=await h.task({title:'子工作'}),source=await h.activate();child=await h.acknowledge(child,source);
  const published=await h.publish(child);child=await h.submit(child,source,published.artifactRef);
  const parent=await h.task({title:'整合',integration:true,requiredWorkIds:[child.id],inputRefs:[{kind:'work',entryId:child.id,submissionRevision:child.submission.revision,contractHash:child.contractHash}]});
  await assert.rejects(h.service.updateLedgerEntry(h.room.id,child.id,{requiredWorkIds:[parent.id]},{expectedRevision:child.revision}),/cycle/);
  await assert.rejects(h.task({inputRefs:[{kind:'artifact',...published.artifactRef,contentHash:'f'.repeat(64)}]}),/does not match/);
  const oldHash=parent.contractHash;
  child=await h.service.updateLedgerEntry(h.room.id,child.id,{acceptanceCriteria:'changed'},{expectedRevision:child.revision});
  assert.equal((await h.current(parent)).contractHash,oldHash,'fixed historical input does not silently become a new child contract');
  await h.reopen();assert.equal((await h.current(parent)).inputRefs[0].contractHash,parent.inputRefs[0].contractHash);
}));

test('legacy text submissions remain explicitly unfixed and new contracts cannot bypass review through human status updates',()=>fixture(async h=>{
  let legacy=await h.task({contractVersion:undefined}),source=await h.activate();legacy=await h.acknowledge(legacy,source);
  legacy=await h.service.operateWork(h.room.id,'owner',h.command(source,{action:'submit',entryId:legacy.id,expectedRevision:legacy.revision,deliverable:'old textual reference'}));
  assert.equal(legacy.submission.versionStatus,'unfixed');assert.equal(legacy.contractHash,undefined);
  const modern=await h.task();
  await assert.rejects(h.task({status:'done'}),/fixed submission/);
  await assert.rejects(h.service.updateLedgerEntry(h.room.id,modern.id,{status:'done'},{expectedRevision:modern.revision}),/fixed submitted/);
  await h.reopen();assert.equal((await h.current(legacy)).submission.versionStatus,'unfixed');
}));

test('a stale active-turn submit cannot finish under a later turn and corrupted bytes cannot pass review',()=>fixture(async h=>{
  let entry=await h.task(),source=await h.activate();entry=await h.acknowledge(entry,source);
  const published=await h.publish(entry),read=h.service.artifactVersions.read.bind(h.service.artifactVersions);
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  h.service.artifactVersions.read=async(...args)=>{entered();await gate;return read(...args);};
  const pending=h.submit(entry,source,published.artifactRef);await reached;
  await h.service.stopRoom(h.room.id);release();await assert.rejects(pending,/superseded|interrupted/);
  assert.equal((await h.current(entry)).submission,undefined);
  h.service.artifactVersions.read=read;
  source=await h.activate();entry=await h.submit(entry,source,published.artifactRef);
  source=await h.activate('reviewer');
  await writeFile(h.service.artifactVersions.pathFor(published.artifactRef.contentHash),'changed after submission');
  await assert.rejects(h.review(entry,source),/integrity/);
  assert.equal((await h.current(entry)).status,'in_review');
}));

test('fixed DOCX keeps original bytes and reading it records only the actual reader observation',()=>fixture(async h=>{
  const entry=await h.task(),path=join(h.workspace,'paper.docx'),original=docxFixture();
  await writeFile(path,original);
  const published=await h.service.publishArtifact(h.room.id,null,{operationId:'docx-publication',entryId:entry.id,expectedRevision:entry.revision,path});
  assert.deepEqual(await h.service.artifactVersions.read(published.artifactRef.contentHash),original);
  await h.activate('reviewer');
  const read=await h.service.readArtifactVersion(h.room.id,'reviewer',published.artifactRef);
  assert.match(read.content,/样本数/);assert.equal(read.memoryReceipt.status,'recorded');
  const events=await h.service.eventLog.read(h.room.id);
  const observation=events.find(item=>item.id===read.memoryReceipt.observationId);
  const reviewer=(await h.service.listParticipants(h.room.id)).find(item=>item.sessionId==='reviewer');
  assert.equal(observation.payload.observerAgentId,reviewer.agentId);
  assert.equal(observation.payload.origin,'chat_read_artifact');
}));

test('new work strategy enables contracts while discussion and legacy histories keep explicit compatibility',()=>fixture(async h=>{
  const modern=await h.service.createRoom({name:'work',autoDeliver:false,members:[],collaboration:{strategy:'work'}});
  const task=await h.service.createLedgerEntry(modern.id,{kind:'task',title:'new contract'});
  assert.equal(task.contractVersion,1);assert.match(task.contractHash,/^[a-f0-9]{64}$/);
  const legacy=await h.service.createLedgerEntry(h.room.id,{kind:'task',title:'legacy compatible'});
  assert.equal(legacy.contractVersion,undefined);
}));


test('portable JSON and run snapshots contain verified historical bytes and restore without original files',()=>fixture(async h=>{
  const entry=await h.task();
  const first=await h.publish(entry,'first immutable delivery');
  const second=await h.publish(entry,'second immutable delivery');
  const json=JSON.parse((await h.service.exportRoom(h.room.id,'json')).content);
  assert.equal(json.artifactContents.length,2);
  assert.equal(createHash('sha256').update(JSON.stringify({room:json.room,artifactContents:json.artifactContents})).digest('hex'),json.contentHash);
  const snapshot=JSON.parse((await h.service.snapshotRun(h.room.id,'artifact-fixture')).content);
  assert.equal(validateSnapshot(snapshot).ok,true);
  assert.deepEqual(snapshot.artifactContents,json.artifactContents);
  const missing=structuredClone(snapshot);delete missing.artifactContents;
  missing.contentHash=createHash('sha256').update(JSON.stringify({room:missing.room,events:missing.events,configHash:missing.configHash})).digest('hex');
  assert.equal(validateSnapshot(missing).ok,false);
  const corrupted=structuredClone(snapshot);corrupted.artifactContents[0].data=Buffer.from('not the recorded bytes').toString('base64');
  corrupted.contentHash=createHash('sha256').update(JSON.stringify({room:corrupted.room,events:corrupted.events,configHash:corrupted.configHash,artifactContents:corrupted.artifactContents})).digest('hex');
  await assert.rejects(h.service.restoreFromSnapshot(corrupted,{confirm:true}),/artifact snapshot/);
  await rm(h.service.artifactVersions.directory,{recursive:true,force:true});
  await assert.rejects(h.service.snapshotRun(h.room.id,'missing-content'),/ENOENT/);
  await h.service.restoreFromSnapshot(snapshot,{confirm:true});await h.reopen();
  assert.match((await h.service.readArtifactVersion(h.room.id,null,first.artifactRef)).content,/first immutable/);
  assert.match((await h.service.readArtifactVersion(h.room.id,null,second.artifactRef)).content,/second immutable/);
}));

test('artifact restore failure cannot roll back current work or install dangling references',()=>fixture(async h=>{
  let entry=await h.task();await h.publish(entry,'snapshotted');
  const snapshot=JSON.parse((await h.service.snapshotRun(h.room.id,'artifact-fixture')).content);
  entry=await h.service.updateLedgerEntry(h.room.id,entry.id,{acceptanceCriteria:'keep the current contract if restore fails'},{expectedRevision:entry.revision});
  await rm(h.service.artifactVersions.directory,{recursive:true,force:true});
  const publish=h.service.artifactVersions.publish.bind(h.service.artifactVersions);
  h.service.artifactVersions.publish=async()=>{throw new Error('simulated artifact capacity failure');};
  await assert.rejects(h.service.restoreFromSnapshot(snapshot,{confirm:true}),/artifact capacity failure/);
  assert.equal((await h.current(entry)).contractHash,entry.contractHash);
  h.service.artifactVersions.publish=publish;
  await h.service.restoreFromSnapshot(snapshot,{confirm:true});
  assert.notEqual((await h.current(entry)).contractHash,entry.contractHash);
}));


test('ledger history restore keeps legacy unfixed and reopens fixed work without obsolete acceptance',()=>fixture(async h=>{
  let legacy=await h.task({contractVersion:undefined});
  legacy=await h.service.updateLedgerEntry(h.room.id,legacy.id,{details:'changed'},{expectedRevision:legacy.revision});
  legacy=await h.service.restoreLedgerEntry(h.room.id,legacy.id,{revision:1,expectedRevision:legacy.revision});
  assert.equal(legacy.contractVersion,undefined);
  let modern=await h.task({integration:true,allowPartialDelivery:true});
  modern=await h.service.updateLedgerEntry(h.room.id,modern.id,{details:'new scope'},{expectedRevision:modern.revision});
  modern=await h.service.restoreLedgerEntry(h.room.id,modern.id,{revision:1,expectedRevision:modern.revision});
  assert.equal(modern.contractVersion,1);assert.equal(modern.status,'open');assert.deepEqual(modern.inputRefs,[]);
  assert.equal(modern.integration,true);assert.equal(modern.allowPartialDelivery,true);assert.equal(modern.review,undefined);
}));

for (const actor of ['submit','reviewer','human']) test(`${actor} does not acknowledge work replaced by a restore while its saved response is pending`,()=>fixture(async h=>{
  let entry=await h.task(),source=await h.activate();entry=await h.acknowledge(entry,source);
  const published=await h.publish(entry);
  if(actor!=='submit')entry=await h.submit(entry,source,published.artifactRef);
  if(actor==='reviewer')source=await h.activate('reviewer');
  const snapshot=JSON.parse((await h.service.snapshotRun(h.room.id,`before-${actor}`)).content),previousStatus=entry.status;
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const commit=h.service.journal.commit.bind(h.service.journal);let armed=true;
  h.service.journal.commit=async state=>{const result=await commit(state);if(armed&&state.rooms.find(room=>room.id===h.room.id)?.ledger.find(item=>item.id===entry.id)?.status===(actor==='submit'?'in_review':'done')){armed=false;entered();await held;}return result;};
  const pending=actor==='submit'?h.submit(entry,source,published.artifactRef):actor==='reviewer'?h.review(entry,source):h.service.updateLedgerEntry(h.room.id,entry.id,{status:'done',expectedContractHash:entry.contractHash,expectedSubmissionRevision:entry.submission.revision,artifactRefs:entry.submission.artifactRefs},{expectedRevision:entry.revision});
  pending.catch(()=>{});
  try{await ready;await h.service.restoreFromSnapshot(snapshot,{confirm:true});release();await assert.rejects(pending,/superseded|interrupted|changed/i);assert.equal((await h.current(entry)).status,previousStatus);}
  finally{release();h.service.journal.commit=commit;await Promise.allSettled([pending]);}
}));

test('publication response retains its committed contract when a later contract update overtakes its response',()=>fixture(async h=>{
  let entry=await h.task();const publishedHash=entry.contractHash;
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const commit=h.service.journal.commit.bind(h.service.journal);let armed=true;
  h.service.journal.commit=async state=>{const result=await commit(state);if(armed&&state.rooms.find(room=>room.id===h.room.id)?.artifacts.some(artifact=>artifact.publications?.length)){armed=false;entered();await held;}return result;};
  const pending=h.publish(entry);pending.catch(()=>{});
  try{await ready;entry=await h.service.updateLedgerEntry(h.room.id,entry.id,{acceptanceCriteria:'A later contract needs different evidence'},{expectedRevision:entry.revision});release();const result=await pending;
    assert.notEqual(entry.contractHash,publishedHash);assert.equal(result.contractHash,publishedHash);assert.equal(result.artifact.publications[0].contractHash,publishedHash);
    assert.equal((await h.service.readArtifactVersion(h.room.id,null,result.artifactRef)).artifactRef.contentHash,result.artifactRef.contentHash);
  }finally{release();h.service.journal.commit=commit;await Promise.allSettled([pending]);}
}));
