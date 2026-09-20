import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog,createEvent,eventLogPath,verifyChain } from '../lib/event-log.js';
import { StorageCapacity } from '../lib/storage-capacity.js';
const moduleUrl=new URL('../lib/event-log.js',import.meta.url).href;
const temp=async t=>{const dir=await mkdtemp(join(tmpdir(),'dcl-cold-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'rooms.json');};
function killAt(path,operation,hook){
 let signal;try{execFileSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};const path=${JSON.stringify(path)};${hook};syncBuiltinESMExports();${operation}`],{timeout:10000,stdio:'pipe'});}catch(error){signal=error.signal;}
 assert.equal(signal,'SIGKILL','child reached the intended persistence boundary');
}
for(const boundary of ['archive-file','manifest','hot-cleanup'])test(`SIGKILL after ${boundary} leaves complete authoritative evidence`,async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'source',payload:{text:'original '.repeat(100)}});const original=await log.read('r');
 const hook=boundary==='hot-cleanup'
  ? `const old=fs.promises.writeFile;fs.promises.writeFile=async(...args)=>{const r=await old(...args);if(args[0]===eventLogPath(path,'r')&&args[1]==='')process.kill(process.pid,'SIGKILL');return r;}`
  : `const old=fs.promises.rename;fs.promises.rename=async(...args)=>{const r=await old(...args);if(${boundary==='manifest'?"args[1]===eventLogPath(path,'r')+'.cold'":"String(args[1]).endsWith('.gz')"})process.kill(process.pid,'SIGKILL');return r;}`;
 killAt(path,`await new EventLog(path).archive('r')`,hook);
 const reopened=new EventLog(path);assert.deepEqual(await reopened.read('r'),original);await reopened.archive('r');assert.deepEqual(await reopened.read('r'),original);
});
for(const boundary of ['raw-rename','manifest-remove'])test(`SIGKILL during thaw at ${boundary} preserves original source and permits later append`,async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'source'});await log.archive('r');
 const hook=boundary==='raw-rename'
 ? `const old=fs.promises.rename;fs.promises.rename=async(...args)=>{const r=await old(...args);if(args[1]===eventLogPath(path,'r'))process.kill(process.pid,'SIGKILL');return r;}`
 : `const old=fs.promises.rm;fs.promises.rm=async(...args)=>{const r=await old(...args);if(args[0]===eventLogPath(path,'r')+'.cold')process.kill(process.pid,'SIGKILL');return r;}`;
 killAt(path,`await new EventLog(path).thaw('r')`,hook);
 const reopened=new EventLog(path);assert.deepEqual((await reopened.read('r')).map(e=>e.type),['source']);assert.ok(await reopened.append('r',{type:'after'}));assert.deepEqual(verifyChain(await reopened.read('r')),{ok:true,brokenAt:null});
});
test('cold restore SIGKILL is fenced by its intent and recovery installs exactly the chosen snapshot',async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'old'});await log.archive('r');const chosen=[createEvent({type:'chosen'})];
 killAt(path,`await new EventLog(path).replace('r',${JSON.stringify(chosen)},'restore')`,`const old=fs.promises.rename;fs.promises.rename=async(...args)=>{const r=await old(...args);if(args[1]===eventLogPath(path,'r'))process.kill(process.pid,'SIGKILL');return r;}`);
 const reopened=new EventLog(path);await assert.rejects(reopened.read('r'),/recovery required/);await reopened.recoverAll();assert.deepEqual(await reopened.read('r'),chosen);
});
test('thaw admission accounts for uncompressed temporary peak and leaves cold source unchanged on rejection',async t=>{
 const path=await temp(t),log=new EventLog(path);await log.append('r',{type:'large',payload:{text:'x'.repeat(100000)}});await log.archive('r');
 const before=await readFile(`${eventLogPath(path,'r')}.cold`),capacity=new StorageCapacity({statePath:path,hardBytes:20000,softBytes:10000,recoveryReserveBytes:1000,minFreeBytes:0});
 const limited=new EventLog(path,{capacity});assert.equal(await limited.append('r',{type:'refused'}),null);assert.deepEqual(await readFile(`${eventLogPath(path,'r')}.cold`),before);assert.equal((await limited.read('r')).length,1);assert.equal(capacity.health().lastError,'STORAGE_CAPACITY');
});
