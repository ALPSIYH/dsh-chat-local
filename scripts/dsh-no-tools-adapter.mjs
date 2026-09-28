import {reserveModelCall,settleModelCall} from './model-pilot-budget.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

/** Adapter protocol: one JSON request on stdin, one JSON response on stdout. */
export async function runDshAdapter(request,{executable='dsh',timeoutMs=150_000,budgetPath=process.env.DCL_MODEL_BUDGET_FILE}={}) {
 if(Buffer.byteLength(JSON.stringify(request))>50_000)throw Error('pilot request exceeds the fixed 50 KB input limit');
 const directory=await mkdtemp(join(tmpdir(),'dcl-provider-pilot-'));
 try {
  const requestPath=join(directory,'request.json'),patch=join(directory,'pilot.yml');
  await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
  const plugin=join(dirname(fileURLToPath(import.meta.url)),'dsh-pilot-provider.mjs');
  await writeFile(patch,`- id: headless-runner\n  disabled: true\n- id: llm-retry\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: ${JSON.stringify(join(directory,'sessions'))}\n- insert:\n    - id: dcl-pilot-provider\n      name: ${JSON.stringify(plugin)}\n      config:\n        requestPath: ${JSON.stringify(requestPath)}\n`,{mode:0o600});
  const reservation=budgetPath?await reserveModelCall(budgetPath,{trialId:request.trialId}):null;
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(executable,['headless','--patch',patch,'pilot'],{cwd:directory,stdio:['ignore','pipe','pipe'],shell:false});
   let stdout='',stderr='',over=false;
   const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
   const kill=setTimeout(()=>child.kill('SIGKILL'),timeoutMs+5000);kill.unref();
   child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1_000_000){over=true;child.kill('SIGTERM');}});
   child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>50_000)stderr=stderr.slice(-50_000);});
   child.on('error',error=>{clearTimeout(timer);clearTimeout(kill);reject(error);});
   child.on('close',code=>{clearTimeout(timer);clearTimeout(kill);if(over)return reject(Error('adapter output exceeded budget'));
    const results=stdout.split('\n').flatMap(line=>{try{const value=JSON.parse(line);return value.schemaVersion===1?[value]:[];}catch{return[];}});
    if(results.length!==1)return resolve({schemaVersion:1,text:'',complete:false,finishReason:'startup-error',metadata:{exitCode:code,stderrBytes:Buffer.byteLength(stderr),rawDiagnosticsRetained:false}});
    resolve({...results[0],metadata:{...results[0].metadata,exitCode:code,stderrBytes:Buffer.byteLength(stderr)}});
   });
  });
  if(reservation)result.metadata={...result.metadata,budget:await settleModelCall(budgetPath,reservation,result)};
  return result;
 } finally {await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>50_000)throw Error('pilot input too large');}process.stdout.write(JSON.stringify(await runDshAdapter(JSON.parse(input)))+'\n');}
 catch(error){process.stdout.write(JSON.stringify({schemaVersion:1,text:'',complete:false,finishReason:'adapter-input-error',error:{name:error.name}})+'\n');process.exitCode=1;}
}
