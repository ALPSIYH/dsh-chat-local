import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { textProtocol } from "../lib/text-protocol.js";
import { sharedDocumentPaths } from "../lib/document-reader.js";

test("file references accept a natural-language macOS path with spaces and deduplicate wrappers",()=>{
  const path="/Users/example/Library/Mobile Documents/project/manuscript_v03.docx";
  const text=`最新正文是${path} 附录不变。 [正文](<${path}>)`;
  assert.deepEqual(textProtocol.fileReferences(text),[path]);
  assert.deepEqual(sharedDocumentPaths({messages:[{id:"human",authorKind:"human",text},{id:"agent",authorKind:"session",text:"/Users/another/private.docx"}]}),[{path,sourceMessageId:"human"}]);
  assert.deepEqual(textProtocol.fileReferences("[网页](https://example.com/report.md)"),[]);
  assert.deepEqual(textProtocol.fileReferences("https://example.com/Users/example/private.docx"),[]);
});

async function senderHarness() {
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const sender=source.slice(source.indexOf("        const send = async () => {"),source.indexOf("        const previewArtifact ="));
  const storage=new Map(), calls=[];
  const context={
    selectedRoom:{id:"room"},selectedIdRef:{current:"room"},draft:"待确认消息",draftRef:{current:"待确认消息"},mentionAll:false,mentionIds:["s1"],sending:false,
    historyModeRef:{current:false},pendingSends:{current:new Map()},roomUiRef:{current:new Map()},messages:[],error:"",notice:"",HUMAN_ID:"human:me",
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setHistoryMode(){},rememberRoomUi(id,patch){context.roomUiRef.current.set(id,{...context.roomUiRef.current.get(id),...patch});},
    setDraft(value){context.draft=value;context.draftRef.current=value;},setMentionAll(value){context.mentionAll=value;},setMentionIds(value){context.mentionIds=value;},
    setSending(value){context.sending=value;},setError(value){context.error=value;},setNotice(value){context.notice=value;},setMessages(update){context.messages=update(context.messages);},
    async api(path,options){calls.push({path,...options,body:JSON.parse(options.body)});return context.respond(calls.at(-1));},respond:()=>({id:"saved",scheduledCount:1})
  };
  const run=vm.runInNewContext(`${sender}\nsend`,context);
  return {context,run,calls,storage};
}

test("UI send treats the POST acknowledgement as success without a second refresh that can fail",async()=>{
  const h=await senderHarness();await h.run();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,"POST");
  assert.equal(h.context.messages[0].id,"saved");assert.equal(h.context.draft,"");
  assert.equal(h.context.pendingSends.current.size,0);assert.equal(h.storage.size,0);
});

test("UI send preserves its operation id and recipients across an uncertain-response retry",async()=>{
  const h=await senderHarness();h.context.respond=()=>{throw new Error("连接中断");};await h.run();
  assert.equal(h.context.draft,"待确认消息");assert.deepEqual([...h.context.mentionIds],["s1"]);
  assert.ok(h.storage.has("dcl:pending:room"));
  h.context.respond=()=>({id:"saved"});await h.run();
  assert.equal(h.calls[0].body.clientOperationId,h.calls[1].body.clientOperationId);
  assert.deepEqual(h.calls[0].body.mentions,h.calls[1].body.mentions);
});

test("UI send never overwrites a new draft or a different room after an async failure",async()=>{
  const h=await senderHarness();let reject;
  h.context.respond=()=>new Promise((_resolve,fail)=>{reject=fail;});const pending=h.run();
  h.context.setDraft("新的草稿");reject(new Error("连接中断"));await pending;
  assert.equal(h.context.draft,"新的草稿");assert.match(h.context.error,/未被覆盖/);
  h.context.draft="另一条消息";const switched=h.run();h.context.selectedIdRef.current="another-room";h.context.setDraft("另一个房间的草稿");reject(new Error("连接中断"));await switched;
  assert.equal(h.context.draft,"另一个房间的草稿");assert.equal(h.context.messages.length,0);
});
test("mention routing ignores code, email and longer English names while preserving exact Chinese @ mentions",()=>{
  const members=[{alias:"Alex",sessionId:"a"},{alias:"Alexandra",sessionId:"b"},{alias:"协调",sessionId:"c"},{alias:"协调组",sessionId:"d"}];
  assert.deepEqual(textProtocol.mentions("@allison foo@Alex.com `@全部`\n```\n@Alex\n```",members),[]);
  assert.deepEqual(textProtocol.mentions("请@协调组处理，@Alexandra 请复核。",members),["session:d","session:b"]);
  assert.deepEqual(textProtocol.mentions("@all 请查核",members),["all"]);
  assert.deepEqual(textProtocol.mentions("@Alex 请继续",members),["session:a"]);
});
test("message renderer formats common Markdown without executable HTML, unsafe URLs or remote images",async()=>{
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const helpers=source.slice(source.indexOf("    function markdownInline("),source.indexOf("    function MessageContent("));
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
  const text="# 结论\n\n**有依据**\n\n- 项目一\n- 项目二\n\n| 项目 | 结果 |\n| --- | --- |\n| 检查 | 通过 |\n\n```js\nalert(1)\n```\n\n[危险](javascript:alert) ![外图](https://example.com/a.png) <script>alert(2)</script>\n\n[来源](https://example.com) [本地](</Users/example/My Documents/paper.docx>)";
  const result=vm.runInNewContext(`${helpers}\nmarkdownBlocks(text,()=>{})`,{h,text,textProtocol});
  const all=[];const visit=value=>{if(value&&typeof value==="object"){all.push(value);for(const child of value.children??[])visit(child);}};result.forEach(visit);
  for(const type of ["h2","strong","ul","li","table","pre","a","button"])assert.ok(all.some(node=>node.type===type),type);
  assert.ok(!all.some(node=>["script","img","iframe"].includes(node.type)));
  assert.ok(!all.some(node=>node.props.dangerouslySetInnerHTML||String(node.props.href??"").startsWith("javascript:")));
  assert.match(JSON.stringify(result),/<script>/);
});

test("Markdown file previews default to the safe reader and can switch to source",async()=>{
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("    function TextFileReader("),source.indexOf("    function docxSections("));
  let raw=false;const MessageContent=()=>null;
  const h=(type,props,...children)=>({type,props:props??{},children});
  const context=vm.createContext({h,MessageContent,React:{useState:()=>[raw,value=>{raw=value;}]},props:{preview:{artifact:{logicalName:"report.MD"},content:"# 安全正文"}}});
  vm.runInContext(body,context);
  const rendered=vm.runInContext("TextFileReader(props)",context);
  assert.equal(rendered.children[1].type,MessageContent);assert.equal(rendered.children[1].props.text,"# 安全正文");
  rendered.children[0].props.onClick();
  const sourceView=vm.runInContext("TextFileReader(props)",context);assert.equal(sourceView.children[1].type,"pre");assert.equal(sourceView.children[1].children[0],"# 安全正文");
  context.props.preview.artifact.logicalName="code.js";assert.equal(vm.runInContext("TextFileReader(props)",context).children[1].type,"pre");
});
