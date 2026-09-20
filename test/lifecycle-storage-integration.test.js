import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshChatLocalService } from '../lib/room-store.js';
import { EventLog, eventLogPath } from '../lib/event-log.js';

const run = promisify(execFile);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
async function waitFor(predicate) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('integration fixture did not reach its intended boundary');
}
async function setup(t,{storage,withAgent=true}={}) {
  const directory=await mkdtemp(join(tmpdir(),'dcl-lifecycle-storage-')),calls=[];
  const ctx={agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>calls.push({from,to,text,delivery})},get(name){return this[name];}};
  const service=new DshChatLocalService(ctx,{path:join(directory,'rooms.json'),storage,maxRounds:1,replyTimeoutMs:5000});await service.ready;
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const agent=withAgent?await service.directory.save({profile:{alias:'A'},operationId:'a'}):null;
  const room=await service.createRoom({name:'fixture',autoDeliver:false,members:agent?[{kind:'session',sessionId:'a',alias:'A',agentId:agent.id}]:[]});
  return {directory,service,agent,room,calls};
}

test('the service preserves omitted recall counts when adding public response metadata',async t=>{
  const {service}=await setup(t);
  for(let i=0;i<12;i++)await service.observeSessionEvent('a',{type:'user/message',data:{message:{id:`source-${i}`,content:[{type:'text',text:`distinct observation ${i}`}]}}});
  const result=await service.agentMemory('a',{limit:3});
  assert.equal(result.experiences.length,3);assert.equal(result.totals.experiences,12);
  assert.equal(result.coverage.omittedByBudget,9,'the second response bound must not erase the first bound\'s omissions');
});

for(const boundary of ['persona-read','persona-rename'])test(`shutdown joins a persona edit held at ${boundary}, including work not admitted yet`,async t=>{
  const {service,agent}=await setup(t),persona=await service.directory.persona(agent.id);
  const reached=deferred(),release=deferred(),method=boundary==='persona-read'?'readFile':'rename',original=fs.promises[method];
  let saving,closing,blocked=false,closed=false;
  try{
    fs.promises[method]=async(...args)=>{
      if(!blocked && (boundary==='persona-read'?args[0]===persona.path:args[1]===persona.path)){blocked=true;reached.resolve();await release.promise;}
      return original(...args);
    };syncBuiltinESMExports();
    saving=service.directory.savePersona(agent.id,{markdown:'# Completed edit',expectedHash:persona.hash});saving.catch(()=>{});await reached.promise;
    closing=service.close().then(()=>{closed=true;});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(closed,false,'close must wait for a previously started persona operation');
    release.resolve();await Promise.allSettled([saving]);await closing;
    const settled=await readFile(persona.path);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await readFile(persona.path),settled);
    await assert.rejects(service.directory.savePersona(agent.id,{markdown:'# Too late',expectedHash:persona.hash}),/closed/i);
    await assert.rejects(service.directory.persona(agent.id),/closed/i);
  }finally{release.resolve();fs.promises[method]=original;syncBuiltinESMExports();await Promise.allSettled([saving,closing]);}
});

test('shutdown joins startup recovery before returning; migration cannot begin afterward',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dcl-startup-close-')),path=join(directory,'rooms.json');await writeFile(path,JSON.stringify({version:15,rooms:[]}));
  const reached=deferred(),release=deferred(),original=fs.promises.readFile;let service,closing,blocked=false,closed=false;
  try{
    fs.promises.readFile=async(...args)=>{if(!blocked&&args[0]===path){blocked=true;reached.resolve();await release.promise;}return original(...args);};syncBuiltinESMExports();
    service=new DshChatLocalService({}, {path});await reached.promise;closing=service.close().then(()=>{closed=true;});
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(closed,false,'startup still owns future persistence obligations');
    release.resolve();await service.ready;await closing;const settled=await original(path);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await original(path),settled);
  }finally{release.resolve();fs.promises.readFile=original;syncBuiltinESMExports();await Promise.allSettled([service?.ready,closing]);await service?.close();await rm(directory,{recursive:true,force:true});}
});

test('migration backup must be admitted before a new backup consumes the hard limit',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dcl-migration-quota-')),path=join(directory,'rooms.json'),raw=JSON.stringify({version:15,rooms:[]});await writeFile(path,raw);
  const service=new DshChatLocalService({}, {path,storage:{hardBytes:Buffer.byteLength(raw)+8,softBytes:Buffer.byteLength(raw),recoveryReserveBytes:0,minFreeBytes:0}});
  try{await assert.rejects(service.ready,/capacity/i);assert.equal(await readFile(path,'utf8'),raw);await assert.rejects(stat(`${path}.v15.bak`),{code:'ENOENT'});}
  finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test('restore backup is new work and cannot borrow recovery capacity or overwrite state on refusal',async t=>{
  const hardBytes=1024*1024,recoveryReserveBytes=10000;
  const {directory,service,room}=await setup(t,{withAgent:false,storage:{hardBytes,softBytes:hardBytes/2,recoveryReserveBytes,minFreeBytes:0}});
  const snapshot=JSON.parse((await service.snapshotRun(room.id,'fixture')).content),raw=await readFile(service.path),used=(await service.capacity.refresh()).usedBytes;
  await writeFile(join(directory,'quota-fixture.bin'),Buffer.alloc(hardBytes-recoveryReserveBytes-used-Math.floor(raw.length/2)));
  await assert.rejects(service.restoreFromSnapshot(snapshot,{confirm:true}),/capacity/i);
  await assert.rejects(stat(`${service.path}.pre-restore.bak`),{code:'ENOENT'});
  assert.deepEqual(await readFile(service.path),raw);
});

test('exports share normal storage admission and never write through the hard limit',async t=>{
  const hardBytes=200000,recoveryReserveBytes=1000;
  const {directory,service,room}=await setup(t,{withAgent:false,storage:{hardBytes,softBytes:100000,recoveryReserveBytes,minFreeBytes:0}});
  const exported=await service.exportRoom(room.id),used=(await service.capacity.refresh()).usedBytes;
  await writeFile(join(directory,'quota-fixture.bin'),Buffer.alloc(hardBytes-recoveryReserveBytes-used-Math.floor(Buffer.byteLength(exported.content)/2)));
  await assert.rejects(service.saveRoomExport(room.id),/capacity/i);
  assert.ok((await service.capacity.refresh()).usedBytes<=hardBytes-recoveryReserveBytes);
});

test('an active reset episode can recall a newly recorded own belief backed by its current observation',async t=>{
  const {service,room,calls}=await setup(t);
  await service.startRun(room.id,{arm:'reset_per_episode',appliedBy:'human'});
  await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'current episode evidence',mentions:['a']});
  const call=await waitFor(()=>calls[0]);
  await service.observeSessionEvent('a',{type:'turn/start',data:{turn:1}});
  await service.observeSessionEvent('a',{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]`}]}});
  try{
    const original=await service.agentMemory('a'),item=original.experiences.find(item=>item.text.includes('current episode evidence'));assert.ok(item);
    const input={action:'belief',operationId:'episode-claim',claim:'This episode currently supports a tentative claim.',evidence:[{sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId}]};
    const stored=await service.updatePersonalMemory('a',input),retry=await service.updatePersonalMemory('a',input);assert.equal(retry.eventId,stored.eventId);
    const current=await service.agentMemory('a');assert.equal(current.beliefs.length,1);assert.equal(current.beliefs[0].beliefId,stored.beliefId);assert.equal(current.beliefs[0].claim,input.claim);
  }finally{
    await service.observeSessionEvent('a',{type:'assistant/message',data:{turn:1,step:1,message:{content:[{type:'text',text:'(pass)'}]}}});
    await service.observeSessionEvent('a',{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
  }
});

test('offline verifier and evaluation enumerate and read cold sources without thawing or changing evidence',async t=>{
  const {service,room}=await setup(t,{withAgent:false});
  await service.startRun(room.id,{arm:'persistent',appliedBy:'human'});
  await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'stored experiment fixture',automaticDelivery:false});
  await service.journal.settled();
  const verify=fileURLToPath(new URL('../scripts/verify-event-log.mjs',import.meta.url)),evaluate=fileURLToPath(new URL('../scripts/relationship-eval.mjs',import.meta.url));
  const args=[evaluate,'--state',service.path,'--observation','--json'];
  const before=JSON.parse((await run(process.execPath,args)).stdout),count=(await service.eventsFor(room.id)).length;
  await service.eventLog.archive(room.id);const marker=await readFile(`${eventLogPath(service.path,room.id)}.cold`);
  const checked=JSON.parse((await run(process.execPath,[verify,room.id,'--state',service.path])).stdout);
  assert.equal(checked.ok,true);assert.equal(checked.lines,count);
  const after=JSON.parse((await run(process.execPath,args)).stdout);assert.deepEqual(after,before);
  assert.deepEqual(await readFile(`${eventLogPath(service.path,room.id)}.cold`),marker);assert.equal((await stat(eventLogPath(service.path,room.id))).size,0);
  assert.equal((await new EventLog(service.path).read(room.id)).length,count);
});

test('suppressing a current reset-episode observation takes effect in that same episode',async t=>{
  const {service,room,calls}=await setup(t);
  await service.startRun(room.id,{arm:'reset_per_episode',appliedBy:'human'});
  await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'current episode suppressible evidence',mentions:['a']});
  const call=await waitFor(()=>calls[0]);
  await service.observeSessionEvent('a',{type:'turn/start',data:{turn:1}});
  await service.observeSessionEvent('a',{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]`}]}});
  try{
    const item=(await service.agentMemory('a')).experiences.find(item=>item.text.includes('current episode suppressible evidence'));assert.ok(item);
    const stored=await service.updatePersonalMemory('a',{action:'suppress',operationId:'suppress-this-episode',sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId});assert.equal(stored.recorded,true);
    const recalled=await service.agentMemory('a',{query:'current episode suppressible evidence'});
    assert.ok(!recalled.experiences.some(value=>value.evidenceId===item.evidenceId),'acknowledged suppression must take effect in the context that accepted it');
  }finally{
    await service.observeSessionEvent('a',{type:'assistant/message',data:{turn:1,step:1,message:{content:[{type:'text',text:'(pass)'}]}}});
    await service.observeSessionEvent('a',{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
  }
});
