import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, eventLogPath, eventLogHeadPath } from '../lib/event-log.js';
import { coldManifest, coldManifestPath } from '../lib/cold-log.js';
import { DshChatLocalService } from '../lib/room-store.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const temp=async t=>{const directory=await mkdtemp(join(tmpdir(),'dcl-final-lifecycle-'));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'rooms.json');};

for(const corruption of ['count','head','anchor'])for(const action of ['thaw','append'])test(`cold ${action} cannot erase inconsistent ${corruption} authority and continue`,async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'kept'});await log.archive('r');
 const marker=coldManifestPath(eventLogPath(path,'r')),original=JSON.parse(await readFile(marker,'utf8')),{checksum,...body}=original;
 const damaged=JSON.stringify(coldManifest({...body,...(corruption==='count'?{count:body.count+1}:corruption==='head'?{head:'a'.repeat(64)}:{})}));await writeFile(marker,damaged);
 if(corruption==='anchor')await writeFile(eventLogHeadPath(path,'r'),'a'.repeat(64));
 await assert.rejects(log.readView('r'),/event range|truncated/);
 if(action==='thaw')await assert.rejects(log.thaw('r'),/event range|truncated/);
 else assert.equal(await log.append('r',{type:'must-not-be-added'}),null);
 assert.equal(await readFile(marker,'utf8'),damaged,'the inconsistent cold authority must remain fenced for explicit repair');
 assert.equal((await stat(eventLogPath(path,'r'))).size,0);
});

async function waitFor(predicate) {
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,5));}
 throw new Error('final review fixture did not reach boundary');
}
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'dcl-final-lifecycle-')),path=join(directory,'rooms.json'),calls=[];
 const ctx={agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>calls.push({from,to,text,delivery})},get(n){return this[n];}};
 const service=new DshChatLocalService(ctx,{path,maxRounds:1,replyTimeoutMs:5000});await service.ready;
 t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
 const agent=await service.directory.save({profile:{alias:'A'},operationId:'a'});
 const room=await service.createRoom({name:'review fixture',autoDeliver:false,members:[{kind:'session',sessionId:'a',alias:'A',agentId:agent.id}]});
 const persona=await service.directory.persona(agent.id);
 await service.directory.savePersona(agent.id,{markdown:'# Persona\nStable personality remains independently available.',expectedHash:persona.hash});
 return {service,room,calls};
}

for(const context of ['native','group'])test(`${context} injection retains the configured persona when personal control sources are unavailable`,async t=>{
 const {service,room,calls}=await fixture(t);
 await service.observeSessionEvent('a',{type:'user/message',data:{message:{content:[{type:'text',text:'secret personal observation'}]}}});
 const item=(await service.agentMemory('a')).experiences[0];assert.ok(item);
 await service.updatePersonalMemory('a',{action:'suppress',operationId:'fence-personal',sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId});
 const original=service.journal.readEventView.bind(service.journal);
 service.journal.readEventView=async(id,options)=>{if(id===item.sourceRoomId)throw new Error('personal control source unavailable');return original(id,options);};
 try {
  if(context==='native'){
   const text=await service.nativeAgentContext('a');assert.match(text,/Stable personality remains independently available/);assert.doesNotMatch(text,/secret personal observation/);assert.match(text,/不完整/);
  } else {
   await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'current group task',mentions:['a']});
   const call=await waitFor(()=>calls[0]);assert.match(call.text,/Stable personality remains independently available/);assert.doesNotMatch(call.text,/secret personal observation/);
   assert.ok((await service.eventsFor(room.id)).some(e=>e.type==='relationship.snapshot'),'independent relationship snapshot survives');
  }
 } finally {service.journal.readEventView=original;}
});

test('an export that fails after creating a partial file removes that file and releases quota',async t=>{
 const {service,room}=await fixture(t),original=fs.promises.open;let injected=false;
 try {
  fs.promises.open=async(path,flags,...rest)=>{
   const file=await original(path,flags,...rest);
   if(flags==='wx'&&String(path).includes('/exports/'))return {async writeFile(){injected=true;await file.writeFile('partial');throw Object.assign(new Error('injected disk full'),{code:'ENOSPC'});},close:()=>file.close(),sync:()=>file.sync()};
   return file;
  };syncBuiltinESMExports();
  await assert.rejects(service.saveRoomExport(room.id),{code:'ENOSPC'});assert.equal(injected,true);
  assert.deepEqual(await readdir(join(service.path,'..','exports')),[]);assert.equal(service.capacity.health().reservedBytes,0);
 } finally {fs.promises.open=original;syncBuiltinESMExports();}
});

test('shutdown joins background consolidation that is still reading a source',async t=>{
 const {service}=await fixture(t),original=service.journal.readEventView.bind(service.journal),reached=deferred(),release=deferred();let held=false,closing,closed=false;
 service.journal.readEventView=async(...args)=>{if(!held){held=true;reached.resolve();await release.promise;}return original(...args);};
 try {
  await service.observeSessionEvent('a',{type:'user/message',data:{message:{content:[{type:'text',text:'background authored evidence'}]}}});
  await reached.promise;closing=service.close().then(()=>{closed=true;});await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);
  release.resolve();await closing;assert.equal(service.logHealth().memory.maintenance.active,false);
 } finally {release.resolve();service.journal.readEventView=original;await closing;}
});

test('shutdown joins an admitted storage maintenance operation before its first event-log write',async t=>{
 const path=await temp(t),service=new DshChatLocalService({}, {path});await service.ready;
 const room=await service.createRoom({name:'maintenance close',autoDeliver:false});await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:'retained',automaticDelivery:false});
 const original=service.journal.settled.bind(service.journal),reached=deferred(),release=deferred();let first=true,maintenance,closing,closed=false;
 try{
  service.journal.settled=async()=>{if(first){first=false;reached.resolve();await release.promise;}return original();};
  maintenance=service.maintainMemoryStorage({sourceRoomId:room.id,action:'archive'});maintenance.catch(()=>{});await reached.promise;
  closing=service.close().then(()=>{closed=true;});await new Promise(r=>setTimeout(r,30));
  assert.equal(closed,false,'an in-flight maintenance operation owns work not yet represented in event tails or capacity reservations');
  release.resolve();await Promise.allSettled([maintenance]);await closing;
  const exists=await stat(coldManifestPath(eventLogPath(path,room.id))).then(()=>true,()=>false);
  await new Promise(r=>setImmediate(r));assert.equal(await stat(coldManifestPath(eventLogPath(path,room.id))).then(()=>true,()=>false),exists);
 }finally{release.resolve();service.journal.settled=original;await Promise.allSettled([maintenance,closing]);await service.close();}
});
