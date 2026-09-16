import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DshChatLocalService } from "../lib/room-store.js";
import { docxFixture, zipFixture, W } from "./docx-fixture.js";
import { extractDocx } from "../lib/document-reader.js";
import { textProtocol } from "../lib/text-protocol.js";
import { workProtocol } from "../lib/work-protocol.js";

test("file links with spaces produce one complete reference, not a second truncated path", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("    function artifactReferences("), source.indexOf("    function makeChatBody("));
  const path = "/Users/example/Library/Mobile Documents/project/paper.docx";
  const result = vm.runInNewContext(`${helper}\nartifactReferences(text)`, { textProtocol, text: `[正文](<${path}>)` });
  assert.deepEqual(Array.from(result), [path]);
});

test("read-only room can extract a DOCX with table, footnote and version identity without modifying it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-read-document-"));
  const ctx = { sessions: { get: () => ({ header: { cwd: directory } }) } };
  const service = new DshChatLocalService(ctx, { path: join(directory,"rooms.json") });
  try {
    const room = await service.createRoom({name:"文档验证",members:[{kind:"session",sessionId:"a",alias:"甲"}]});
    const path=join(directory,"paper.docx"), original=docxFixture(); await writeFile(path,original);
    const result=await service.previewArtifact(room.id,{path,sessionId:"a"});
    assert.match(result.content,/正文核查 & 依据/); assert.match(result.content,/样本数/); assert.match(result.content,/42/); assert.match(result.content,/原始数据说明/);
    assert.ok(result.artifact.version.contentHash); assert.equal(result.artifact.kind,"document");
    assert.ok(result.document.sections[0].blocks.length,"preview forwards structured reading data");
    assert.deepEqual(await readFile(path),original);
  } finally { await service.close(); await rm(directory,{recursive:true,force:true}); }
});

test("confirmation does not require a manually typed explanation", async () => {
  const source = await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const line = source.split("\n").find(line => line.includes('"确认并记录"') && line.includes("disabled:"));
  assert.ok(line,"confirmation button exists");
  const expression = line.match(/disabled: (confirmationDisabled\([^)]*\)), onClick:/)[1];
  const helper = source.match(/function confirmationDisabled\([^\n]+/)[0];
  assert.equal(vm.runInNewContext(`${helper}\n${expression}`,{managementBusy:false,ledgerConfirmation:{kind:"status",status:"decided",entry:{kind:"decision"}},ledgerReviewSummary:"",ledgerDecisionChoice:"adopt"}),false);
});

test("structured decisions require a choice, not prose, and permission risk remains a separate gate", async () => {
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8"), helper=source.match(/function confirmationDisabled\([^\n]+/)[0];
  const check=(choice)=>vm.runInNewContext(`${helper}\nconfirmationDisabled(false,target,choice)`,{target:{kind:"status",status:"decided",entry:{decisionOptions:[{id:"read"},{id:"wait"}]}},choice});
  assert.equal(check(""),true);assert.equal(check("read"),false);
  assert.match(source,/mode === "full_access" && !permissionAcknowledged/);
});

test("explicitly shared files outside a workspace are readable but their neighbors and Agent-only links are not",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dsh-shared-file-")), outside=await mkdtemp(join(tmpdir(),"dsh-shared-external-"));
  const service=new DshChatLocalService({sessions:{get:()=>({header:{cwd:directory}})}},{path:join(directory,"rooms.json")});
  try{
    const room=await service.createRoom({name:"共享文件",autoDeliver:false,members:[{kind:"session",sessionId:"a",alias:"甲"}]});
    const path=join(outside,"paper with spaces.docx"), neighbor=join(outside,"neighbor.docx");await writeFile(path,docxFixture());await writeFile(neighbor,docxFixture());
    await assert.rejects(service.previewArtifact(room.id,{path}),/outside/);
    await service.send({roomId:room.id,author:"a",authorKind:"session",text:`[旁边的文件](<${neighbor}>)`});
    await service.send({roomId:room.id,author:"human:me",authorKind:"human",text:`[正文](<${path}>)`});
    const read=await service.previewArtifact(room.id,{path});assert.equal(read.access.scope,"human_shared_file");assert.match(read.content,/样本数/);
    await assert.rejects(service.previewArtifact(room.id,{path:neighbor}),/outside/);
    await symlink(neighbor,join(directory,"escape.docx"));await assert.rejects(service.previewArtifact(room.id,{path:"escape.docx"}),/outside/);
    assert.equal((await service.roomMemory(room.id,"a")).sharedFiles.length,1);
  }finally{await service.close();await rm(directory,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test("DOCX rejects malformed XML, DTDs, macro parts and oversized decompression",async()=>{
  await assert.rejects(extractDocx(Buffer.from("not a zip")));
  await assert.rejects(extractDocx(zipFixture({"word/document.xml":"<broken>"})));
  await assert.rejects(extractDocx(zipFixture({"word/document.xml":`<!DOCTYPE doc [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${W}"/>`})),/DTD/);
  await assert.rejects(extractDocx(zipFixture({"word/document.xml":`<w:document xmlns:w="${W}"/>`,"word/vbaProject.bin":"macro"})),/macro/);
  await assert.rejects(extractDocx(zipFixture({"word/document.xml":"x".repeat(8_000_001)})),/safety limit/);
});

test("blocked cards expose recovery actions and decision cards expose questions and options",async()=>{
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const functions=source.slice(source.indexOf("    function DecisionChoices("),source.indexOf("    function LedgerCard("));
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
  const context={h,React:{Fragment:"fragment",useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect(){}},workProtocol,ledgerStatusLabel:x=>x};
  const rendered=vm.runInNewContext(`${functions}\nRecoveryPanel({roomId:'r',entry:{id:'t',kind:'task',status:'blocked',progress:{summary:'读取失败'}},related:[{id:'d',title:'选择路径',status:'proposed'}],files:[{path:'/test/a.docx'}],owner:{sessionId:'a'}})`,context);
  const serialized=JSON.stringify(rendered);for(const text of ["读取失败","当前条件检查","调整实际权限","通知负责人实测重试","决定被采纳不等于后续操作已执行"])assert.ok(serialized.includes(text));
  assert.ok(serialized.includes("不打断它"));assert.ok(serialized.includes("实测回报后才更新阻断"));
  const choice=vm.runInNewContext(`${functions}\nDecisionChoices({entry:{decisionOptions:[{id:'read',label:'直接读取',description:'不改文件'},{id:'wait',label:'等待材料',description:'暂不继续'}]},choice:'read'})`,context);
  assert.ok(JSON.stringify(choice).includes("不改文件"));
});
