import test from "node:test";
import assert from "node:assert/strict";
import { extractDocx } from "../lib/document-reader.js";
import { docxFixture, zipFixture, W } from "./docx-fixture.js";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("DOCX exposes a reading structure separately from its unchanged Agent locator text",async()=>{
  const result=await extractDocx(docxFixture());
  assert.equal(result.content,"[word/document.xml/P1] 正文核查 & 依据[footnote#2]\n[word/document.xml/T1/R1/C1/P2] 样本数\n[word/document.xml/T1/R1/C2/P3] 42\n[word/footnotes.xml/footnote#2/P1] 原始数据说明");
  assert.ok(result.document?.sections,"human reader needs paragraphs and tables, not one code string");
  const body=result.document.sections[0];assert.equal(body.kind,"body");
  assert.equal(body.blocks[0].type,"paragraph");assert.ok(!body.blocks[0].text.includes("word/document.xml"));
  assert.equal(body.blocks[0].locator,"word/document.xml/P1");
  assert.equal(body.blocks[1].type,"table");assert.equal(body.blocks[1].rows[0].cells.length,2);
  assert.equal(body.blocks[1].rows[0].cells[1].blocks[0].text,"42");
  assert.equal(result.document.sections[1].kind,"footnotes");
});

test("DOCX tables preserve merged cells and nested table text",async()=>{
  const p=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const result=await extractDocx(zipFixture({"word/document.xml":`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>${p("Merged")}</w:tc><w:tc>${p("Third")}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr>${p("Continuation")}</w:tc><w:tc><w:tbl><w:tr><w:tc>${p("Nested")}</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl></w:body></w:document>`}));
  const table=result.document.sections[0].blocks[0];
  assert.equal(table.rows[0].header,true);assert.equal(table.rows[0].cells[0].colSpan,2);assert.equal(table.rows[0].cells[0].rowSpan,2);
  assert.equal(table.rows[1].cells[0].hidden,true);assert.ok(table.rows[0].cells[0].blocks.some(p=>p.text==="Continuation"));
  assert.equal(table.rows[1].cells[1].blocks[0].type,"table");assert.match(result.content,/Nested/);
});

test("new DOCX styles parsing rejects DTDs and handles cyclic style inheritance",async()=>{
  const document=`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>Unchanged</w:t></w:r></w:p></w:body></w:document>`;
  await assert.rejects(extractDocx(zipFixture({"word/document.xml":document,"word/styles.xml":`<!DOCTYPE doc [<!ENTITY value SYSTEM "file:///etc/passwd">]><w:styles xmlns:w="${W}"/>`})),/DTD/);
  const result=await extractDocx(zipFixture({"word/document.xml":document,"word/styles.xml":`<w:styles xmlns:w="${W}"><w:style w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>`}));
  assert.equal(result.document.sections[0].blocks[0].text,"Unchanged");
});

async function readerHarness(preview,mode="reading") {
  const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
  const helpers=source.slice(source.indexOf("    function docxSections("),source.indexOf("    function makeChatBody("));
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
  const states=[],copies=[];let cursor=0;
  const React={Fragment:"fragment",useMemo:fn=>fn(),useState:value=>{const slot=cursor++;if(!(slot in states))states[slot]=value==="reading"?mode:value;return [states[slot],value=>{states[slot]=typeof value==="function"?value(states[slot]):value;}];},useId:()=>"test-reader",useEffect(){}};
  const context=vm.createContext({h,React,preview,navigator:{clipboard:{async writeText(text){copies.push(text);}}}});
  vm.runInContext(helpers,context);
  return {copies,render(){cursor=0;return vm.runInContext("DocxReader({preview,expanded:false,onExpand(){}})",context);}};
}
async function readerTree(preview,mode="reading") { return (await readerHarness(preview,mode)).render(); }
function nodes(tree) { return tree&&typeof tree==="object"?[tree,...(tree.children??[]).flatMap(nodes)]:[]; }
function visibleText(tree) { return typeof tree==="string"?tree:(tree?.children??[]).map(visibleText).join(""); }

test("actual DOCX reader defaults to semantic paragraphs and tables; raw locators are opt-in",async()=>{
  const preview=await extractDocx(docxFixture());
  const reading=await readerTree(preview), all=nodes(reading);
  assert.ok(all.some(node=>node.type==="article"));assert.ok(all.some(node=>node.type==="table"));
  assert.ok(!all.some(node=>node.type==="pre"));assert.ok(!visibleText(reading).includes("[word/document.xml/P1]"));
  const source=await readerTree(preview,"source");assert.ok(nodes(source).some(node=>node.type==="pre"&&visibleText(node).includes("[word/document.xml/P1]")));
});

test("DOCX reader treats embedded HTML as text and keeps old backend responses readable",async()=>{
  const reading=await readerTree({extraction:{format:"docx",warnings:[]},content:"[word/document.xml/P1] <script>alert(1)</script>\n[word/document.xml/P2] Abstract"});
  assert.match(visibleText(reading),/<script>alert\(1\)<\/script>/);
  assert.ok(!nodes(reading).some(node=>["script","img","iframe"].includes(node.type)||node.props.dangerouslySetInnerHTML));
  assert.ok(!visibleText(reading).includes("[word/document.xml/P1]"));
});

test("DOCX note navigation returns to the originating paragraph",async()=>{
  const harness=await readerHarness(await extractDocx(docxFixture()));
  nodes(harness.render()).find(node=>node.props["aria-label"]==="查看脚注 2").props.onClick();
  let tree=harness.render();assert.ok(nodes(tree).some(node=>node.props["aria-label"]==="脚注阅读内容"));
  nodes(tree).find(node=>node.type==="button"&&visibleText(node)==="返回正文引用处").props.onClick();
  tree=harness.render();assert.ok(nodes(tree).some(node=>node.props["aria-label"]==="正文阅读内容"));
  assert.ok(nodes(tree).some(node=>node.props.className?.includes("isActive")&&visibleText(node).includes("正文核查")));
});

test("DOCX paragraph citation opens beside its paragraph and copies versioned text",async()=>{
  const preview=await extractDocx(docxFixture());preview.artifact={logicalName:"review.docx",version:{contentHash:"example-file-hash"}};
  const harness=await readerHarness(preview);
  nodes(harness.render()).find(node=>node.type==="input"&&node.props.type==="checkbox").props.onChange({target:{checked:true}});
  nodes(harness.render()).find(node=>node.props["aria-label"]==="查看定位 word/document.xml/P1").props.onClick();
  let tree=harness.render();const paragraph=nodes(tree).find(node=>node.props.id==="test-reader-docx-word%2Fdocument.xml%2FP1");
  assert.ok(nodes(paragraph).some(node=>node.props.className==="dclDocxCitation"));
  await nodes(tree).find(node=>node.type==="button"&&visibleText(node)==="复制段落引用").props.onClick();
  assert.equal(harness.copies[0],"review.docx\n定位：word/document.xml/P1\nSHA-256：example-file-hash\n正文核查 & 依据[2]");
  tree=harness.render();assert.match(visibleText(tree),/已复制段落、定位和文件版本/);
});

test("DOCX search can be cleared and restores inactive navigation controls",async()=>{
  const harness=await readerHarness(await extractDocx(docxFixture()));
  nodes(harness.render()).find(node=>node.props["aria-label"]==="查找文档文字").props.onChange({target:{value:"原始数据"}});
  nodes(harness.render()).find(node=>node.props["aria-label"]==="下一个匹配段落").props.onClick();
  let tree=harness.render();assert.match(visibleText(tree),/1 \/ 1 个匹配段落/);
  assert.ok(nodes(tree).some(node=>node.props["aria-label"]==="脚注阅读内容"));
  nodes(tree).find(node=>node.props["aria-label"]==="清除文档查找").props.onClick();
  tree=harness.render();assert.ok(nodes(tree).find(node=>node.props["aria-label"]==="下一个匹配段落").props.disabled);
  assert.equal(nodes(tree).find(node=>node.props["aria-label"]==="查找文档文字").props.value,"");
});

test("DOCX reading keeps heading styles, emphasis and note references without rendering deleted text",async()=>{
  const result=await extractDocx(zipFixture({
    "word/styles.xml":`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="MyHeading"><w:name w:val="Section heading"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
    "word/document.xml":`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Document title</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="MyHeading"/></w:pPr><w:r><w:t>Abstract</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Evidence</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:del><w:r><w:delText>Removed text</w:delText></w:r></w:del></w:p></w:body></w:document>`,
    "word/footnotes.xml":`<w:footnotes xmlns:w="${W}"><w:footnote w:id="2"><w:p><w:r><w:t>Source note</w:t></w:r></w:p></w:footnote></w:footnotes>`
  }));
  const blocks=result.document?.sections[0].blocks;assert.ok(blocks,"structured reader output is required");
  assert.equal(blocks[0].role,"title");assert.equal(blocks[1].role,"heading");assert.equal(blocks[1].level,2);
  assert.ok(blocks[2].runs.some(run=>run.bold&&run.italic&&run.text==="Evidence"));
  assert.ok(blocks[2].runs.some(run=>run.noteKind==="footnote"&&run.noteId==="2"));
  assert.ok(!JSON.stringify(result.document).includes("Removed text"));
  assert.ok(result.extraction.warnings.some(warning=>warning.includes("修订")));
});
