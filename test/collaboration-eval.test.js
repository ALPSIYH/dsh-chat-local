import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CASES,ARMS,summarize,sampleStats,scoreAnswer,runEvaluation,runTrial,commandAdapter,compactEvaluationRequest} from '../scripts/collaboration-eval.mjs';

async function directory(t){const path=await mkdtemp(join(tmpdir(),'dcl-collaboration-eval-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
test('sample variance uses n-1 and a missing or wrong answer cannot disappear from the scoring denominator',()=>{
  assert.deepEqual(sampleStats([0,1]),{n:2,mean:0.5,sampleVariance:0.5});
  assert.equal(sampleStats([1]).sampleVariance,null);assert.equal(sampleStats([]).mean,null);
  assert.equal(scoreAnswer(CASES[0].id,null).omitted.length,4);
  assert.equal(scoreAnswer(CASES[0].id,{...CASES[0].expected,numericScore:90}).correct,false);
  assert.equal(scoreAnswer(CASES[1].id,{...CASES[1].expected,requiresPeerConsent:true}).correct,false);
});
function projectionFixture(){
  const ledger={id:'task',revision:9,contractHash:'contract-new',acceptanceCriteria:'N=12; missing data cannot receive a score',inputRefs:[{kind:'artifact',artifactId:'source',versionId:'v2',contentHash:'source-hash'}],submission:{revision:8,artifactRefs:[{artifactId:'answer',versionId:'v3',contentHash:'answer-hash'}]},history:['superseded-record'],recentActivity:['duplicate-audit']};
  const memory={roomId:'room',ledger:[ledger],myWork:[ledger],messages:[{id:'seen',text:'Full message already delivered',author:'human:me'},{id:'partial',text:'Partially visible message with critical correction N=12',correctsMessageId:'seen',roomSeq:7},{id:'unseen',text:'Previously unseen disagreement'}],collaboration:{requests:[{id:'resolved-request',state:'done',history:'old'}],budgetAccounts:[{id:'budget',maxExecutions:6,maxPerMember:4,reservations:[{state:'charged',privateReceipt:'old-receipt'},{state:'released'},{state:'unknown'}]}],unreviewed:[{messageId:'unseen'}],pendingCount:1}};
  const delivery='Actual prompt\n[messageId=seen]\nFull message already delivered\n[messageId=partial]\nPartially visible message';
  const fixed='{"sampleSize":12,"numericScore":null}',pending=[{id:'review',revision:3,state:'pending',workId:'task',basisVersion:'contract-new',submissionRevision:8,reviewMemory:{sourceIds:['partial']},attempts:['old-attempt']}];
  return {schemaVersion:1,messages:[{role:'system',content:'Output complete JSON.'},{role:'user',content:`${delivery}\n\n本人本次 chat_memory 讀取：\n${JSON.stringify(memory)}\n\n当前固定交付：\n${fixed}\n\n本人待處置請求：\n${JSON.stringify(pending)}`}],context:{pendingRequests:[{id:'review'}]}};
}
test('context projection removes exact duplicate transcripts and historical receipts while preserving corrections, contracts and fixed bytes',()=>{
  const input=projectionFixture(),before=structuredClone(input),{request,stats}=compactEvaluationRequest(input);
  const parts=request.messages[1].content.split(/\n\n(?:本人本次 chat_memory 讀取：|当前固定交付：|本人待處置請求：)\n/u),memory=JSON.parse(parts[1]),pending=JSON.parse(parts[3]);
  assert.deepEqual(input,before,'projection must not mutate saved evidence');
  assert.equal(parts[0],before.messages[1].content.split('\n\n本人本次')[0]);
  assert.equal(parts[2],'{"sampleSize":12,"numericScore":null}');
  assert.deepEqual(stats.deduplicatedMessageIds,['seen']);assert.deepEqual(stats.additionalMessageIds,['partial','unseen']);
  assert.equal(memory.messages[0].text,'Partially visible message with critical correction N=12');assert.equal(memory.messages[0].correctsMessageId,'seen');
  assert.equal(memory.ledger[0].contractHash,'contract-new');assert.equal(memory.ledger[0].acceptanceCriteria,'N=12; missing data cannot receive a score');
  assert.equal(memory.ledger[0].inputRefs[0].contentHash,'source-hash');assert.equal(memory.ledger[0].submission.artifactRefs[0].contentHash,'answer-hash');
  assert.equal(memory.ledger[0].history,undefined);assert.equal(memory.myWork,undefined);assert.equal(memory.collaboration.requests,undefined);
  assert.deepEqual(memory.collaboration.unreviewed,[{messageId:'unseen'}]);assert.equal(memory.collaboration.budgetAccounts[0].chargedExecutions,2);assert.equal(memory.collaboration.budgetAccounts[0].unknownExecutions,1);
  assert.equal(pending[0].attempts,undefined);assert.deepEqual(pending[0].reviewMemory,{sourceIds:['partial']});assert.equal(pending[0].basisVersion,'contract-new');
  assert.equal(request.context.replyMaxChars,600);assert.equal(stats.afterBytes,Buffer.byteLength(JSON.stringify(request)));
});
test('context projection fails closed without cutting oversized essential evidence or accepting missing sections',()=>{
  const request=projectionFixture();request.messages[1].content=request.messages[1].content.replace('{"sampleSize":12,"numericScore":null}','甲'.repeat(50_000));
  assert.throws(()=>compactEvaluationRequest(request),/essential evaluation context exceeds 50000/);
  assert.throws(()=>compactEvaluationRequest({messages:[{role:'user',content:'no fixed sections'}]}),/sections cannot be identified/);
});
test('both failure shapes run through real RoomStore under the same cap and preserve snapshots, failures and raw calls',async t=>{
  const output=await directory(t),result=await runEvaluation({output,repetitions:1,budget:6});
  assert.equal(result.results.length,6);assert.equal(result.summary.mode,'scripted-replay');
  for(const row of result.results){
    assert.equal(row.metrics.correct,1,`${row.trialId}: ${JSON.stringify(row.failures)}`);
    assert.ok(row.metrics.dispatches<=6);assert.ok(row.metrics.adapterCalls<=row.metrics.dispatches);
    assert.equal(row.metrics.fixedDelivery,1);assert.equal(row.score.omitted.length,0);
    assert.ok(row.answers.filter(answer=>answer.phase===0).every(answer=>answer.score.status==="initial_phase_not_scored_against_late_correction"));
    const dir=join(output,row.caseId,String(row.repetition),row.arm);
    const saved=JSON.parse(await readFile(join(dir,'room.snapshot.json'),'utf8'));
    assert.ok(saved.artifactContents.length>=1);
    const calls=(await readFile(join(dir,'calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(calls.filter(item=>item.kind==='dispatch').length,row.metrics.adapterCalls);
    assert.ok(calls.filter(item=>item.kind==='response').every(item=>item.result.response.metadata.synthetic));
  }
  for(const scenario of CASES){const legacy=result.results.find(row=>row.caseId===scenario.id&&row.arm==='legacy');assert.ok(legacy.metrics.duplicateReplies>0);}
  assert.ok(result.summary.groups.every(group=>group.metrics.correct.n===1&&group.metrics.correct.sampleVariance===null));
  await assert.rejects(runEvaluation({output,repetitions:1,budget:6}),{code:'EEXIST'});
});
test('failed adapter calls remain in the trial with omitted answers and no invented token usage or success',async t=>{
  const dir=await directory(t);let calls=0;
  const result=await runTrial({directory:dir,caseId:CASES[0].id,arm:'single',budget:4,adapter:async()=>{calls++;return{status:'failed',failure:'provider rejected',elapsedMs:1};}});
  assert.equal(result.metrics.correct,0);assert.equal(result.metrics.omitted,4);assert.equal(result.metrics.adapterCalls,calls);
  assert.ok(result.failures.length>=2);assert.equal(result.metrics.fixedDelivery,0);assert.equal(result.metrics.accepted,0);
  assert.equal(result.usage.inputTokens,null);
  const group=summarize([result]).groups[0];assert.equal(group.failedTrials,1);assert.equal(group.metrics.correct.n,1);assert.equal(group.metrics.correct.mean,0);
  const log=await readFile(join(dir,'calls.jsonl'),'utf8');assert.match(log,/provider rejected/);
});
test('a real subprocess adapter receives the same messages and can drive the same fixed-delivery scenario',async t=>{
  const output=await directory(t),adapter=join(output,'adapter.mjs');
  await writeFile(adapter,`import {scriptedAdapter} from ${JSON.stringify(new URL('../scripts/collaboration-eval.mjs',import.meta.url).href)};\nlet input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);if(!request.messages?.length)throw Error('missing messages');const result=await scriptedAdapter(request);result.response.metadata={synthetic:true,subprocessFixture:true,providerRequests:0};process.stdout.write(JSON.stringify(result.response));`);
  const result=await runEvaluation({output:join(output,'run'),repetitions:1,budget:4,cases:[CASES[1].id],arms:['single'],command:[process.execPath,adapter],model:'subprocess-fixture',parameters:{temperature:0}});
  assert.equal(result.summary.mode,'contains-model-adapter');assert.equal(result.results[0].metrics.correct,1);assert.equal(result.results[0].metrics.fixedDelivery,1);
  const log=await readFile(join(output,'run',CASES[1].id,'0','single','calls.jsonl'),'utf8');assert.match(log,/subprocessFixture/);
});
test('adapter timeout and malformed output return auditable failures without hanging',async()=>{
  const request={trialId:'test',messages:[]};
  const timeout=await commandAdapter([process.execPath,'-e','setTimeout(()=>{},30000)'],request,{timeoutMs:25});assert.equal(timeout.failure,'timeout');
  const malformed=await commandAdapter([process.execPath,'-e','process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("not-json"))'],request,{timeoutMs:3000});
  assert.equal(malformed.status,'failed');assert.equal(malformed.rawStdout,'not-json');
  const truncated=await commandAdapter([process.execPath,'-e','process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({text:"{}",complete:true,finishReason:"max-tokens"})))'],request,{timeoutMs:3000});
  assert.equal(truncated.status,'failed');assert.equal(truncated.failure,'incomplete_response');
});
