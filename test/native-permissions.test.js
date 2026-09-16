import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";

async function harness() {
  const directory=await mkdtemp(join(tmpdir(),"dsh-native-permission-")), changed=[], presets=new Map([["a","workspace-write"],["b","workspace-write"]]);
  const agents=new Map(["a","b"].map(id=>[id,{session:{id},status:"idle"}]));
  const ctx={agents:{get:id=>agents.get(id)},permissionPresets:{names:["workspace-write","danger-full-access"],resolve(name){if(!this.names.includes(name))throw new Error("unknown preset");return {sandbox:name,approval:name==="danger-full-access"?"never":"ask"};},current:s=>presets.get(s.id),set(s,p){presets.set(s.id,p);changed.push([s.id,p]);}},get(n){return this[n];}};
  const service=new DshChatLocalService(ctx,{path:join(directory,"rooms.json")});
  const room=await service.createRoom({name:"权限测试",members:["a","b"].map(id=>({kind:"session",sessionId:id,alias:id}))});
  return {service,room,ctx,agents,presets,changed,cleanup:async()=>{await service.close();await rm(directory,{recursive:true,force:true});}};
}
test("full access requires an explicit risk confirmation and applies native DSH presets before releasing the group guard",async()=>{
  const h=await harness();try{
    await assert.rejects(h.service.setRoomPolicy(h.room.id,{defaultActionMode:"full_access",expectedRevision:1}));
    assert.equal(h.changed.length,0);
    const room=await h.service.setRoomPolicy(h.room.id,{defaultActionMode:"full_access",expectedRevision:1,confirmRisk:true});
    assert.equal(room.policy.defaultActionMode,"full_access"); assert.deepEqual(h.changed,[["a","danger-full-access"],["b","danger-full-access"]]);
    h.service.policyLocks.set("a",{active:true,actionMode:"full_access",expiresAt:Date.now()+10000});
    assert.equal(h.service.guardToolExecution({name:"bash",agent:{session:{id:"a"}}}),undefined);
    assert.equal(h.service.guardToolExecution({name:"write_file",agent:{session:{id:"a"}}}),undefined);
  }finally{await h.cleanup();}
});
test("following DSH leaves native settings untouched and read-only still rejects writes",async()=>{
  const h=await harness();try{
    await h.service.setRoomPolicy(h.room.id,{defaultActionMode:"inherit_dsh",expectedRevision:1,confirmRisk:true});assert.equal(h.changed.length,0);
    h.service.policyLocks.set("a",{active:true,actionMode:"inherit_dsh",expiresAt:Date.now()+10000});assert.equal(h.service.guardToolExecution({name:"bash",agent:{session:{id:"a"}}}),undefined);
    await h.service.setRoomPolicy(h.room.id,{defaultActionMode:"discuss_only",expectedRevision:2});
    h.service.policyLocks.set("a",{active:true,actionMode:"discuss_only",expiresAt:Date.now()+10000});assert.match(h.service.guardToolExecution({name:"bash",agent:{session:{id:"a"}}}),/chat_read_document/);
  }finally{await h.cleanup();}
});
test("busy native sessions prevent partial room-wide escalation",async()=>{
  const h=await harness();try{
    h.agents.get("b").status="running";
    await assert.rejects(h.service.setRoomPolicy(h.room.id,{defaultActionMode:"full_access",expectedRevision:1,confirmRisk:true}),/busy|运行/);
    assert.equal(h.changed.length,0);assert.equal((await h.service.resolveRoom(h.room.id)).policy.defaultActionMode,"discuss_only");
  }finally{await h.cleanup();}
});
