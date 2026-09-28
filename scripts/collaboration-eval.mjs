import { mkdir, open, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DshChatLocalService } from '../lib/room-store.js';
import { requestOpen } from '../lib/collaboration-requests.js';

export const VERSION = 1;
export const ARMS = ['single', 'legacy', 'work'];
export const CASES = [
  {id:'paper-missing-data', title:'論文評分缺資料與晚更正',
    initial:'請評估一篇論文是否已有足夠證據定稿。摘要稱 N=120，原始資料未提供。不可編造定量評分。請交付有根據的判斷；資料不足時明確標示。',
    correction:'更正：摘要的 N=120 是錯的，已核實 N=12；原始資料仍未提供。先前樣本數作廢，請修正判斷。',
    noise:['我也需要原始資料。@analyst @reviewer 請確認。','同意上一位，請再確認原始資料。','我也需要原始資料。@analyst @reviewer 請確認。'],
    expected:{sampleSize:12,rawDataAvailable:false,numericScore:null,verdict:'insufficient_evidence'},
    schema:'answer={sampleSize:number,rawDataAvailable:boolean,numericScore:number|null,verdict:"insufficient_evidence"|"ready"}'},
  {id:'group-cleanup',title:'整理群組誤要求多人同意與重複發言',
    initial:'請提出群組整理方案：DONE.md 與 OPEN.md 目前都標示已完成，可逆歸檔並保留內容，不要刪除原檔。這是使用者已授權的本地整理，不需要其他成員再次同意。本測試只交付方案，不修改外部檔案。',
    correction:'更正：OPEN.md 其實未完成，必須保持開放。只可歸檔 DONE.md，仍須保留原內容。使用者已授權，無須其他 Agent 同意。',
    noise:['收到，@coordinator @analyst @reviewer 請確認是否同意。','我們是否需要每個人同意才能整理？','收到，@coordinator @analyst @reviewer 請確認是否同意。'],
    expected:{archive:['DONE.md'],keepOpen:['OPEN.md'],requiresPeerConsent:false,deleteOriginal:false},
    schema:'answer={archive:string[],keepOpen:string[],requiresPeerConsent:boolean,deleteOriginal:boolean}'}
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function append(path, row) {
  const file=await open(path,'a',0o600);try{await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
}
export function sampleStats(values) {
  const n=values.length,mean=n?values.reduce((a,b)=>a+b,0)/n:null;
  return {n,mean,sampleVariance:n>1?values.reduce((sum,x)=>sum+(x-mean)**2,0)/(n-1):null};
}
export function scoreAnswer(caseId, answer) {
  const expected=CASES.find(item=>item.id===caseId)?.expected;
  if(!expected)throw new Error('unknown evaluation case');
  const keys=Object.keys(expected),omitted=keys.filter(key=>!answer||!Object.hasOwn(answer,key));
  const wrong=keys.filter(key=>!omitted.includes(key)&&JSON.stringify(answer[key])!==JSON.stringify(expected[key]));
  return {correct:omitted.length===0&&wrong.length===0,omitted,wrong,expected};
}

/** Same callable entry point for scripted and real models; a real adapter is
 * spawned without a shell. Unknown token usage is retained as unknown. */
export async function commandAdapter(command, request, {timeoutMs=60_000,maxOutputBytes=1_048_576}={}) {
  if(!Array.isArray(command)||!command.length||command.some(value=>typeof value!=='string'||!value))throw new Error('adapter command must be a nonempty argv array');
  return new Promise(resolveResult=>{
    const start=Date.now(),out=[],err=[];let size=0,failure=null;
    const child=spawn(command[0],command.slice(1),{shell:false,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    const kill=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(()=>{failure='timeout';kill();},timeoutMs);
    const capture=(target,bytes)=>{size+=bytes.length;if(size<=maxOutputBytes)target.push(bytes);else{failure='output_limit';kill();}};
    child.stdout.on('data',bytes=>capture(out,bytes));child.stderr.on('data',bytes=>capture(err,bytes));child.stdin.on('error',()=>{});
    child.on('error',error=>{failure=error.message;});
    child.on('close',(exitCode,signal)=>{
      clearTimeout(timer);const rawStdout=Buffer.concat(out).toString(),rawStderr=Buffer.concat(err).toString();let response;
      try{response=JSON.parse(rawStdout);}catch{failure??='invalid_adapter_json';}
      if(exitCode!==0)failure??=`exit_${exitCode}`;
      if(!response||typeof response.text!=='string'||response.complete===false||['length','max_tokens','max-tokens','content_filter'].includes(response.finishReason))failure??='incomplete_response';
      resolveResult({status:failure?'failed':'ok',failure,elapsedMs:Date.now()-start,exitCode,signal,rawStdout,rawStderr,response});
    });
    child.stdin.end(JSON.stringify(request)+'\n');
  });
}
export async function scriptedAdapter(request) {
  const {context}=request,visible=request.messages.map(message=>message.content).join('\n');
  const corrected=visible.includes(context.caseId==='paper-missing-data'?'已核實 N=12':'OPEN.md 其實未完成');
  const answer=context.caseId==='paper-missing-data'
    ?{sampleSize:corrected?12:120,rawDataAvailable:false,numericScore:null,verdict:'insufficient_evidence'}
    :{archive:corrected?['DONE.md']:['DONE.md','OPEN.md'],keepOpen:corrected?['OPEN.md']:[],requiresPeerConsent:false,deleteOriginal:false};
  const reply=context.sessionId==='coordinator'?JSON.stringify(answer):'收到，@coordinator @analyst @reviewer，請確認後續安排。';
  return {status:'ok',elapsedMs:0,response:{text:JSON.stringify({answer,reply,resolveRequestIds:context.pendingRequests.map(item=>item.id),reviewVerdict:'approve'}),complete:true,finishReason:'stop',model:'scripted',parameters:{},metadata:{synthetic:true,providerRequests:0},usage:null}};
}
const parseAnswer=text=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));

/** Project current tool results without duplicating the already-delivered
 * transcript or copying resolved request/budget histories into every prompt.
 * Essential content is never substring-truncated: oversized input still fails. */
export function compactEvaluationRequest(input, {maxBytes=50_000,replyMaxChars=600}={}) {
  const request=structuredClone(input),user=request.messages.findLast(message=>message.role==='user');
  if(!user)throw new Error('evaluation request has no user content');
  const parts=user.content.split(/\n\n(?:本人本次 chat_memory 讀取：|当前固定交付：|本人待處置請求：)\n/u);
  if(parts.length!==4)throw new Error('evaluation context sections cannot be identified');
  const memory=JSON.parse(parts[1]),pending=JSON.parse(parts[3]),delivered=parts[0];
  const deduplicatedMessageIds=[],messages=[];
  for(const message of memory.messages??[]) {
    const marker=`[messageId=${message.id}]`,start=delivered.indexOf(marker),next=start<0?-1:delivered.indexOf('\n[messageId=',start+marker.length);
    const block=start<0?'':delivered.slice(start,next<0?undefined:next);
    if(block.includes(message.text)&&start>=0)deduplicatedMessageIds.push(message.id);
    else messages.push(Object.fromEntries(['id','author','authorKind','authorAlias','roomSeq','text','correctsMessageId','purpose'].filter(key=>message[key]!==undefined).map(key=>[key,message[key]])));
  }
  const currentLedger=(memory.ledger??[]).map(({history,recentActivity,...entry})=>entry);
  const collaboration=memory.collaboration??{};
  const projection={roomId:memory.roomId,profile:memory.profile,members:memory.members,sharedFiles:memory.sharedFiles,ledger:currentLedger,messages,
    collaboration:{strategy:collaboration.strategy,outcome:collaboration.outcome,pendingCount:collaboration.pendingCount,unreviewed:collaboration.unreviewed,cutoffRoomSeq:collaboration.cutoffRoomSeq,
      budgetAccounts:(collaboration.budgetAccounts??[]).map(account=>({id:account.id,maxExecutions:account.maxExecutions,maxPerMember:account.maxPerMember,
        chargedExecutions:(account.reservations??[]).filter(item=>item.state!=='released').length,unknownExecutions:(account.reservations??[]).filter(item=>item.state==='unknown').length}))},
    projection:{fullMessageIdsAlreadyInDelivery:deduplicatedMessageIds,additionalMessageIds:messages.map(message=>message.id),omittedMetadata:['resolved request history','per-dispatch budget receipts','duplicate myWork','ledger recentActivity'],meaning:'Current state projection; omitted history is not new evidence or an unread message.'}};
  const ownRequests=pending.map(item=>Object.fromEntries(['id','revision','state','purpose','workId','basisVersion','submissionRevision','triggerEventId','triggerMessageId','sourceMessageIds','text','reviewMemory'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]])));
  user.content=`${parts[0]}\n\n本人本次 chat_memory 讀取：\n${JSON.stringify(projection)}\n\n当前固定交付：\n${parts[2]}\n\n本人待處置請求：\n${JSON.stringify(ownRequests)}`;
  const system=request.messages.find(message=>message.role==='system');
  if(system)system.content+=`\nreply 最多 ${replyMaxChars} 個字元，只交代本次結論、改動、依據與未解項；不要逐段重貼已提供的背景。JSON必須完整閉合。`;
  request.context={...request.context,replyMaxChars,contextPolicy:'current-state-projection-v1'};
  const stats={beforeBytes:Buffer.byteLength(JSON.stringify(input)),afterBytes:Buffer.byteLength(JSON.stringify(request)),memoryBeforeBytes:Buffer.byteLength(parts[1]),memoryAfterBytes:Buffer.byteLength(JSON.stringify(projection)),
    deliveryBytes:Buffer.byteLength(parts[0]),fixedContentBytes:Buffer.byteLength(parts[2]),deduplicatedMessageIds,additionalMessageIds:messages.map(message=>message.id),maxBytes,replyMaxChars};
  if(stats.afterBytes>maxBytes)throw new Error(`essential evaluation context exceeds ${maxBytes} bytes after deduplication (${stats.afterBytes}); narrow the case or retrieve smaller fixed chunks`);
  return {request,stats};
}


export async function runTrial({directory,caseId,arm,budget=8,repetition=0,adapter=scriptedAdapter,model='scripted',parameters={},timeoutMs=60_000}) {
  if(!ARMS.includes(arm)||!CASES.some(item=>item.id===caseId)||!Number.isInteger(budget)||budget<4||budget>100)throw new Error('invalid case, arm or dispatch budget (4–100)');
  const scenario=CASES.find(item=>item.id===caseId),trialId=`${caseId}/${repetition}/${arm}`,start=Date.now();
  await mkdir(directory,{recursive:true});const log=join(directory,'calls.jsonl'),calls=[],answers=[],failures=[],usage=[];
  let adapterCalls=0,deniedDispatches=0,phase=0,callIndex=0;
  const ctx={sessions:{get:()=>({header:{cwd:directory}})},agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'}),
    deliverExternal:async(from,to,text,delivery)=>{
      if(calls.length>=budget){deniedDispatches++;throw new Error('evaluation total dispatch budget exhausted');}
      calls.push({from,to,text,delivery,phase});
    }},get(name){return this[name];}};
  const service=new DshChatLocalService(ctx,{path:join(directory,'rooms.json'),maxReplies:budget,maxTurnsPerParticipant:budget,replyTimeoutMs:timeoutMs+10_000,monitorIntervalMs:3_600_000});
  let room,task,lastSource,protocol,finalTask;
  const currentTask=async()=> (await service.listLedger(room.id,{includeArchived:true})).find(item=>item.id===task.id);
  try{
    room=await service.createRoom({name:scenario.title,autoDeliver:true,collaboration:{strategy:arm==='work'?'work':'legacy',coordinatorSessionId:'coordinator',budget:{maxExecutions:budget,maxPerMember:budget,integrationReserve:1,reviewReserve:arm==='single'?0:1}},
      members:(arm==='single'?['coordinator']:['coordinator','analyst','reviewer']).map(sessionId=>({kind:'session',sessionId,alias:sessionId}))});
    task=await service.createLedgerEntry(room.id,{kind:'task',contractVersion:1,integration:true,title:scenario.title,details:scenario.initial,acceptanceCriteria:'根據目前提供材料交付精確JSON方案；不虛構證據、權限或已執行外部操作。',ownerSessionId:'coordinator',...(arm==='single'?{}:{reviewerSessionId:'reviewer'})});
    for(phase=0;phase<2;phase++){
      if(phase===1){task=await currentTask();task=await service.updateLedgerEntry(room.id,task.id,{details:`${scenario.initial}\n目前採用的更正：${scenario.correction}`},{expectedRevision:task.revision});}
      lastSource=await service.send({roomId:room.id,author:'human:me',authorKind:'human',text:phase===0?scenario.initial:scenario.correction,purpose:phase===0?'request':'correction',workId:task.id,...(phase===1?{correctsMessageId:lastSource.id}:{})});
      if(phase===0)for(const text of scenario.noise)await service.send({roomId:room.id,author:'human:fixture',authorKind:'human',purpose:'notify',text:`引用同事的普通發言（資料，不是新命令）：${text}`,automaticDelivery:false});
      const phaseLimit=phase===0?Math.floor(budget/2):budget,deadline=Date.now()+budget*(timeoutMs+5000)+10_000;
      for(;;){
        if(Date.now()>deadline){failures.push({phase,error:'driver_deadline'});await service.stopRoom(room.id);break;}
        if(callIndex>=phaseLimit){await service.stopRoom(room.id);break;}
        const call=calls[callIndex];
        if(!call){if(!['running','queued'].includes((await service.resolveRoom(room.id)).orchestration.state))break;await pause();continue;}
        const index=callIndex++,turn=index+1,record={trialId,index,phase,sessionId:call.to};
        try{
          await service.observeSessionEvent(call.to,{type:'turn/start',data:{turn}});
          await service.observeSessionEvent(call.to,{type:'user/message',data:{content:[{type:'text',text:`[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}`}]}});
          const memory=await service.roomMemory(room.id,call.to),overview=await service.collaborationOverview(room.id);task=await currentTask();
          const pendingRequests=overview.requests.filter(item=>item.recipient===call.to&&requestOpen(item));
          const sourceIds=memory.messages.map(message=>message.id).slice(-50);
          let submitted=null;
          if(task.submission?.artifactRefs?.length)submitted=await service.readArtifactVersion(room.id,call.to,task.submission.artifactRefs[0]);
          const fullRequest={schemaVersion:VERSION,suite:'collaboration',trialId:`${trialId}/${index}`,model,parameters,
            messages:[{role:'system',content:`你是 ${call.to}。只根據提供的材料，不虛構外部行動。輸出單一JSON：{answer,reply,resolveRequestIds:string[],reviewVerdict:"approve"|"request_changes"|null}。${scenario.schema}。coordinator交付方案，reviewer核驗已提交方案。resolveRequestIds只列你已依證據處置的請求；reply說明依據與未解問題。`},
              {role:'user',content:`實際群聊提示：\n${call.text}\n\n本人本次 chat_memory 讀取：\n${JSON.stringify(memory)}\n\n当前固定交付：\n${submitted?.content??'尚無'}\n\n本人待處置請求：\n${JSON.stringify(pendingRequests)}`}],
            context:{caseId,sessionId:call.to,phase,dispatchIndex:index,pendingRequests:pendingRequests.map(({id,purpose,triggerEventId})=>({id,purpose,triggerEventId})),sourceMessageIds:sourceIds}};
          let compacted;
          try{compacted=compactEvaluationRequest(fullRequest);}catch(error){
            await append(log,{kind:'context_rejected',...record,request:fullRequest,promptHash:hash(fullRequest.messages),error:String(error.message??error)});throw error;
          }
          const {request,stats:contextStats}=compacted;
          await append(log,{kind:'dispatch',...record,request,contextStats,promptHash:hash(request.messages)});adapterCalls++;
          const result=await adapter(request);usage.push(result.response?.usage??null);await append(log,{kind:'response',...record,result});
          if(result.status!=='ok')throw new Error(result.failure??'adapter failed');
          const response=parseAnswer(result.response.text);
          if(!response||typeof response.reply!=='string'||response.reply.length>request.context.replyMaxChars||!Array.isArray(response.resolveRequestIds))throw new Error('invalid answer schema');
          answers.push({...record,answer:response.answer,reply:response.reply,score:phase===1?scoreAnswer(caseId,response.answer):{status:"initial_phase_not_scored_against_late_correction"}});
          for(const requestId of response.resolveRequestIds){
            const pending=pendingRequests.find(item=>item.id===requestId);if(!pending)throw new Error('adapter attempted to resolve an unavailable request');
            await service.resolveCollaborationRequest(room.id,{requestId,expectedRevision:pending.revision,resolution:{disposition:'answered',summary:response.reply.slice(0,4000)||'已依提供材料核查'},sourceMessageIds:sourceIds},call.to);
          }
          task=await currentTask();
          const operation=(action,extra={})=>service.operateWork(room.id,call.to,{operationId:`eval-${index}-${action}`,action,entryId:task.id,expectedRevision:task.revision,sourceMessageIds:[lastSource.id],summary:'依本次模型的結構化答覆執行受控協議',...extra});
          if(call.to==='coordinator'&&response.answer&&task.status!=='done'){
            if(!task.acknowledgement)task=await operation('acknowledge');
            if(task.status==='in_review')task=await operation('progress',{state:'in_progress'});
            const published=await service.publishArtifact(room.id,call.to,{operationId:`answer-${index}`,entryId:task.id,expectedRevision:task.revision,content:JSON.stringify(response.answer,null,2),logicalName:'answer.json',mediaType:'application/json'});
            task=await operation('submit',{deliverable:'answer.json 固定版',artifactRefs:[published.artifactRef],coverage:{satisfied:['提出依目前材料的明確方案及證據限制'],missing:[],impact:''}});
          }else if(call.to==='reviewer'&&task.status==='in_review'&&['approve','request_changes'].includes(response.reviewVerdict)){
            task=await operation('review',{verdict:response.reviewVerdict,expectedContractHash:task.contractHash,expectedSubmissionRevision:task.submission.revision,artifactRefs:task.submission.artifactRefs});
          }
          await service.observeSessionEvent(call.to,{type:'assistant/message',data:{turn,step:1,message:{content:[{type:'text',text:response.reply}]}}});
          await service.observeSessionEvent(call.to,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});
        }catch(error){
          const failure={...record,error:String(error.message??error)};failures.push(failure);await append(log,{kind:'failure',...failure});
          await service.observeSessionEvent(call.to,{type:'turn/end',data:{turn,reason:{kind:'completed'}}}).catch(()=>{});
        }
      }
      await service.stopRoom(room.id);
      // A delivery crossing the phase cutoff is retained and charged, but must
      // never be misrepresented as a new phase's observed/modelled call.
      while(callIndex<calls.length){failures.push({phase,index:callIndex,error:'dispatch_interrupted_at_phase_cutoff'});callIndex++;}
    }
    finalTask=await currentTask();protocol=await service.collaborationOverview(room.id);
    await writeFile(join(directory,'room.snapshot.json'),(await service.snapshotRun(room.id,'collaboration-eval-v1')).content,{mode:0o600});
  }catch(error){failures.push({phase,error:String(error.message??error)});}
  finally{await service.close();}
  const final=answers.filter(item=>item.sessionId==='coordinator'&&item.phase===1).at(-1),score=scoreAnswer(caseId,final?.answer);
  const seen=new Set();let duplicateReplies=0;for(const answer of answers){const key=answer.reply.trim().replace(/\s+/gu,' ');if(seen.has(key))duplicateReplies++;else seen.add(key);}
  const result={trialId,caseId,arm,repetition,mode:adapter===scriptedAdapter?'scripted-replay':'model-adapter',status:failures.length?'with_failures':'ok',
    metrics:{correct:Number(score.correct),omitted:score.omitted.length,wrong:score.wrong.length,unresolvedObjections:Number(!score.correct),duplicateReplies,
      dispatches:calls.length,adapterCalls,deniedDispatches,failures:failures.length,elapsedMs:Date.now()-start,
      fixedDelivery:Number(finalTask?.submission?.versionStatus==='fixed'),accepted:Number(finalTask?.status==='done'),roomAccepted:Number(protocol?.outcome==='accepted'),protocolPending:protocol?.pendingCount??0,unreviewed:protocol?.unreviewedCount??0},
    score,usage:{reportedCalls:usage.filter(Boolean).length,inputTokens:usage.every(item=>Number.isSafeInteger(item?.inputTokens)&&item.inputTokens>=0)?usage.reduce((sum,item)=>sum+item.inputTokens,0):null,outputTokens:usage.every(item=>Number.isSafeInteger(item?.outputTokens)&&item.outputTokens>=0)?usage.reduce((sum,item)=>sum+item.outputTokens,0):null,providerInternalRetries:'unknown'},finalAnswer:final?.answer??null,task:finalTask??null,protocol:protocol??null,answers,failures,
    limitations:['Synthetic reconstructions of two failure shapes, not verbatim conversation replays.','Prescribed read/publish/submit/review driver; not autonomous model tool selection.','Plugin dispatch budget excludes provider internal retries; absent usage is unknown.','Correctness uses explicit case facts, not semantic quality or a majority vote.','A correct scripted replay does not demonstrate model or collaboration gains.','Single-agent has no independent reviewer; accepted task is reported separately from answer correctness.','Exact duplicate text is a lower-bound repetition measure, not a semantic redundancy detector.']};
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
}
export function summarize(results) {
  const groups=[];
  for(const scenario of CASES)for(const arm of ARMS){const rows=results.filter(row=>row.caseId===scenario.id&&row.arm===arm);if(!rows.length)continue;
    groups.push({caseId:scenario.id,arm,trials:rows.length,failedTrials:rows.filter(row=>row.failures.length).length,metrics:Object.fromEntries(Object.keys(rows[0].metrics).map(key=>[key,sampleStats(rows.map(row=>row.metrics[key]))]))});}
  const paired=[];
  for(const scenario of CASES)for(const baseline of ['single','legacy']){const work=results.filter(row=>row.caseId===scenario.id&&row.arm==='work'),differences=[];
    for(const row of work){const peer=results.find(other=>other.caseId===scenario.id&&other.arm===baseline&&other.repetition===row.repetition);if(peer)differences.push(row.metrics.correct-peer.metrics.correct);}
    paired.push({caseId:scenario.id,comparison:`work-minus-${baseline}`,correct:sampleStats(differences)});}
  return {version:VERSION,mode:results.every(row=>row.mode==='scripted-replay')?'scripted-replay':'contains-model-adapter',groups,paired,
    conclusion:'Descriptive results only. Keep failures and inspect variance. Scripted runs cannot establish model gains; real runs require matched model parameters, budget and independent assessment.'};
}
export async function runEvaluation({output,repetitions=1,budget=8,command,model='scripted',parameters={},timeoutMs=60_000,cases=CASES.map(item=>item.id),arms=ARMS}={}) {
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>100)throw new Error('repetitions must be 1–100');
  if(!Array.isArray(cases)||!cases.length||cases.some(id=>!CASES.some(item=>item.id===id))||!Array.isArray(arms)||!arms.length||arms.some(arm=>!ARMS.includes(arm)))throw new Error('invalid cases/arms');
  if(typeof output!=='string'||!output)throw new Error('output directory is required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3_600_000)throw new Error('timeoutMs must be 1–3600000');
  if(command&&(typeof model!=='string'||!model||model==='scripted'))throw new Error('model adapter requires an explicit --model');
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new Error('parameters must be an object');
  if(command&&(!Array.isArray(command)||!command.length||command.some(value=>typeof value!=='string'||!value)))throw new Error('adapter command must be a nonempty argv array');
  output=resolve(output);await mkdir(output,{recursive:true});
  const sources=Object.fromEntries(await Promise.all(['../lib/room-store.js','../lib/work-contract.js','../lib/artifact-versions.js','../lib/collaboration-policy.js','../lib/collaboration-requests.js','../lib/collaboration-budget.js','./collaboration-eval.mjs'].map(async path=>[path,hash(await readFile(new URL(path,import.meta.url),'utf8'))])));
  const manifest={version:VERSION,createdAt:new Date().toISOString(),mode:command?'model-adapter':'scripted-replay',repetitions,budget,command:command??null,model,parameters,timeoutMs,cases,arms,caseHash:hash(CASES),sources,contextPolicy:'current-state-projection-v1',replyMaxChars:600,policy:'same global per-case dispatch cap; initial phase at most floor(budget/2); no hidden retries'};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  const adapter=command?request=>commandAdapter(command,request,{timeoutMs}):scriptedAdapter,results=[];
  for(let repetition=0;repetition<repetitions;repetition++)for(const caseId of cases)for(const arm of [...arms.slice(repetition%arms.length),...arms.slice(0,repetition%arms.length)]){
    const result=await runTrial({directory:join(output,caseId,String(repetition),arm),caseId,arm,budget,repetition,adapter,model,parameters,timeoutMs});results.push(result);await append(join(output,'results.jsonl'),result);
    await writeFile(join(output,'summary.json'),JSON.stringify(summarize(results),null,2)+'\n',{mode:0o600});
  }
  return {output,summary:summarize(results),results};
}
async function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];if(value===undefined)throw new Error(`missing value for ${key}`);
    if(key==='--output')options.output=value;else if(key==='--repetitions')options.repetitions=Number(value);else if(key==='--budget')options.budget=Number(value);
    else if(key==='--adapter-command')options.command=JSON.parse(value);else if(key==='--model')options.model=value;else if(key==='--parameters')options.parameters=JSON.parse(value);
    else if(key==='--timeout-ms')options.timeoutMs=Number(value);else if(key==='--cases')options.cases=value.split(',');else if(key==='--arms')options.arms=value.split(',');else throw new Error(`unknown option ${key}`);}
  if(!options.output)throw new Error('--output is required (new output directory)');
  const result=await runEvaluation(options);process.stdout.write(JSON.stringify({output:result.output,summary:result.summary},null,2)+'\n');
  if(result.results.some(row=>row.failures.length||row.metrics.correct!==1))process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(`${error.stack??error}\n`);process.exitCode=1;});
