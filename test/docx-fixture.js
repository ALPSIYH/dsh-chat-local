import { deflateRawSync } from "node:zlib";

export function zipFixture(files) {
  const local = [], central = []; let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path), data = Buffer.from(text), compressed = deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20,4); head.writeUInt16LE(8,8);
    head.writeUInt32LE(crc,14); head.writeUInt32LE(compressed.length,18); head.writeUInt32LE(data.length,22); head.writeUInt16LE(name.length,26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20,4); dir.writeUInt16LE(20,6); dir.writeUInt16LE(8,10);
    dir.writeUInt32LE(crc,16); dir.writeUInt32LE(compressed.length,20); dir.writeUInt32LE(data.length,24); dir.writeUInt16LE(name.length,28); dir.writeUInt32LE(offset,42);
    local.push(head,name,compressed); central.push(dir,name); offset += head.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length,8); end.writeUInt16LE(Object.keys(files).length,10); end.writeUInt32LE(cd.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const docxFixture = () => zipFixture({
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "word/document.xml": `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>正文核查 &amp; 依据</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>样本数</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  "word/footnotes.xml": `<w:footnotes xmlns:w="${W}"><w:footnote w:id="2"><w:p><w:r><w:t>原始数据说明</w:t></w:r></w:p></w:footnote></w:footnotes>`
});
