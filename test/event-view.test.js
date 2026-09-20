import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, eventLogPath } from '../lib/event-log.js';
import { RoomJournal } from '../lib/room-journal.js';
const temp=async t=>{const dir=await mkdtemp(join(tmpdir(),'dcl-view-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'rooms.json');};
test('verified views deliver immutable full initialization and only append deltas on warm reads',async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'a',payload:{text:'a'}});
 const first=await log.readView('r');assert.equal(first.verified,true);assert.equal(first.appendOnly,false);assert.equal(first.events.length,1);
 assert.throws(()=>{first.events[0].payload.text='tampered';},TypeError);
 const unchanged=await log.readView('r',{after:first.revision});assert.equal(unchanged.appendOnly,true);assert.equal(unchanged.events.length,0);
 const reads=log.health().fullReads;await log.append('r',{type:'b'});
 const delta=await log.readView('r',{after:first.revision});assert.equal(delta.appendOnly,true);assert.deepEqual(delta.events.map(e=>e.type),['b']);assert.equal(delta.revision.generation,first.revision.generation);assert.equal(log.health().fullReads,reads);
 assert.equal((await log.readView('r',{after:delta.revision})).events.length,0);
});
test('replacement and external edits invalidate authority; corrupted sources cannot return stale views',async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'a'});const first=await log.readView('r');
 await log.replace('r',[]);const replaced=await log.readView('r',{after:first.revision});assert.equal(replaced.appendOnly,false);assert.notEqual(replaced.revision.generation,first.revision.generation);
 await log.append('r',{type:'b'});const before=await log.readView('r');const filename=eventLogPath(path,'r');
 const text=await readFile(filename,'utf8');await writeFile(filename,text.replace('"b"','"c"'));
 await assert.rejects(log.readView('r',{after:before.revision}),/hash-mismatch/);
});
test('journal view refuses a committed unpublished outbox even with warm cached events',async t=>{
 const path=await temp(t),events=new EventLog(path),room={id:'r'},journal=new RoomJournal({path,events,currentRoom:()=>room});
 await journal.commit({rooms:[room]});const first=await journal.readEventView('r');const original=events.appendOnce.bind(events);events.appendOnce=async()=>null;
 journal.queue(room,()=>({type:'missing'}),()=>true);await journal.commit({rooms:[room]});
 await assert.rejects(journal.readEventView('r',{after:first.revision}),/recovery is incomplete/);
 events.appendOnce=original;await journal.commit({rooms:[room]});assert.equal((await journal.readEventView('r',{after:first.revision})).events.length,1);
});
test('checked personal room updates keep stable operation ids and reject conflicting retries',async t=>{
 const path=await temp(t),events=new EventLog(path),room={id:'r'},journal=new RoomJournal({path,events,currentRoom:()=>room});
 const input={type:'memory.control',payload:{observerAgentId:'a',action:'pin'}};
 const first=await journal.appendChecked(room,input,()=>{},'personal:a:one');
 assert.equal((await journal.appendChecked(room,input,()=>{},'personal:a:one')).id,first.id);
 await assert.rejects(journal.appendChecked(room,{...input,payload:{...input.payload,action:'suppress'}},()=>{},'personal:a:one'),/conflict/);
 assert.equal((await journal.readEvents(room.id)).length,1);
 await assert.rejects(journal.appendChecked(room,input,()=>{throw new Error('authority revoked');},'personal:a:two'),/authority revoked/);
 assert.equal((await journal.readEvents(room.id)).length,1);
});
