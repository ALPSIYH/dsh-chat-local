import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const name='dsh-pilot-provider';
export const inject=['llm','agentDefaultModel','loader','tools'];

/** One provider request, never an Agent loop. Returned tool calls are not executable. */
export async function runPilotRequest(ctx,input,{signal}={}) {
 if(input?.schemaVersion!==1 || !Array.isArray(input.messages) || !input.messages.length)throw Error('schemaVersion 1 messages are required');
 if(input.messages.some(message=>!['system','user'].includes(message.role)||typeof message.content!=='string'))throw Error('pilot accepts system/user text messages only');
 const requested=input.parameters??{};
 if(Object.keys(requested).some(key=>!['temperature','maxTokens','reasoningEffort'].includes(key)))throw Error('unsupported pilot parameter; do not imply it was applied');
 const maxTokens=requested.maxTokens??2048;
 if(!Number.isInteger(maxTokens)||maxTokens<32||maxTokens>4096)throw Error('pilot maxTokens must be 32–4096');
 const selected=ctx.agentDefaultModel.currentSelection();
 if(input.model && input.model!==selected.model)throw Error('requested model differs from the installed default model');
 const prepared=await ctx.llm.prepareCall({...selected,...requested,maxTokens},signal);
 const sessionId=`pilot-${randomUUID()}`;
 const system=input.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n');
 const messages=input.messages.filter(message=>message.role==='user').map(message=>({role:'user',content:[{type:'text',text:message.content}]}));
 let text='',usage,finishReason=null,toolCall=false;
 const started=Date.now();
 for await(const chunk of prepared.stream({...prepared.config,system,messages,tools:[],sessionId,signal})) {
  if(chunk.type==='text-delta')text+=chunk.text;
  if(chunk.type==='tool-call-delta'||chunk.type==='block-start'&&chunk.blockType==='tool-call'||chunk.type==='block-end'&&chunk.block?.type==='tool-call')toolCall=true;
  if(chunk.type==='usage')usage=chunk.usage;
  if(chunk.type==='finish')finishReason=chunk.reason;
 }
 const complete=finishReason?.kind==='stop'&&!toolCall;
 return {schemaVersion:1,text,complete,finishReason:finishReason?.kind??'missing-finish',model:prepared.config.model,
  parameters:Object.fromEntries(['temperature','maxTokens','reasoningEffort'].filter(key=>prepared.config[key]!==undefined).map(key=>[key,prepared.config[key]])),usage,
  metadata:{provider:prepared.config.provider,model:prepared.config.model,callConfig:prepared.config,
    adapterDefaults:prepared.adapterDefaults??null,modelIdentity:'registered-provider-route-and-model-id',providerRevision:'not-reported',
    sessionId,sessionIsolation:'stateless-request-no-session-history',toolSchemas:0,toolExecution:'no-agent-loop-and-global-deny-guard',
    toolCallReturned:toolCall,requestDispatches:1,transportRetries:'not-observed',llmRetryMiddleware:'disabled-by-invocation-overlay',elapsedMs:Date.now()-started}};
}

export function apply(ctx,config) {
 ctx.tools.guard(()=> 'This evaluation permits no tool execution.');
 void (async()=>{
  await ctx.loader.await();
  const request=JSON.parse(await readFile(config.requestPath,'utf8'));
  const response=await runPilotRequest(ctx,request,{signal:AbortSignal.timeout(120_000)});
  process.stdout.write(JSON.stringify(response)+'\n');
  ctx.get('appExit')(0);
 })().catch(error=>{
  // Provider errors may include endpoint/request details. Keep credentials and raw configs out of artifacts.
  process.stdout.write(JSON.stringify({schemaVersion:1,text:'',complete:false,finishReason:'adapter-error',error:{name:error?.name??'Error',code:error?.code??null},metadata:{toolExecution:'no-agent-loop-and-global-deny-guard'}})+'\n');
  ctx.get('appExit')(1);
 });
}
