import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCapacity } from '../lib/storage-capacity.js';
import { EventLog } from '../lib/event-log.js';
import { RoomJournal } from '../lib/room-journal.js';
const temp = async t => { const dir = await mkdtemp(join(tmpdir(),'dcl-capacity-')); t.after(() => rm(dir,{recursive:true,force:true})); return dir; };
test('one global admission reserves cross-room writes atomically and never exceeds hard capacity', async t => {
  const dir = await temp(t), capacity = new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:1000,softBytes:700,recoveryReserveBytes:100,minFreeBytes:0});
  const results = await Promise.allSettled(Array.from({length:10},(_,i)=>capacity.run({peakBytes:200},()=>writeFile(join(dir,`${i}.bin`),Buffer.alloc(200)))));
  const accepted=results.filter(r=>r.status==='fulfilled').length;
  assert.ok(accepted>=1 && accepted<=4);
  assert.equal((await capacity.refresh()).usedBytes,accepted*200);
  assert.equal(capacity.health().reservedBytes,0);
  assert.ok(capacity.health().rejected >= 6);
});
test('recovery can spend reserved space while ordinary writes and overstated peaks are rejected', async t => {
 const dir=await temp(t),capacity=new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:1000,softBytes:700,recoveryReserveBytes:300,minFreeBytes:0});
 await capacity.run({peakBytes:650},()=>writeFile(join(dir,'a'),Buffer.alloc(650)));
 await assert.rejects(capacity.run({peakBytes:100},()=>{}),e=>e.code==='STORAGE_CAPACITY');
 await capacity.run({peakBytes:100,recovery:true},()=>writeFile(join(dir,'b'),Buffer.alloc(100)));
 assert.equal((await capacity.refresh()).usedBytes,750);
 assert.throws(()=>capacity.run({peakBytes:-1},()=>{}),/peakBytes/);
});
test('failure releases reservation and exposes ENOSPC without claiming successful persistence', async t => {
 const dir=await temp(t),capacity=new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:1000,softBytes:700,recoveryReserveBytes:100,minFreeBytes:0});
 await assert.rejects(capacity.run({peakBytes:100},()=>{ throw Object.assign(new Error('private/path'),{code:'ENOSPC'}); }),{code:'ENOSPC'});
 assert.equal(capacity.health().reservedBytes,0);
 assert.equal(capacity.health().lastError,'ENOSPC');
 await capacity.run({peakBytes:1},()=>writeFile(join(dir,'a'),'x'));
 assert.equal(capacity.health().lastError,null);
});
test('event and journal writers share capacity admission and keep failed state unchanged', async t => {
 const dir=await temp(t),path=join(dir,'rooms.json'),capacity=new StorageCapacity({statePath:path,hardBytes:10000,softBytes:7000,recoveryReserveBytes:1000,minFreeBytes:0});
 const events=new EventLog(path,{capacity}),room={id:'r'},journal=new RoomJournal({path,events,capacity,currentRoom:()=>room});
 await journal.commit({rooms:[room]}); const before=await readFile(path);
 await assert.rejects(journal.commit({rooms:[room],large:'x'.repeat(20000)}),{code:'STORAGE_CAPACITY'});
 assert.deepEqual(await readFile(path),before);
 assert.equal(await events.append('r',{type:'large',payload:{text:'x'.repeat(20000)}}),null);
 assert.equal((await stat(path)).isFile(),true);
});
test('per-agent observation quota survives restart, separates agents, and cannot be evaded by cold storage',async t=>{
 const dir=await temp(t),path=join(dir,'rooms.json'),options={statePath:path,hardBytes:1000000,softBytes:700000,recoveryReserveBytes:10000,minFreeBytes:0,agentObservationBytes:1200};
 let capacity=new StorageCapacity(options),log=new EventLog(path,{capacity});
 const observed=id=>({type:'memory.observed',payload:{observerAgentId:id,text:'x'.repeat(400)}});
 assert.ok(await log.append('r',observed('a')));assert.equal(await log.append('other',observed('a')),null);
 assert.equal(capacity.health().lastError,'AGENT_STORAGE_CAPACITY');assert.ok(await log.append('other',observed('b')));
 await log.archive('r');capacity=new StorageCapacity(options);log=new EventLog(path,{capacity});
 assert.equal(await log.append('third',observed('a')),null);assert.equal(capacity.health().lastError,'AGENT_STORAGE_CAPACITY');
 assert.ok(capacity.health().agentObservationBytes.a>0);
});
test('a suspended room write retains its reservation without blocking an unrelated admitted write',async t=>{
 const dir=await temp(t),capacity=new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:100000,softBytes:70000,recoveryReserveBytes:10000,minFreeBytes:0});
 let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const first=capacity.run({peakBytes:1000},async()=>{entered();await held;await writeFile(join(dir,'a'),Buffer.alloc(1000));});
 try {await started;assert.equal(capacity.health().reservedBytes,1000);
   let timer;await Promise.race([capacity.run({peakBytes:1000},()=>writeFile(join(dir,'b'),Buffer.alloc(1000))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('unrelated admission stalled')),2000);})]).finally(()=>clearTimeout(timer));
   assert.equal(capacity.health().reservedBytes,1000);
 } finally {release();await first;}
 assert.equal(capacity.health().reservedBytes,0);
});
test('capacity drain joins queued and active persona-like writes before shutdown returns',async t=>{
 const dir=await temp(t),capacity=new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:100000,softBytes:70000,recoveryReserveBytes:10000,minFreeBytes:0});
 let release,enter;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{enter=r;});
 const writing=capacity.run({peakBytes:1000},async()=>{enter();await held;await writeFile(join(dir,'PERSONA.md'),'complete');});
 let drained=false;const draining=capacity.drain().then(()=>{drained=true;});
 try{await started;await new Promise(r=>setImmediate(r));assert.equal(drained,false);}finally{release();await writing;await draining;}
 assert.equal(drained,true);assert.equal(await readFile(join(dir,'PERSONA.md'),'utf8'),'complete');
});

test('unavailable Agent accounting fences new observations but preserves unrelated durable state under the global quota',async t=>{
 const dir=await temp(t),capacity=new StorageCapacity({statePath:join(dir,'rooms.json'),hardBytes:100000,softBytes:70000,recoveryReserveBytes:10000,minFreeBytes:0});
 const old={id:'owed',kind:'append',event:{type:'memory.observed',payload:{observerAgentId:'a',text:'already committed'}}};
 await capacity.restoreObligations([old]);
 await writeFile(join(dir,'events'),'an unavailable log directory');
 await capacity.run({peakBytes:100,obligations:[old]},()=>writeFile(join(dir,'rooms.json'),'durable unrelated state'));
 assert.equal(capacity.health().agentAccountingError,'ENOTDIR');
 await assert.rejects(capacity.run({peakBytes:100,agentId:'a',agentBytes:10},()=>assert.fail('new direct observation admitted')),{code:'ENOTDIR'});
 await assert.rejects(capacity.run({peakBytes:100,obligations:[old,{...old,id:'new'}]},()=>assert.fail('new observation obligation admitted')),{code:'ENOTDIR'});
 await assert.rejects(capacity.run({peakBytes:100000},()=>assert.fail('global limit bypassed')),{code:'STORAGE_CAPACITY'});
 assert.equal(capacity.health().reservedBytes,0);
 assert.equal(await readFile(join(dir,'rooms.json'),'utf8'),'durable unrelated state');
});
