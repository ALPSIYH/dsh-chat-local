import {readFile,writeFile,mkdtemp,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import assert from "node:assert/strict";
import {DshChatLocalService} from "../lib/room-store.js";

// Never open the live file through a writing service: migrate only its exact copy.
const source=process.argv[2];
if(!source)throw new Error("Pass the exact rooms.json path to inspect");
const bytes=await readFile(source);
const before=JSON.parse(bytes.toString("utf8"));
const hash=value=>createHash("sha256").update(value).digest("hex");
const dir=await mkdtemp(join(tmpdir(),"dcl-migration-verification-"));
const path=join(dir,"rooms.json");
await writeFile(path,bytes,{mode:0o600});
const service=new DshChatLocalService({}, {path,monitorIntervalMs:3600000});
try{
  await service.ready;
  const after=JSON.parse(await readFile(path,"utf8"));
  const project=(reference,value,key="")=>{
    if(Array.isArray(reference)){assert.equal(value.length,reference.length,`Length changed at ${key}`);return reference.map((v,i)=>project(v,value[i],`${key}[${i}]`));}
    if(reference&&typeof reference==="object"){return Object.fromEntries(Object.entries(reference).map(([k,v])=>[k,project(v,value?.[k],`${key}.${k}`)]));}
    return value;
  };
  const expected=structuredClone(before);expected.version=service.stateVersion();
  assert.deepEqual(project(expected,after),expected,"An existing field changed during migration");
  assert.equal(new Set(after.workspace.agents.map(a=>a.id)).size,after.workspace.agents.length);
  assert.equal(new Set(after.workspace.participations.map(p=>p.id)).size,after.workspace.participations.length);
  for(const room of after.rooms)for(const member of room.members){
    assert(after.workspace.agents.some(a=>a.id===member.agentId));
    assert(after.workspace.participations.some(p=>p.id===member.participationId&&p.roomId===room.id&&p.sessionId===member.sessionId));
  }
  const sourceUnchanged=hash(await readFile(source))===hash(bytes);
  assert(sourceUnchanged,"Live source changed concurrently; repeat against a stable source");
  console.log(JSON.stringify({ok:true,source,sourceSha256:hash(bytes),sourceUnchanged,fromVersion:before.version,toVersion:after.version,groups:after.groups.length,rooms:after.rooms.length,messages:after.rooms.reduce((n,r)=>n+r.messages.length,0),ledger:after.rooms.reduce((n,r)=>n+r.ledger.length,0),drafts:after.workspace.drafts.length,openDrafts:after.workspace.drafts.filter(d=>!d.discardedAt&&!d.startedRoomId&&!d.groupCreatedId).length,agents:after.workspace.agents.length,participations:after.workspace.participations.length,allOriginalFieldsUnchangedExceptFormatVersion:true},null,2));
}finally{await service.close();await rm(dir,{recursive:true,force:true});}
