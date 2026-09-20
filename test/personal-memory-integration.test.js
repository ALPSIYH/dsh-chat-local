import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DshChatLocalService} from '../lib/room-store.js';

async function waitFor(fn){const until=Date.now()+5000;while(Date.now()<until){const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,5));}throw Error('test timed out');}
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'dcl-personal-'));
  const calls=[];
  const ctx={agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'}),deliverExternal:async(from,to,text,delivery)=>{calls.push({from,to,text,delivery});}},get(n){return this[n];}};
  const service=new DshChatLocalService(ctx,{path:join(dir,'rooms.json'),maxRounds:1,replyTimeoutMs:5000});
  await service.ready;
  t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
  const alice=await service.directory.save({profile:{alias:'Alice'},operationId:'create-alice'});
  const bob=await service.directory.save({profile:{alias:'Bob'},operationId:'create-bob'});
  const room=await service.createRoom({name:'first',autoDeliver:false,members:[{kind:'session',sessionId:'a1',alias:'Alice',agentId:alice.id},{kind:'session',sessionId:'b1',alias:'Bob',agentId:bob.id}]});
  const second=await service.createRoom({name:'second',autoDeliver:false,members:[{kind:'session',sessionId:'a2',alias:'Alice elsewhere',agentId:alice.id}]});
  let turn=0;
  const open=async call=>{turn++;await service.observeSessionEvent(call.to,{type:'turn/start',data:{turn}});await service.observeSessionEvent(call.to,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]`}]}});};
  const end=async(call,text='(pass)')=>{await service.observeSessionEvent(call.to,{type:'assistant/message',data:{turn,step:1,message:{content:[{type:'text',text}]}}});await service.observeSessionEvent(call.to,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});await waitFor(async()=>(await service.resolveRoom(call.from.slice(5))).orchestration.state==='idle');};
  const send=async(roomId,text,mentions=[])=>service.send({roomId,author:'human:me',authorKind:'human',text,mentions});
  return{service,calls,alice,bob,room,second,send,open,end};
}

test('person memory crosses rooms by identity only after an actual observation, survives reload',async t=>{
  const h=await setup(t);
  await h.send(h.room.id,'material visible only after read');
  assert.equal((await h.service.agentMemory('a2')).experiences.length,0);
  await h.service.roomMemory(h.room.id,'a1');
  assert.match(JSON.stringify(await h.service.agentMemory('a2')),/material visible only after read/);
  assert.equal((await h.service.agentMemory('b1')).experiences.length,0);
  const restarted=new DshChatLocalService(h.service.ctx,{path:h.service.path});
  try{await restarted.ready;assert.match(JSON.stringify(await restarted.agentMemory('a2')),/material visible only after read/);}finally{await restarted.close();}
});

test('accepted transport is not observation; receipt contains history captured at delivery time',async t=>{
  const h=await setup(t);
  await h.send(h.room.id,'actually sent',['a1']);
  const call=await waitFor(()=>h.calls[0]);
  assert.equal((await h.service.agentMemory('a1')).experiences.length,0);
  await h.service.send({roomId:h.room.id,author:'human:me',authorKind:'human',text:'late unseen',automaticDelivery:false});
  await h.open(call);
  const memory=await h.service.agentMemory('a1');
  assert.match(JSON.stringify(memory),/actually sent/);
  assert.doesNotMatch(JSON.stringify(memory),/late unseen/);
  await h.end(call,'own answer');
  assert.match(JSON.stringify(await h.service.agentMemory('a2')),/own answer/);
});

test('native observed and authored work follows bound identity without sharing other native history',async t=>{
  const h=await setup(t);
  await h.service.observeSessionEvent('a1',{type:'user/message',data:{content:[{type:'text',text:'native personal work'}]}});
  await h.service.observeSessionEvent('a1',{type:'assistant/message',data:{message:{content:[{type:'text',text:'native answer'}]}}});
  const memory=JSON.stringify(await h.service.agentMemory('a2'));
  assert.match(memory,/native personal work/);assert.match(memory,/native answer/);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('b1')),/native personal work/);
});

test('same persona reaches a fresh session and reset recall cannot bypass active context by omitting room',async t=>{
  const h=await setup(t);
  const persona=await h.service.directory.persona(h.alice.id);
  await h.service.directory.savePersona(h.alice.id,{markdown:'# Personality\nUse concrete evidence and concise answers.',expectedHash:persona.hash});
  await h.send(h.room.id,'past cross-work memory');await h.service.roomMemory(h.room.id,'a1');
  assert.match(JSON.stringify(await h.service.agentMemory('a2')),/past cross-work memory/);
  await h.service.startRun(h.second.id,{arm:'reset_per_episode',appliedBy:'human'});
  await h.send(h.second.id,'new episode',['a2']);
  const call=await waitFor(()=>h.calls[0]);
  assert.match(call.text,/Use concrete evidence and concise answers/);
  assert.doesNotMatch(call.text,/past cross-work memory/);
  await h.open(call);
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('a2')),/past cross-work memory/);
  await assert.rejects(h.service.agentMemory('a2',{roomId:h.room.id}),/current room/);
  await h.end(call);
  const cost=(await h.service.eventsFor(h.second.id)).find(e=>e.type==='injection.cost');
  assert.ok(cost?.payload.personaHash);assert.equal(cost.payload.personaChars,'# Personality\nUse concrete evidence and concise answers.'.length);
});

test('native context injects the same person outside groups and never resamples an active group turn',async t=>{
  const h=await setup(t);
  const persona=await h.service.directory.persona(h.alice.id);
  await h.service.directory.savePersona(h.alice.id,{markdown:'# Persona\nLiteral {{unknown}} is part of my notes.',expectedHash:persona.hash});
  await h.service.observeSessionEvent('a1',{type:'user/message',data:{content:[{type:'text',text:'Native observed evidence'}]}});
  await h.service.observeSessionEvent('a2',{type:'turn/start',data:{turn:7}});
  const context=await h.service.nativeAgentContext('a2');
  assert.match(context,/Literal \{\{unknown\}\}/);assert.match(context,/Native observed evidence/);
  assert.equal(await h.service.nativeAgentContext('unknown'),null);
  await h.send(h.second.id,'group prompt',['a2']);
  const call=await waitFor(()=>h.calls[0]);
  assert.equal(await h.service.nativeAgentContext('a2'),null,'pending group delivery keeps turn sample authoritative');
  await h.open(call);assert.equal(await h.service.nativeAgentContext('a2'),null);
  await h.end(call);
});

test('manual all-layer clear resets room observations without deleting logs or other work',async t=>{
  const h=await setup(t);
  await h.send(h.room.id,'forgotten room experience');await h.service.roomMemory(h.room.id,'a1');
  await h.send(h.second.id,'retained elsewhere');await h.service.roomMemory(h.second.id,'a2');
  await assert.rejects(h.service.relationshipIntervention(h.room.id,{action:'clear',appliedBy:'human',mechanism:'test',memoryScope:'all',targetId:'a1'}),/whole-room/);
  await h.service.relationshipIntervention(h.room.id,{action:'clear',appliedBy:'human',mechanism:'test',memoryScope:'all'});
  const memory=JSON.stringify(await h.service.agentMemory('a2'));
  assert.doesNotMatch(memory,/forgotten room experience/);assert.match(memory,/retained elsewhere/);
  assert.ok((await h.service.eventsFor(h.room.id)).some(e=>e.payload.text==='forgotten room experience'));
  await h.service.roomMemory(h.room.id,'a1');
  assert.match(JSON.stringify(await h.service.agentMemory('a2')),/forgotten room experience/,'re-observed shared history can be remembered again');
});

test('a first tool can cite its delivered prompt while delivery-state persistence is still pending',async t=>{
  const h=await setup(t);
  const message=await h.send(h.room.id,'just observed evidence',['a1']);
  const call=await waitFor(()=>h.calls[0]);
  await h.service.observeSessionEvent('a1',{type:'turn/start',data:{turn:1}});
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  await h.service.settledAudit();
  h.service.journal.writeTail=held;
  const observing=h.service.observeSessionEvent('a1',{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]`}]}});
  observing.catch(()=>{});
  try{
    await waitFor(()=>h.service.policyLocks.get('a1')?.active);
    const appraisal=await h.service.appraise(h.room.id,'a1',{aboutAgentId:'b1',stance:'neutral',confidence:0.5,claim:'pending judgement',evidenceEventIds:[message.id]});
    assert.ok(appraisal.appraisalId);
  }finally{release();await observing;}
});

test('native and group tool results retain only visible output and avoid self-memory feedback',async t=>{
  const h=await setup(t);
  const result=(callId,text,turn)=>({type:'tool/result',data:{turn,step:1,meta:{private:'NEVER_VISIBLE'},message:{id:`result-${callId}`,role:'user',source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content:[{type:'text',text},{type:'reasoning',text:'PRIVATE_REASONING'}]}]}}});
  await h.service.observeSessionEvent('a1',result('native','native file observation',1));
  assert.match(JSON.stringify(await h.service.agentMemory('a2')),/native file observation/);
  await h.send(h.room.id,'work',['a1']);const call=await waitFor(()=>h.calls[0]);await h.open(call);
  await h.service.observeSessionEvent('a1',result('group','group read output',1));
  await h.service.observeSessionEvent('a1',{type:'tool/call',data:{turn:1,callId:'self',name:'chat_recall',arguments:'{}'}});
  await h.service.observeSessionEvent('a1',result('self','SELF_MEMORY_LOOP',1));
  const memory=JSON.stringify(await h.service.agentMemory('a1'));
  assert.match(memory,/group read output/);assert.doesNotMatch(memory,/NEVER_VISIBLE|PRIVATE_REASONING|SELF_MEMORY_LOOP/);
  await h.end(call);
  await h.service.observeSessionEvent('a2',{type:'user/message',data:{id:'snapshot',role:'user',source:{kind:'plugin',form:'snapshot',sections:[{name:'dsh-chat-local:person',text:'SELF_SNAPSHOT_LOOP'}]},content:[{type:'text',text:'SELF_SNAPSHOT_LOOP'}]}});
  assert.doesNotMatch(JSON.stringify(await h.service.agentMemory('a2')),/SELF_SNAPSHOT_LOOP/);
});

test('human experiment controls cannot intervene in the gap before a scheduled prompt is received',async t=>{
  const h=await setup(t);
  await h.send(h.room.id,'scheduled but not received',['a1']);
  await waitFor(()=>h.calls[0]);
  assert.equal(h.service.policyLocks.get('a1')?.active,undefined);
  await assert.rejects(h.service.startRun(h.room.id,{arm:'reset_per_episode',appliedBy:'human'}),/active/);
  await assert.rejects(h.service.relationshipIntervention(h.room.id,{action:'clear',memoryScope:'all',appliedBy:'human',mechanism:'test'}),/active/);
});
