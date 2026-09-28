import {mkdir,readFile,open,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

async function locked(path,operation){
 const lock=path+'.lock';
 try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('model pilot accounting is busy or interrupted; inspect the ledger before continuing');throw error;}
 try{const ledger=JSON.parse(await readFile(path,'utf8'));const value=await operation(ledger);
  const temporary=path+'.next',file=await open(temporary,'w',0o600);
  try{await file.writeFile(JSON.stringify(ledger,null,2)+'\n');await file.sync();}finally{await file.close();}
  await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  return value;}
 finally{await rm(lock,{recursive:true,force:true});}
}
export async function reserveModelCall(path,{trialId}={}){
 return locked(path,ledger=>{
  if(ledger.schemaVersion!==1||!Number.isInteger(ledger.calls)||!Number.isFinite(ledger.totalTokens))throw Error('invalid pilot accounting');
  if(ledger.reservations?.some(item=>item.status==='reserved'))throw Error('previous pilot outcome is still pending or unknown');
  if(ledger.stopped||ledger.usageUnknown||ledger.calls>=ledger.maxCalls||Date.now()>=ledger.deadlineAt||ledger.totalTokens>=ledger.stopBeforeNextAt)throw Error('shared model pilot budget exhausted or unresolved');
  const id=randomUUID();ledger.calls++;ledger.reservations??=[];ledger.reservations.push({id,trialId:trialId??null,status:'reserved',at:Date.now()});return id;
 });
}
export async function settleModelCall(path,id,result){
 return locked(path,ledger=>{
  const reservation=ledger.reservations.find(item=>item.id===id);if(!reservation||reservation.status!=='reserved')throw Error('pilot reservation is not current');
  const tokens=result.usage?.totalTokens;
  if(Number.isFinite(tokens)&&tokens>=0){ledger.totalTokens+=tokens;reservation.totalTokens=tokens;}else{ledger.usageUnknown=true;ledger.stopped=true;}
  reservation.status='settled';reservation.finishReason=result.finishReason;reservation.finishedAt=Date.now();
  if(ledger.totalTokens>=ledger.maxObservedTokens)ledger.stopped=true;
  return {calls:ledger.calls,totalTokens:ledger.totalTokens,usageUnknown:!!ledger.usageUnknown,stopped:!!ledger.stopped};
 });
}
