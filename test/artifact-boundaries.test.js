import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DshChatLocalService} from '../lib/room-store.js';

async function setup(t){
 const directory=await fs.mkdtemp(join(tmpdir(),'artifact-boundaries-')),workspace=join(directory,'workspace');await fs.mkdir(workspace);
 const ctx={sessions:{get:()=>({header:{cwd:workspace}})},agents:{get:()=>({cancel(){}})},dshBridge:{status:async()=>({state:'idle'})},get(name){return this[name];}};
 const service=new DshChatLocalService(ctx,{path:join(directory,'state','rooms.json')});await service.ready;
 const room=await service.createRoom({name:'authorized material',autoDeliver:false,members:[{kind:'session',sessionId:'owner',alias:'Owner'}]});
 const task=await service.createLedgerEntry(room.id,{kind:'task',title:'Review result',ownerSessionId:'owner',acceptanceCriteria:'fixed evidence',contractVersion:1});
 t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
 return {directory,workspace,service,room,task,publish:path=>service.publishArtifact(room.id,null,{entryId:task.id,expectedRevision:task.revision,operationId:'publish-file',path})};
}
async function atOpen(target,mutation,run){
 const canonical=await fs.realpath(target),original=fs.open;let armed=true;
 fs.open=async(path,...args)=>{if(armed&&(path===target||path===canonical)){armed=false;await mutation();}return original(path,...args);};syncBuiltinESMExports();
 try{return await run();}finally{fs.open=original;syncBuiltinESMExports();assert.equal(armed,false,'the filesystem race hook must actually execute');}
}

test('publication refuses a symlink swapped in after authorization rather than freezing private outside bytes',async t=>{
 const h=await setup(t),file=join(h.workspace,'result.txt'),secret=join(h.directory,'outside-secret.txt');
 await fs.writeFile(file,'Authorized contents');await fs.writeFile(secret,'PRIVATE outside source never shared with this room');
 await atOpen(file,async()=>{await fs.unlink(file);await fs.symlink(secret,file);},async()=>{
  await assert.rejects(h.publish(file),/symlink|ELOOP|changed|authorized|identity/i);
 });
 assert.deepEqual(await h.service.listArtifacts(h.room.id),[]);
});

test('publication metadata uses the exact frozen bytes if an authorized file grows after stat',async t=>{
 const h=await setup(t),file=join(h.workspace,'result.txt'),actual='Authorized updated contents are longer than the original.';
 await fs.writeFile(file,'old');
 const result=await atOpen(file,()=>fs.writeFile(file,actual),()=>h.publish(file));
 const version=result.artifact.versions.find(version=>version.id===result.artifactRef.versionId);
 assert.equal(version.size,Buffer.byteLength(actual));assert.equal(version.snapshot.size,version.size);
 const exported=JSON.parse((await h.service.exportRoom(h.room.id)).content);
 assert.equal(Buffer.from(exported.artifactContents[0].data,'base64').toString(),actual);
});

test('knowing another room artifact hash and version id does not grant access to its frozen bytes',async t=>{
 const h=await setup(t),file=join(h.workspace,'result.txt');await fs.writeFile(file,'Only the publishing room receives this content.');
 const published=await h.publish(file),other=await h.service.createRoom({name:'unrelated room',autoDeliver:false,members:[{kind:'session',sessionId:'other',alias:'Other'}]});
 await assert.rejects(h.service.readArtifactVersion(other.id,null,published.artifactRef),/version|match/i);
});

test('publication does not acknowledge a reference erased by restore while its saved response is pending',async t=>{
 const h=await setup(t),file=join(h.workspace,'result.txt');await fs.writeFile(file,'Published only after the snapshot.');
 const snapshot=JSON.parse((await h.service.snapshotRun(h.room.id,'before-publication')).content);
 let release,entered;const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const commit=h.service.journal.commit.bind(h.service.journal);let armed=true;
 h.service.journal.commit=async state=>{const result=await commit(state);if(armed&&state.rooms.find(room=>room.id===h.room.id)?.artifacts.some(artifact=>artifact.publications?.length)){armed=false;entered();await held;}return result;};
 const pending=h.publish(file);pending.catch(()=>{});
 try{await ready;await h.service.restoreFromSnapshot(snapshot,{confirm:true});release();await assert.rejects(pending,/superseded|interrupted|changed/i);assert.deepEqual(await h.service.listArtifacts(h.room.id),[]);}
 finally{release();h.service.journal.commit=commit;await Promise.allSettled([pending]);}
});
