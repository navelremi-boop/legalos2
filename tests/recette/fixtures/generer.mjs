#!/usr/bin/env node
/** Génère fixtures docx / pdf pour la recette documents (données fictives). */
import { deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const crcTable = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function local(name, data) {
  const n = Buffer.from(name);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  return Buffer.concat([
    Buffer.from("PK\u0003\u0004"),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(comp.length),
    u32(data.length),
    u16(n.length),
    u16(0),
    n,
    comp,
  ]);
}
function central(name, data, offset) {
  const n = Buffer.from(name);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  return Buffer.concat([
    Buffer.from("PK\u0001\u0002"),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(comp.length),
    u32(data.length),
    u16(n.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    n,
  ]);
}

const files = {
  "[Content_Types].xml": Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  "_rels/.rels": Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  "word/document.xml": Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Piece fictive dossier</w:t></w:r></w:p></w:body></w:document>',
  ),
};

const parts = [];
let offset = 0;
const centrals = [];
for (const [name, data] of Object.entries(files)) {
  const loc = local(name, data);
  centrals.push({ name, data, offset });
  parts.push(loc);
  offset += loc.length;
}
const centralDir = Buffer.concat(centrals.map((c) => central(c.name, c.data, c.offset)));
const end = Buffer.concat([
  Buffer.from("PK\u0005\u0006"),
  u16(0),
  u16(0),
  u16(centrals.length),
  u16(centrals.length),
  u32(centralDir.length),
  u32(offset),
  u16(0),
]);
writeFileSync(join(out, "piece-fictive.docx"), Buffer.concat([...parts, centralDir, end]));

const pdf = Buffer.from(
  `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length 0 >>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer<< /Size 5 /Root 1 0 R >>
startxref
256
%%EOF
`,
);
writeFileSync(join(out, "sans-texte.pdf"), pdf);
console.log("fixtures ok");
