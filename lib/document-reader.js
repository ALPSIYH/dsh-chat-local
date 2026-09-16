import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { textProtocol } from "./text-protocol.js";

export const MAX_DOCUMENT_BYTES = 20_000_000;
const MAX_XML_BYTES = 8_000_000;
const MAX_TOTAL_XML_BYTES = 24_000_000;
const MAX_TEXT_CHARS = 4_000_000;
const W_NS = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);

// Never invokes a shell, extracts files, follows relationships, or evaluates macros.
async function docxParts(bytes) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  return new Promise((resolve, reject) => {
    const parts = new Map(); let total = 0, count = 0, settled = false, activeStream;
    const fail = (error) => { if (settled) return; settled = true; activeStream?.destroy(); zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => { if (!settled) { settled = true; resolve(parts); } });
    zip.on("entry", (entry) => {
      if (settled) return;
      if (++count > 4000) return fail(new Error("DOCX contains too many ZIP entries"));
      if (/vbaProject\.bin$/iu.test(entry.fileName)) return fail(new Error("macro-enabled documents are not supported"));
      if (!/^word\/(?:document|styles|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/u.test(entry.fileName)) { zip.readEntry(); return; }
      if (parts.has(entry.fileName)) return fail(new Error("DOCX has duplicate document parts"));
      if (entry.uncompressedSize > MAX_XML_BYTES || total + entry.uncompressedSize > MAX_TOTAL_XML_BYTES) return fail(new Error("DOCX expanded XML exceeds safety limit"));
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        activeStream = stream; const chunks = []; let size = 0;
        stream.on("error", fail);
        stream.on("data", (chunk) => {
          size += chunk.length; total += chunk.length;
          if (size > MAX_XML_BYTES || total > MAX_TOTAL_XML_BYTES) return fail(new Error("DOCX expanded XML exceeds safety limit"));
          chunks.push(chunk);
        });
        stream.on("end", () => { if (!settled) { parts.set(entry.fileName, Buffer.concat(chunks).toString("utf8")); zip.readEntry(); } });
      });
    });
    zip.readEntry();
  });
}

const wordAttribute = (node, local) => Object.values(node.attributes).find(a => a.local === local && W_NS.has(a.uri))?.value;
function paragraphStyles(xml) {
  const styles = new Map();
  if (!xml) return styles;
  const parser = new SaxesParser({ xmlns: true }); let current;
  parser.on("doctype", () => { throw new Error("DOCX XML DTDs/entities are not allowed"); });
  parser.on("opentag", node => {
    if (!W_NS.has(node.uri)) return;
    if (node.local === "style") current = { id: wordAttribute(node,"styleId") };
    if (!current) return;
    if (node.local === "name") current.name = wordAttribute(node,"val");
    if (node.local === "basedOn") current.basedOn = wordAttribute(node,"val");
    if (node.local === "outlineLvl") current.outline = Number(wordAttribute(node,"val"));
  });
  parser.on("closetag", node => {
    if (W_NS.has(node.uri) && node.local === "style") {
      if (current?.id) styles.set(current.id,current);
      if (styles.size > 10000) throw new Error("DOCX styles exceed safety limit");
      current = undefined;
    }
  });
  parser.write(xml).close(); return styles;
}

function paragraphRole(paragraph, styles) {
  let style = paragraph.styleId, outline = paragraph.outline;
  const visited = new Set(); let title = false, level;
  while (style && !visited.has(style)) {
    visited.add(style); const value = styles.get(style);
    for (const name of [style, value?.name].filter(Boolean)) {
      if (/^(?:title|标题|標題)$/iu.test(name)) title = true;
      const heading = name.match(/^(?:heading|标题|標題)\s*([1-9])$/iu);
      if (heading && level === undefined) level = Number(heading[1]);
    }
    if (outline === undefined && value?.outline !== undefined) outline = value.outline;
    style = value?.basedOn;
  }
  if (outline !== undefined) level = outline >= 0 && outline < 9 ? outline + 1 : undefined;
  return title ? { role:"title" } : level ? { role:"heading", level } : { role:"paragraph" };
}

function mergeTableCells(table) {
  const previous = new Map();
  for (const row of table.rows) {
    let column = 0; const next = new Map();
    for (const cell of row.cells) {
      const span = cell.colSpan || 1, origin = previous.get(column);
      if (cell.merge === "continue" && origin && (origin.colSpan || 1) === span) {
        origin.rowSpan = (origin.rowSpan || 1) + 1; origin.blocks.push(...cell.blocks); cell.hidden = true; next.set(column,origin);
      } else if (cell.merge === "restart") next.set(column,cell);
      column += span;
    }
    previous.clear(); for (const [column,cell] of next) previous.set(column,cell);
  }
}

function extractPart(xml, part, warnings, styles) {
  const parser = new SaxesParser({ xmlns: true });
  const lines = [], blocks = [], paragraphs = [], tables = [], tags = [], runs = []; let p = 0, t = 0, note = "", noteInfo, skipped = 0, textChars = 0, nodes = 0;
  const attr = (node, local) => Object.values(node.attributes).find((a) => a.local === local)?.value;
  const target = () => tables.at(-1)?.currentCell?.blocks ?? blocks;
  const append = (text, display = text, extra = {}) => {
    if (skipped || !paragraphs.length) return;
    textChars += text.length; if (textChars > MAX_TEXT_CHARS) throw new Error("DOCX extracted text exceeds safety limit");
    const paragraph = paragraphs.at(-1); paragraph.auditText += text; paragraph.text += display;
    const run = { ...(runs.at(-1) ?? {}), ...extra, text:display };
    const previous = paragraph.runs.at(-1);
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.vertical === run.vertical && !previous.noteKind && !run.noteKind && !previous.placeholder && !run.placeholder) previous.text += display;
    else paragraph.runs.push(run);
  };
  parser.on("doctype", () => { throw new Error("DOCX XML DTDs/entities are not allowed"); });
  parser.on("opentag", (node) => {
    if (++nodes > 300000) throw new Error("DOCX XML node count exceeds safety limit");
    const w = W_NS.has(node.uri); tags.push(node);
    if (w && ["del", "moveFrom"].includes(node.local)) { skipped++; warnings.add("存在修订痕迹：输出采用当前文本，删除/移出内容未并入正文；修订审计须在原文核对。"); }
    if (w && ["ins", "moveTo"].includes(node.local)) warnings.add("存在修订痕迹：输出采用当前文本，删除/移出内容未并入正文；修订审计须在原文核对。");
    if (w && ["footnote", "endnote", "comment"].includes(node.local)) { note = `${node.local}#${attr(node,"id") ?? "?"}/`; noteInfo = {kind:node.local,id:attr(node,"id") ?? "?"}; }
    if (w && node.local === "r") runs.push({});
    if (w && runs.length && ["b","i"].includes(node.local)) runs.at(-1)[node.local === "b" ? "bold" : "italic"] = !["0","false","off"].includes(attr(node,"val"));
    if (w && runs.length && node.local === "vertAlign") runs.at(-1).vertical = attr(node,"val");
    if (w && node.local === "tbl") { const value = {type:"table",locator:`${part}/${note}T${++t}`,rows:[]}; if (!skipped) target().push(value); tables.push({ index:t, row:0, cell:0, value }); }
    if (w && node.local === "tr" && tables.length) { const table=tables.at(-1); table.row++; table.cell=0; table.currentRow={cells:[]}; table.value.rows.push(table.currentRow); }
    if (w && node.local === "tblHeader" && tables.length) tables.at(-1).currentRow.header = !["0","false","off"].includes(attr(node,"val"));
    if (w && node.local === "tc" && tables.length) { const table=tables.at(-1); table.cell++; table.currentCell={blocks:[]}; table.currentRow?.cells.push(table.currentCell); }
    if (w && node.local === "gridSpan" && tables.at(-1)?.currentCell) tables.at(-1).currentCell.colSpan=Math.max(1,Math.min(100,Number(attr(node,"val")) || 1));
    if (w && node.local === "vMerge" && tables.at(-1)?.currentCell) tables.at(-1).currentCell.merge=attr(node,"val") === "restart" ? "restart" : "continue";
    if (w && node.local === "p") {
      const table = tables.map(t => `T${t.index}/R${t.row}/C${t.cell}/`).join("");
      paragraphs.push({type:"paragraph",locator:`${part}/${note}${table}P${++p}`,text:"",auditText:"",runs:[],...(noteInfo?{note:{...noteInfo}}:{})});
    }
    if (w && paragraphs.length && node.local === "pStyle") paragraphs.at(-1).styleId=attr(node,"val");
    if (w && paragraphs.length && node.local === "outlineLvl") paragraphs.at(-1).outline=Number(attr(node,"val"));
    if (w && paragraphs.length && node.local === "jc") paragraphs.at(-1).align=attr(node,"val");
    if (w && node.local === "tab") append("\t");
    if (w && ["br", "cr"].includes(node.local)) append(" ⏎ ","\n");
    if (w && ["footnoteReference", "endnoteReference", "commentReference"].includes(node.local)) { const kind=node.local.replace("Reference",""),id=attr(node,"id") ?? "?"; append(`[${kind}#${id}]`,`[${id}]`,{noteKind:kind,noteId:id}); }
    if (w && ["drawing", "pict", "object", "altChunk"].includes(node.local)) { append("[图像/嵌入内容：需核对原文]","图像或嵌入内容（请在原文件核对）",{placeholder:true}); warnings.add("图片、图表及嵌入对象未做视觉识别，不能据此判断版式或图中数值。"); }
    if (/officeDocument\/2006\/math|ooxml\/officeDocument\/math/u.test(node.uri ?? "")) warnings.add("公式只提供线性文本，不保留完整数学排版，公式含义须核对原文。");
    if (w && node.local === "numPr") warnings.add("自动编号标签未展开；请使用输出中的段落/表格定位码核对原文。");
  });
  parser.on("text", (text) => { const node = tags.at(-1); if (node?.local === "t") append(text); });
  parser.on("closetag", (node) => {
    const w = W_NS.has(node.uri);
    if (w && node.local === "p") { const paragraph=paragraphs.pop(); if (paragraph?.auditText.trim()) { lines.push(`[${paragraph.locator}] ${paragraph.auditText.trim()}`); delete paragraph.auditText; Object.assign(paragraph,paragraphRole(paragraph,styles)); target().push(paragraph); } }
    if (w && node.local === "tc" && tables.length) tables.at(-1).currentCell=undefined;
    if (w && node.local === "tbl") { const table=tables.pop(); if(table)mergeTableCells(table.value); }
    if (w && node.local === "r") runs.pop();
    if (w && ["footnote", "endnote", "comment"].includes(node.local)) { note=""; noteInfo=undefined; }
    if (w && ["del", "moveFrom"].includes(node.local)) skipped--;
    tags.pop();
  });
  parser.write(xml).close();
  return {lines,blocks};
}

export async function extractDocx(bytes) {
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("DOCX file exceeds 20 MB safety limit");
  const parts = await docxParts(bytes);
  if (!parts.has("word/document.xml")) throw new Error("not a readable DOCX: word/document.xml is missing");
  const warnings = new Set(["这是带定位码的文本抽取，不是页面渲染；P 为 XML 段落序号，T/R/C 为表格/行/单元格，不是页码。", "未跟随外部链接、执行宏或读取嵌入附件；不据此宣称完成视觉、版式或外部来源核验。"]);
  const styles = paragraphStyles(parts.get("word/styles.xml"));
  const names = [...parts.keys()].filter(name=>name !== "word/styles.xml").sort((a,b) => a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
  const sections = names.map(part => { const value=extractPart(parts.get(part),part,warnings,styles); const kind=part === "word/document.xml" ? "body" : part.match(/\/([a-z]+)\d*\.xml$/u)?.[1] ?? "other"; return {part,kind,...value}; });
  const content = sections.flatMap(section=>section.lines).join("\n");
  if (content.length > MAX_TEXT_CHARS) throw new Error("DOCX extracted text exceeds safety limit");
  return { content, extraction: { format: "docx", parts: names, warnings: [...warnings], characterCount: content.length }, document: {version:1,sections:sections.map(({lines,...section})=>section)} };
}

export function sharedDocumentPaths(room) {
  const paths = new Map();
  for (const message of room.messages ?? []) {
    if (message.authorKind !== "human") continue;
    // A dedicated UI share authorizes exactly the selected file, not paths embedded
    // in an Agent-authored task title quoted by the generated acknowledgement.
    if(message.sharedFile?.path){paths.set(message.sharedFile.path,{path:message.sharedFile.path,sourceMessageId:message.id});continue;}
    for (const path of textProtocol.fileReferences(message.text).filter(path=>path.startsWith("/"))) paths.set(path, { path, sourceMessageId: message.id });
  }
  return [...paths.values()];
}
