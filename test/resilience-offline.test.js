import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventLog, eventLogPath, eventLogHeadPath } from '../lib/event-log.js';
import { evaluate } from '../scripts/relationship-eval.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const script = name => fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));
const run = (name, args) => new Promise(resolve => execFile(process.execPath, [script(name), ...args],
  { timeout: 5000, encoding:'utf8' }, (error, stdout, stderr) => resolve({code:error?.code??0, stdout, stderr})));

test('offline evaluator and verifier refuse a committed pending outbox without changing any file', async t => {
  const directory = await mkdtemp(join(tmpdir(),'dcl-offline-outbox-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const statePath=join(directory,'rooms.json'), roomId='r', log=new EventLog(statePath);
  const model={provider:'p',model:'m'};
  const inputs=[['run.manifest',{arm:'persistent',configHash:'fixed',initialStateVersion:17,startedAtTick:0,models:{s:model}}],
    ['injection.cost',{deliveryId:'d',digestChars:2,configHash:'fixed',memberSessionId:'s',modelAtDelivery:model}],
    ['delivery.settled',{deliveryId:'d',status:'delivered'}]];
  for (const [tick,[type,payload]] of inputs.entries()) assert.ok(await log.append(roomId,{type,payload,tick,provenance:{roomId}}));
  const pending=[{id:'owed',kind:'append',roomId,event:{type:'message.created',payload:{text:'must be recovered'},provenance:{roomId}}}];
  await writeFile(statePath,JSON.stringify({version:17,rooms:[{id:roomId}],_journal:{version:1,pending,checksum:hash(JSON.stringify(pending))}}));
  const paths=[statePath,eventLogPath(statePath,roomId),eventLogHeadPath(statePath,roomId)];
  const before=await Promise.all(paths.map(async path=>hash(await readFile(path))));
  await assert.rejects(evaluate({statePath,observation:true}),/audit recovery is pending/);
  for (const [name,args] of [['relationship-eval',['--state',statePath,'--observation','--json']],['verify-event-log',[roomId,'--state',statePath]]]) {
    const result=await run(name,args);
    assert.equal(result.code,1,`${name}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stdout+result.stderr,/audit recovery is pending/);
  }
  assert.deepEqual(await Promise.all(paths.map(async path=>hash(await readFile(path)))),before);
});
