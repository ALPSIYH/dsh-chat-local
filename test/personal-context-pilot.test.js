import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPilot,parseArms,CASES} from '../scripts/personal-context-pilot.mjs';

const baselineModule=fileURLToPath(new URL('../lib/room-store.js',import.meta.url));
const response=()=>({text:JSON.stringify({releaseDay:'Friday',publicationAuthorized:false,unseenCode:'unknown',plan:'Verify the current source.'}),complete:true,finishReason:'stop',model:'fake-for-test-only',usage:{totalTokens:1}});

test('personal pilot validates arm selection and preserves the historical two-arm default',()=>{
 assert.deepEqual(parseArms(),['baseline','candidate']);
 assert.deepEqual(parseArms('none,baseline,candidate'),['none','baseline','candidate']);
 for(const value of ['',[],['none','none'],['unknown']])assert.throws(()=>parseArms(value),/arms must/);
});

test('three-arm pilot actually disables memory recall while retaining the same persona and identity',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'personal-arms-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const requests=[];
 const report=await runPilot({outputDirectory:directory,baselineModule,cases:[CASES[0]],maxCalls:3,arms:parseArms('none,baseline,candidate'),adapter:async request=>{requests.push(request);return response();}});
 assert.deepEqual(requests.map(item=>item.trialId.split('/')[1]),['none','baseline','candidate']);
 assert.ok(requests.every(item=>item.messages[0].content.includes('<agent_persona>')));
 const persona=content=>content.match(/<agent_persona>([\s\S]*?)<\/agent_persona>/)?.[1];
 assert.equal(persona(requests[0].messages[0].content),persona(requests[2].messages[0].content));
 assert.match(requests[0].messages[0].content,/持續 Agent 身分/);
 assert.doesNotMatch(requests[0].messages[0].content,/ORION releaseDay|ORION correction|Fruit inventory unrelated|LANTERN-739/);
 assert.match(requests[2].messages[0].content,/ORION correction/);
 assert.ok(requests.every(item=>item.messages[1].content===CASES[0].prompt));
 const prompts=JSON.parse(await readFile(join(directory,'prompts.json'),'utf8'));
 const treatment=prompts[0].contextTreatment;
 assert.equal(treatment.personalMemory,false);assert.equal(treatment.recallStatus,'disabled');
 assert.equal(treatment.personaSupplied,true);assert.equal(treatment.persona,'retained');assert.equal(treatment.identitySupplied,true);assert.equal(treatment.learningHintSupplied,true);
 assert.equal(treatment.seedEpisodesAbsentVerified,true);assert.ok(treatment.suppliedContextChars>0);
 assert.equal(treatment.nativeContext,'actual-nativeAgentContext');
 assert.equal(report.byArm.none.attempts,1);assert.equal(report.invocations,3);assert.equal(report.totalTokens,3);assert.equal(report.conclusive,false);
 assert.match(report.armDefinitions.none.interpretation,/personal-memory ablation/);
 const results=JSON.parse(await readFile(join(directory,'results.json'),'utf8'));
 assert.deepEqual(results[0].contextTreatment,treatment);assert.ok(results.every(item=>item.response.model==='fake-for-test-only'));
});

test('omitting arms runs only baseline and candidate without silently adding a model request',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'personal-default-arms-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const requests=[];
 const report=await runPilot({outputDirectory:directory,baselineModule,cases:[CASES[0]],maxCalls:2,adapter:async request=>{requests.push(request);return response();}});
 assert.deepEqual(report.arms,['baseline','candidate']);assert.equal(report.byArm.none,undefined);
 assert.deepEqual(requests.map(item=>item.trialId.split('/')[1]),['baseline','candidate']);assert.equal(report.invocations,2);
});


test('personal pilot exclusively claims an empty run directory and never overwrites old evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'personal-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const legacy=join(root,'legacy');await mkdir(legacy);
 const originals={'prompts.json':'original prompts','results.json':'original results','report.json':'original report'};
 for(const [name,content] of Object.entries(originals))await writeFile(join(legacy,name),content);
 let calls=0;const options={baselineModule,cases:[CASES[0]],maxCalls:1,arms:['none'],adapter:async()=>{calls++;return response();}};
 await assert.rejects(runPilot({...options,outputDirectory:legacy}),/empty|existing|already|overwrite/);
 for(const [name,content] of Object.entries(originals))assert.equal(await readFile(join(legacy,name),'utf8'),content);
 assert.equal(calls,0);
 const fresh=join(root,'new');await mkdir(fresh);
 const concurrent=await Promise.allSettled([runPilot({...options,outputDirectory:fresh}),runPilot({...options,outputDirectory:fresh})]);
 assert.equal(concurrent.filter(item=>item.status==='fulfilled').length,1);assert.equal(concurrent.filter(item=>item.status==='rejected').length,1);assert.equal(calls,1);
 const saved=Object.fromEntries(await Promise.all(['manifest.json','prompts.json','results.json','report.json'].map(async name=>[name,await readFile(join(fresh,name),'utf8')])));
 assert.equal(JSON.parse(saved['manifest.json']).suite,'personal-context-pilot');
 await assert.rejects(runPilot({...options,outputDirectory:fresh}),/empty|existing|already|overwrite/);
 assert.equal(calls,1);for(const [name,content] of Object.entries(saved))assert.equal(await readFile(join(fresh,name),'utf8'),content);
});

test('throwing adapter preserves its input, failed result and unknown usage report then stops all later calls',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'personal-failed-adapter-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seen=[];
 const report=await runPilot({outputDirectory:directory,baselineModule,cases:CASES.slice(0,2),maxCalls:6,arms:['none','baseline','candidate'],adapter:async request=>{seen.push(structuredClone(request));throw Object.assign(new Error('synthetic adapter outcome is unknown'),{code:'E_FAKE_TRANSPORT'});}});
 assert.equal(seen.length,1);assert.equal(report.invocations,1);assert.equal(report.usageMissing,true);assert.equal(report.totalTokensKnown,false);assert.equal(report.stopReason,'adapter_error');assert.equal(report.failedInvocations,1);assert.equal(report.conclusive,false);
 const prompts=JSON.parse(await readFile(join(directory,'prompts.json'),'utf8')),results=JSON.parse(await readFile(join(directory,'results.json'),'utf8'));
 assert.equal(prompts.length,1);assert.deepEqual(prompts[0].request,seen[0]);assert.equal(results.length,1);
 assert.equal(results[0].failed,true);assert.equal(results[0].response.complete,false);assert.equal(results[0].response.finishReason,'adapter-error');assert.equal(results[0].response.usage,null);assert.equal(results[0].score.passed,false);
 assert.equal(results[0].response.error.message,'synthetic adapter outcome is unknown');assert.equal(results[0].response.error.code,'E_FAKE_TRANSPORT');
 assert.deepEqual(JSON.parse(await readFile(join(directory,'report.json'),'utf8')),report);assert.equal(report.byArm.baseline.attempts,0);assert.equal(report.byArm.candidate.attempts,0);
});
