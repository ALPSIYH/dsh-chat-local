import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-upgrade-"));
  const path = join(directory, "rooms.json");
  const service = new DshChatLocalService({}, { path });
  try { await run({service, path, directory}); }
  finally { await service.close(); await rm(directory, { recursive:true, force:true }); }
}
const send = (service, roomId, extra = {}) => service.send({roomId,author:"human:me",authorKind:"human",text:"讨论",...extra});

test("message idempotency rejects reused operation ids with different contents", () => fixture(async ({service}) => {
  const room = await service.createRoom({name:"幂等",autoDeliver:false});
  const a = await send(service,room.id,{clientOperationId:"same"});
  assert.equal((await send(service,room.id,{clientOperationId:"same"})).id,a.id);
  await assert.rejects(send(service,room.id,{clientOperationId:"same",text:"另一条消息"}),/operation|幂等/);
}));

test("retention never silently deletes messages beyond the former 2000 message cap", () => fixture(async ({service,path}) => {
  const room = await service.createRoom({name:"历史",autoDeliver:false});
  await service.close();
  const state=JSON.parse(await readFile(path,"utf8"));
  state.rooms[0].messages=Array.from({length:2000},(_,i)=>({id:`m${i}`,roomId:room.id,roomSeq:i+1,author:"human:me",authorKind:"human",text:`消息 ${i}`,sentAt:1,mentions:[],deliveries:[]}));
  await writeFile(path,JSON.stringify(state));
  const reopened=new DshChatLocalService({}, {path});
  try { await send(reopened,room.id); const saved=JSON.parse(await readFile(path,"utf8")); assert.equal(saved.rooms[0].messages.length,2001); assert.equal(saved.rooms[0].messages[0].id,"m0"); }
  finally { await reopened.close(); }
}));

test("restart exposes interrupted work without pretending to resume it", () => fixture(async ({service,path}) => {
  const room=await service.createRoom({name:"重启",autoDeliver:false}); await service.close();
  const state=JSON.parse(await readFile(path,"utf8"));
  state.rooms[0].orchestration={state:"running",epoch:3,rootMessageId:"m0"};state.rooms[0].epoch=3;
  state.rooms[0].messages=[{id:"m0",roomId:room.id,roomSeq:1,author:"human:me",authorKind:"human",text:"进行中的工作",sentAt:1,mentions:[],deliveries:[{member:"s1",status:"working"}]}];
  await writeFile(path,JSON.stringify(state));
  const reopened=new DshChatLocalService({}, {path});
  try { const value=await reopened.resolveRoom(room.id); assert.equal(value.orchestration.state,"interrupted"); assert.equal((await reopened.messages(room.id))[0].deliveries[0].status,"failed"); assert.equal(reopened.activeRuns.size,0); }
  finally { await reopened.close(); }
}));

test("invalid or future state fails closed and does not overwrite source data", async () => {
  for(const invalid of [{oops:[]},{version:999,rooms:[]}]) await fixture(async ({service,path}) => {
    await service.close(); const original=JSON.stringify(invalid); await writeFile(path,original);
    const reopened=new DshChatLocalService({}, {path});
    try { await assert.rejects(reopened.listRooms(),/state|version|格式|版本/); assert.equal(await readFile(path,"utf8"),original); }
    finally { await reopened.close(); }
  });
});

test("room exports preserve full room data and checksum, without fetching outside files",()=>fixture(async({service})=>{
  const room=await service.createRoom({name:"导出/测试",autoDeliver:false,profile:{charter:"保留证据"}});
  await send(service,room.id,{text:"第一条"});await send(service,room.id,{text:"第二条"});
  await service.createLedgerEntry(room.id,{kind:"decision",title:"待决定事项"});
  const exported=await service.exportRoom(room.id,"json"), payload=JSON.parse(exported.content);
  assert.equal(payload.room.messages.length,2);assert.equal(payload.room.ledger.length,1);
  assert.equal(payload.contentHash,createHash("sha256").update(JSON.stringify(payload.room)).digest("hex"));assert.ok(!exported.filename.includes("/"));
  const md=await service.exportRoom(room.id,"markdown");for(const text of ["第一条","第二条","待决定事项","保留证据"])assert.ok(md.content.includes(text));
  await assert.rejects(service.exportRoom(room.id,"html"),/format/);
}));

test("actual HTTP handler rejects malformed paths, malformed JSON and oversized requests",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dcl-http-"));let handler;const disposers=[];
  const ctx={effect(fn){const dispose=fn();if(typeof dispose==="function")disposers.push(dispose);},on(){},tools:{register(){},guard(){}},webServer:{register(route){handler=route.handler;}}};
  apply(ctx,{path:join(directory,"rooms.json")});
  const request=async(url,raw,method="POST")=>{const req=Readable.from(raw===undefined?[]:[Buffer.from(raw)]);req.url=url;req.method=method;let code,body;await handler(req,{writeHead(c){code=c;},end(value){body=JSON.parse(value);}});return {code,body};};
  try{
    assert.equal((await request("/api/dsh-chat-local/rooms/%zz",undefined,"GET")).code,400);
    assert.equal((await request("/api/dsh-chat-local/rooms","{")).code,400);
    assert.equal((await request("/api/dsh-chat-local/rooms"," ".repeat(1000001))).code,413);
    const created=await request("/api/dsh-chat-local/rooms",JSON.stringify({name:"HTTP导出",autoDeliver:false}));assert.equal(created.code,200);
    const exported=await request(`/api/dsh-chat-local/rooms/${created.body.value.id}/export?format=json`,undefined,"GET");assert.equal(exported.code,200);assert.equal(JSON.parse(exported.body.value.content).room.name,"HTTP导出");
    const saved=await request(`/api/dsh-chat-local/rooms/${created.body.value.id}/export`,JSON.stringify({format:"json"}));assert.equal(saved.code,200);assert.equal(JSON.parse(await readFile(saved.body.value.path,"utf8")).room.name,"HTTP导出");
    const base=`/api/dsh-chat-local/rooms/${created.body.value.id}/ledger`;
    const task=await request(base,JSON.stringify({kind:"task",title:"过时权限问题",status:"blocked"}));assert.equal(task.code,200);
    const triage=await request(`${base}/${task.body.value.id}/triage`,JSON.stringify({action:"dismiss_blocker",expectedRevision:task.body.value.revision,operationId:"http-ignore"}));
    assert.equal(triage.code,200);assert.equal(triage.body.value.status,"open");assert.equal(triage.body.value.review,undefined);
    const archived=await request(`${base}/${task.body.value.id}/triage`,JSON.stringify({action:"archive",expectedRevision:triage.body.value.revision,operationId:"http-archive"}));
    assert.equal(archived.code,200);assert.equal(archived.body.value.status,"archived");
    const restored=await request(`${base}/${task.body.value.id}/triage`,JSON.stringify({action:"restore",expectedRevision:archived.body.value.revision,operationId:"http-restore"}));
    assert.equal(restored.code,200);assert.equal(restored.body.value.status,"open");
  }finally{for(const dispose of disposers.reverse())await dispose();await rm(directory,{recursive:true,force:true});}
});

test("exports save private non-overwriting files and do not mutate room records",()=>fixture(async({service,directory})=>{
  const room=await service.createRoom({name:"真实文件",autoDeliver:false});await send(service,room.id);
  const before=await service.exportRoom(room.id,"json");
  const a=await service.saveRoomExport(room.id,"json"),b=await service.saveRoomExport(room.id,"json"),md=await service.saveRoomExport(room.id,"markdown");
  assert.notEqual(a.path,b.path);assert.ok(a.path.startsWith(join(directory,"exports")+"/"));
  const content=await readFile(a.path,"utf8");assert.equal(a.contentHash,createHash("sha256").update(content).digest("hex"));assert.equal(a.size,Buffer.byteLength(content));
  assert.deepEqual(JSON.parse(content).room,JSON.parse(before.content).room);
  assert.equal((await stat(a.path)).mode&0o777,0o600);assert.equal((await stat(join(directory,"exports"))).mode&0o777,0o700);
  assert.match(await readFile(md.path,"utf8"),/讨论/);
  assert.deepEqual(JSON.parse((await service.exportRoom(room.id,"json")).content).room,JSON.parse(before.content).room);
}));

test("exports reject a symlink directory instead of writing to an unexpected location",()=>fixture(async({service,directory})=>{
  const room=await service.createRoom({name:"边界",autoDeliver:false});
  await symlink(directory,join(directory,"exports"));
  await assert.rejects(service.saveRoomExport(room.id),/符号链接/);
}));
