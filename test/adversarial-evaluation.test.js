import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventLog} from '../lib/event-log.js';
import {evaluate} from '../scripts/relationship-eval.mjs';

async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'dcl-eval-adversarial-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const statePath=join(directory,'rooms.json'),log=new EventLog(statePath);
  async function run(roomId,patch={},member='s1',{omitMember=false,omitModelObservation=false}={}){
    const model={provider:'test',model:'test'},config={version:2,personalMemory:{enabled:true}};
    const append=(type,payload,tick)=>log.append(roomId,{type,payload,tick,provenance:{roomId}});
    await append('run.manifest',{arm:'persistent',configHash:'fixed',initialStateVersion:17,startedAtTick:0,models:{s1:model,s2:model},config},0);
    await append('injection.cost',{deliveryId:'delivery',digestChars:10,configHash:'fixed',memberSessionId:'s1',
      modelAtDelivery:model,...(omitModelObservation?{}:{modelObservation:'before-delivery'}),
      memorySampleStatus:'available',personalMemoryStatus:'available',...patch},1);
    await append('delivery.settled',{deliveryId:'delivery',...(omitMember?{}:{member}),status:'delivered'},2);
  }
  return {statePath,run};
}

test('explicit unavailable or inconsistent memory treatments cannot be certified as checked interactions',async t=>{
  const h=await fixture(t);
  const cases=[{personalMemoryStatus:'unavailable'},{personalMemoryStatus:'disabled'},
    {personalMemoryStatus:null},{personalMemoryStatus:'invented'},
    {memorySampleStatus:null},{memorySampleStatus:'invented'},{modelObservation:'after-delivery'}];
  for(const [n,input] of cases.entries())await h.run(`invalid-${n}`,input);
  await h.run('valid');
  const result=await evaluate({statePath:h.statePath,observation:true});
  assert.deepEqual(result.runs.map(run=>run.roomId),['valid']);
  assert.equal(result.invalid.length,cases.length);
  assert.equal(result.dataQuality,'partial');
});

test('an injection for one member cannot count another member delivery as its reached interaction',async t=>{
  const h=await fixture(t);await h.run('mismatched-recipient',{},'s2');
  const report=await evaluate({statePath:h.statePath,observation:true});
  assert.equal(report.runs.length,0);assert.equal(report.invalid.length,1);
  assert.match(report.invalid[0].reason,/member|recipient/);
});

test('explicit malformed delivery recipients are excluded instead of bypassing recipient validation',async t=>{
  const h=await fixture(t),members=[null,{},[],0,''];
  for(const [n,member] of members.entries())await h.run(`malformed-${n}`,{},member);
  await h.run('valid');
  const report=await evaluate({statePath:h.statePath,observation:true});
  assert.deepEqual(report.runs.map(run=>run.roomId),['valid']);
  assert.equal(report.invalid.length,members.length);
  assert.ok(report.invalid.every(row=>/member|recipient/.test(row.reason)));
  assert.equal(report.dataQuality,'partial');
});

test('missing legacy recipient or observation time remains descriptive with unverified coverage',async t=>{
  const h=await fixture(t);
  await h.run('legacy-recipient',{},'s1',{omitMember:true});
  await h.run('legacy-time',{},'s1',{omitModelObservation:true});
  await h.run('legacy-both',{},'s1',{omitMember:true,omitModelObservation:true});
  await h.run('verified');
  const report=await evaluate({statePath:h.statePath,observation:true});
  assert.deepEqual(report.invalid,[]);
  assert.equal(report.runs.length,4);
  assert.ok(report.runs.every(run=>run.analysable));
  for(const run of report.runs)assert.equal(run.contractCoverage,
    run.roomId==='verified'?'per-injection-checked':'legacy-unverified',run.roomId);
  assert.equal(report.contractCoverage,'legacy-unverified');
  assert.equal(report.groups[0].contractCoverage,'legacy-unverified');
  assert.equal(report.assertsConclusions,false);
});
