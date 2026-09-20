import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DshChatLocalService} from '../lib/room-store.js';

async function setup(t,config={}) {
 const dir=await mkdtemp(join(tmpdir(),'dcl-lifecycle-service-'));
 const ctx={agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'})},get(n){return this[n];}};
 const service=new DshChatLocalService(ctx,{path:join(dir,'rooms.json'),...config});
 await service.ready;
 t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
 const a=await service.directory.save({profile:{alias:'A'},operationId:'create-a'});
 const b=await service.directory.save({profile:{alias:'B'},operationId:'create-b'});
 const room=await service.createRoom({name:'work',autoDeliver:false,members:[{kind:'session',sessionId:'a',alias:'A',agentId:a.id},{kind:'session',sessionId:'b',alias:'B',agentId:b.id}]});
 const observe=async(id,text)=>service.observeSessionEvent(id,{type:'user/message',data:{message:{id:`message-${text}`,content:[{type:'text',text}]}}});
 return {service,room,a,b,observe};
}

test('observation coverage distinguishes text-only capture, unbound identities and failed receipts',async t=>{
 const {service,observe}=await setup(t);
 await observe('a','received native text');
 await service.observeSessionEvent('a',{type:'user/message',data:{message:{content:[{type:'image',url:'image-not-read'}]}}});
 await observe('unknown','unbound text');
 const health=service.logHealth().memory;
 assert.equal(health.coverage.history,'live-events-only');
 assert.equal(health.coverage.nonTextEvents,1);
 assert.equal(health.coverage.unboundEvents,1);
 const append=service.eventLog.append.bind(service.eventLog);
 service.eventLog.append=async()=>null;
 try {await assert.rejects(observe('a','unpersisted evidence'),/persist|observation/i);}
 finally {service.eventLog.append=append;}
 assert.equal(service.logHealth().memory.coverage.failedReceipts,1);
 assert.doesNotMatch(JSON.stringify(await service.agentMemory('a')),/unpersisted evidence/);
});

test('personal lifecycle controls persist, stay private and cannot be bypassed by explicit recall',async t=>{
 const {service,observe}=await setup(t);
 await observe('a','private source for suppression');
 const memory=await service.agentMemory('a',{query:'suppression'}), item=memory.experiences[0];
 const input={action:'suppress',operationId:'suppress-one',sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId};
 await assert.rejects(service.updatePersonalMemory('b',input),/observ|evidence|visible/i);
 const first=await service.updatePersonalMemory('a',input);
 assert.equal((await service.updatePersonalMemory('a',input)).eventId,first.eventId);
 assert.doesNotMatch(JSON.stringify(await service.agentMemory('a',{query:'private source for suppression'})),/private source for suppression/);
 await service.updatePersonalMemory('a',{...input,operationId:'restore-one',action:'restore'});
 assert.match(JSON.stringify(await service.agentMemory('a',{query:'suppression'})),/private source for suppression/);
 const restarted=new DshChatLocalService(service.ctx,{path:service.path});
 try {await restarted.ready;assert.match(JSON.stringify(await restarted.agentMemory('a',{query:'suppression'})),/private source for suppression/);}finally{await restarted.close();}
});

test('belief revisions keep evidence and never edit personality or silently promote opinion into fact',async t=>{
 const {service,observe,a}=await setup(t);
 const persona=await service.directory.persona(a.id);
 await observe('a','release date is provisional');
 const item=(await service.agentMemory('a',{query:'release date'})).experiences[0];
 const first=await service.updatePersonalMemory('a',{action:'belief',operationId:'belief-one',claim:'I currently expect Friday, uncertain.',evidence:[{sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId}]});
 const second=await service.updatePersonalMemory('a',{action:'belief',operationId:'belief-two',claim:'No confirmed date is available.',supersedes:first.beliefId,evidence:[{sourceRoomId:item.sourceRoomId,evidenceId:item.evidenceId}]});
 const memory=await service.agentMemory('a');
 assert.equal(memory.beliefs.length,1);assert.equal(memory.beliefs[0].claim,'No confirmed date is available.');
 assert.equal(memory.beliefs[0].kind,'belief');
 assert.equal((await service.directory.persona(a.id)).hash,persona.hash);
 await service.updatePersonalMemory('a',{action:'revoke_belief',operationId:'revoke-two',beliefId:second.beliefId});
 assert.deepEqual((await service.agentMemory('a')).beliefs,[]);
});
