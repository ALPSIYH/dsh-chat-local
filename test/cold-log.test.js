import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog,eventLogPath,verifyChain } from '../lib/event-log.js';
import { readColdLog,readColdManifest,coldManifestPath } from '../lib/cold-log.js';
const fixture=async t=>{const dir=await mkdtemp(join(tmpdir(),'dcl-cold-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'rooms.json');return {dir,path,log:new EventLog(path)};};
test('transparent archive reduces hot bytes, preserves all evidence, and append thaws without losing history',async t=>{
 const {path,log}=await fixture(t);for(let i=0;i<8;i++)await log.append('r',{type:'observed',payload:{text:'original '.repeat(1000),i}});
 const before=await log.read('r'),view=await log.readView('r'),raw=await readFile(eventLogPath(path,'r'));const report=await log.archive('r');
 assert.equal(report.archived,true);assert.equal((await stat(eventLogPath(path,'r'))).size,0);
 assert.ok(report.compressedBytes<raw.length/2);assert.deepEqual((await readColdLog(eventLogPath(path,'r'))).bytes,raw);
 assert.deepEqual(await new EventLog(path).read('r'),before);
 const cold=await log.readView('r',{after:view.revision});assert.equal(cold.appendOnly,false);assert.deepEqual(cold.events,before);
 await log.append('r',{type:'later'});const after=await log.read('r');assert.equal(after.length,9);assert.equal(after.at(-1).type,'later');assert.deepEqual(verifyChain(after),{ok:true,brokenAt:null});assert.equal(await readColdManifest(eventLogPath(path,'r')),null);
});
test('restore over a cold log replaces current evidence and a broken archive fails closed',async t=>{
 const {path,log}=await fixture(t);await log.append('r',{type:'old'});await log.archive('r');await log.replace('r',[]);
 assert.deepEqual(await log.read('r'),[]);assert.equal(await readColdManifest(eventLogPath(path,'r')),null);
 await log.append('r',{type:'new'});await log.archive('r');const cold=await readColdLog(eventLogPath(path,'r'));await writeFile(cold.archive,'broken');
 await assert.rejects(log.readView('r'),/cold log archive/);assert.equal(await log.append('r',{type:'must-not-pass'}),null);await assert.rejects(new EventLog(path).read('r'),/cold log archive/);
});
test('published cold manifest remains authoritative before hot cleanup and explicit thaw is lossless',async t=>{
 const {path,log}=await fixture(t);await log.append('r',{type:'one'});const raw=await readFile(eventLogPath(path,'r'));await log.archive('r');
 // This is the crash image after manifest rename but before hot truncation.
 await writeFile(eventLogPath(path,'r'),raw);assert.equal((await new EventLog(path).read('r')).length,1);
 await log.thaw('r');assert.equal(await readFile(eventLogPath(path,'r'),'utf8'),raw.toString());await assert.rejects(stat(coldManifestPath(eventLogPath(path,'r'))),{code:'ENOENT'});
});
test('unreferenced compression copies can be removed only after the current evidence verifies',async t=>{
 const {path,log}=await fixture(t);await log.append('r',{type:'kept'});await log.archive('r');
 const current=await readColdLog(eventLogPath(path,'r')),orphan=`${eventLogPath(path,'r')}.cold-deadbeef.gz`;await writeFile(orphan,await readFile(current.archive));
 assert.deepEqual(await log.cleanupArchives('r'),{roomId:'r',removed:1});assert.equal((await log.read('r')).length,1);assert.equal((await stat(current.archive)).isFile(),true);
 await writeFile(orphan,'retained');await writeFile(current.archive,'corrupt');await assert.rejects(log.cleanupArchives('r'),/cold log archive/);assert.equal(await readFile(orphan,'utf8'),'retained');
});
test('a self-checksummed manifest cannot invent an event count or head',async t=>{
 const {path,log}=await fixture(t);await log.append('r',{type:'kept'});await log.archive('r');
 const filename=coldManifestPath(eventLogPath(path,'r')),manifest=JSON.parse(await readFile(filename,'utf8'));
 const {coldManifest}=await import('../lib/cold-log.js');const {checksum,...body}=manifest;
 await writeFile(filename,JSON.stringify(coldManifest({...body,count:2})));
 await assert.rejects(new EventLog(path).read('r'),/event range/);
});
