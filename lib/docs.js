'use strict';
// Office documents without extra packages: Excel (.xlsx), Word (.docx) and
// PowerPoint (.pptx) are zip files full of XML, so a small zip reader/writer
// is enough to read them and to create simple new ones. PDF text is best effort.
const zlib = require('zlib');
const path = require('path');

// ---------- zip ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a valid Office file (zip)');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    files[name] = () => method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = zlib.deflateRawSync(raw), nb = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb); offset += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const cp = n => { try { return String.fromCodePoint(n); } catch (e) { return '\uFFFD'; } };
const xmlUnescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, n) => cp(parseInt(n, 16))).replace(/&#(\d+);/g, (m, n) => cp(+n)).replace(/&amp;/g, '&');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const get = (files, name) => files[name] ? files[name]().toString('utf8') : '';

// ---------- Excel ----------
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref || 'A'); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function readXlsx(buf, { maxRows = 300, maxCols = 40 } = {}) {
  const f = unzip(buf);
  const shared = [];
  for (const si of get(f, 'xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(xmlUnescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  const wb = get(f, 'xl/workbook.xml'), rels = get(f, 'xl/_rels/workbook.xml.rels');
  const relMap = {}; for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2].replace(/^\/?(xl\/)?/, 'xl/');
  for (const m of rels.matchAll(/<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap[m[2]] = relMap[m[2]] || m[1].replace(/^\/?(xl\/)?/, 'xl/');
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0], name = xmlUnescape((/name="([^"]*)"/.exec(tag) || [])[1] || 'Sheet'), rid = (/r:id="([^"]+)"/.exec(tag) || [])[1];
    const xml = get(f, relMap[rid] || ''); const rows = []; let total = 0;
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rm[1] == null) continue; // an empty, formatting-only row
      total++; if (rows.length >= maxRows) continue;
      const row = []; let nextCol = 0;
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], body = cm[2] || '', ref = (/\br="([A-Z]+)\d+"/.exec(attrs) || [])[1];
        const ci = ref ? colIndex(ref) : nextCol; nextCol = ci + 1;
        if (ci >= maxCols) continue;
        const t = (/t="(\w+)"/.exec(attrs) || [])[1]; const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let val = '';
        if (t === 's') val = shared[+v] || ''; else if (t === 'inlineStr') val = xmlUnescape((body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(''));
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'; else val = v != null ? xmlUnescape(v) : '';
        row[ci] = val;
      }
      rows.push(Array.from(row, x => x == null ? '' : x));
    }
    sheets.push({ name, rows, totalRows: total });
  }
  return sheets;
}
function xlsxToText(buf) {
  return readXlsx(buf).map(s => `## Sheet: ${s.name} (${s.totalRows} rows${s.totalRows > s.rows.length ? ', first ' + s.rows.length + ' shown' : ''})\n` +
    s.rows.map(r => r.map(c => String(c).replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')).join('\n')).join('\n\n');
}
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function writeXlsx(sheets) {
  const used = new Set();
  sheets = (Array.isArray(sheets) ? sheets : []).slice(0, 20).map((s, i) => {
    let base = String((s && s.name) || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet' + (i + 1);
    let name = base, n = 2; // Excel refuses two sheets with the same name (ignoring case)
    while (used.has(name.toLowerCase())) { const suf = ` (${n++})`; name = base.slice(0, 31 - suf.length) + suf; }
    used.add(name.toLowerCase());
    return { name, rows: (Array.isArray(s && s.rows) ? s.rows : []).slice(0, 50000).map(r => Array.isArray(r) ? r : [r]) };
  });
  if (!sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];
  const sheetXml = s => {
    const widths = []; for (const r of s.rows) (r || []).forEach((c, i) => { widths[i] = Math.min(60, Math.max(widths[i] || 8, String(c == null ? '' : c).length + 2)); });
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${(r || []).map((c, ci) => {
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
      if (typeof c === 'number' && isFinite(c)) return `<c r="${ref}"${st}><v>${c}</v></c>`;
      if (c == null || c === '') return '';
      // only plain numbers become numbers; "00123" (IDs, zip codes) stays text so the zeros survive
      const n = typeof c === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(c.trim()) && c.trim().length < 15 ? Number(c) : null;
      if (n != null && ri > 0) return `<c r="${ref}"${st}><v>${n}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(typeof c === 'object' ? JSON.stringify(c) : c).slice(0, 32000)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E6F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(entries);
}

// ---------- Word ----------
function readDocx(buf) {
  const xml = get(unzip(buf), 'word/document.xml');
  const out = [];
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, tbl => '\n' + (tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || []).map(tr => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc => xmlUnescape((tc.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))).join(' | ')).join('\n') + '\n');
  for (const p of body.split(/<\/w:p>/)) {
    const style = (/<w:pStyle w:val="([^"]+)"/.exec(p) || [])[1] || '';
    const text = xmlUnescape((p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map(t => t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, '')).join(''));
    const lead = (p.split('<w:p')[0] || '').replace(/<[^>]+>/g, '').trim();
    if (lead) out.push(lead);
    if (!text.trim()) continue;
    const h = /Heading(\d)/i.exec(style) || /Title/i.exec(style);
    out.push(h ? '#'.repeat(h[1] ? +h[1] : 1) + ' ' + text : /List/i.test(style) ? (/^(•|\d+\.)\t/.test(text) ? text.replace(/^•\t/, '- ').replace(/^(\d+\.)\t/, '$1 ') : '- ' + text) : text);
  }
  return out.join('\n');
}
function runs(text, forceBold = false) {
  if (forceBold) return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(String(text).replace(/\*\*/g, ''))}</w:t></w:r>`;
  // **bold** and *italic* inside a line
  const parts = []; const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g; let last = 0, m;
  while ((m = re.exec(text))) { if (m.index > last) parts.push([text.slice(last, m.index), '']); parts.push(m[0].startsWith('**') ? [m[0].slice(2, -2), '<w:b/>'] : [m[0].slice(1, -1), '<w:i/>']); last = re.lastIndex; }
  if (last < text.length) parts.push([text.slice(last), '']);
  return parts.map(([t, f]) => `<w:r>${f ? '<w:rPr>' + f + '</w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
}
function writeDocx(markdown, title) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const body = []; let table = null;
  const flush = () => {
    if (!table) return;
    const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()));
    body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFBFD9"/>`).join('')}</w:tblBorders></w:tblPr>${rows.map((r, i) => `<w:tr>${r.map(c => `<w:tc><w:p>${i === 0 ? runs(c, true) : runs(c)}</w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`);
    table = null;
  };
  if (title) body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runs(title)}</w:p>`);
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { (table = table || []).push(line); continue; }
    flush();
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(line))) body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${m[1].length}"/></w:pPr>${runs(m[2])}</w:p>`);
    else if ((m = /^\s*[-*]\s+(.*)/.exec(line))) body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">•	</w:t></w:r>${runs(m[1])}</w:p>`);
    else if ((m = /^\s*(\d+)[.)]\s+(.*)/.exec(line))) body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">${m[1]}.	</w:t></w:r>${runs(m[2])}</w:p>`);
    else if (!line.trim()) continue;
    else body.push(`<w:p>${runs(line)}</w:p>`);
  }
  flush();
  const style = (id, name, sz, color, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="80"/>${extra}</w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${style('Title', 'Title', 44, '2D3270')}${style('Heading1', 'heading 1', 32, '2D3270', '<w:keepNext/><w:outlineLvl w:val="0"/>')}${style('Heading2', 'heading 2', 26, '3B3F7A', '<w:keepNext/><w:outlineLvl w:val="1"/>')}${style('Heading3', 'heading 3', 23, '4B4F8F', '<w:keepNext/><w:outlineLvl w:val="2"/>')}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>` },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ];
  return zip(entries);
}

// ---------- PowerPoint (read) ----------
function readPptx(buf) {
  const f = unzip(buf);
  let slides = Object.keys(f).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  // use the order from presentation.xml (slides can be reordered without renaming files)
  try {
    const rels = {}; for (const m of get(f, 'ppt/_rels/presentation.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) { const id = (/Id="([^"]+)"/.exec(m[0]) || [])[1], t = (/Target="([^"]+)"/.exec(m[0]) || [])[1]; if (id && t) rels[id] = 'ppt/' + t.replace(/^\/?(ppt\/)?/, ''); }
    const order = [...get(f, 'ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map(m => rels[m[1]]).filter(n => n && f[n]);
    if (order.length) slides = order;
  } catch (e) { /* keep file order */ }
  return slides.map((n, i) => `## Slide ${i + 1}\n` + get(f, n).split(/<\/a:p>/).map(p => xmlUnescape((p.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))).filter(Boolean).join('\n')).join('\n\n');
}

// ---------- PDF (best effort text) ----------
function a85(buf) {
  const s = buf.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = []; let group = [];
  for (const ch of s) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) { let v = 0; for (const g of group) v = v * 85 + g; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); group = []; }
  }
  if (group.length) { const n = group.length; while (group.length < 5) group.push(84); let v = 0; for (const g of group) v = v * 85 + g; const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...bytes.slice(0, n - 1)); }
  return Buffer.from(out);
}
function readPdf(buf) {
  const s = buf.toString('latin1'); const chunks = [];
  const re = /<<([\s\S]{0,600}?)>>\s*stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start); if (end < 0) break;
    let data = buf.slice(start, end);
    const filters = (m[1].match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || '';
    if (/ASCII85Decode|A85/.test(filters)) { try { data = a85(data); } catch (e) { continue; } }
    if (/FlateDecode|Fl\b/.test(filters)) { try { data = zlib.inflateSync(data); } catch (e) { try { data = zlib.inflateRawSync(data.slice(2)); } catch (x) { continue; } } }
    else if (filters && !/ASCII85Decode|A85/.test(filters)) continue;
    const c = data.toString('latin1');
    if (!/T[Jj]|'/.test(c)) continue;
    let text = '';
    const tokRe = /\((?:\\.|[^\\)])*\)\s*Tj|\[((?:\((?:\\.|[^\\)])*\)|[^\]()])*)\]\s*TJ|T\*|Td|TD|ET/g; let t;
    while ((t = tokRe.exec(c))) {
      const tok = t[0];
      if (/^(T\*|Td|TD|ET)$/.test(tok)) { text += '\n'; continue; }
      const strs = tok.match(/\((?:\\.|[^\\)])*\)/g) || [];
      text += strs.map(x => x.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\').replace(/\\(\d{3})/g, (q, o) => String.fromCharCode(parseInt(o, 8)))).join('');
    }
    chunks.push(text);
  }
  const out = chunks.join('\n').replace(/\n\s*\n+/g, '\n').trim();
  return out || '(No readable text found. This PDF may be scanned images or use embedded fonts Starcrew cannot decode.)';
}

function readAny(buf, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return xlsxToText(buf);
  if (ext === '.docx') return readDocx(buf);
  if (ext === '.pptx') return readPptx(buf);
  if (ext === '.pdf') return readPdf(buf);
  if (buf.includes(0)) throw new Error('unsupported binary file type ' + ext);
  return buf.toString('utf8');
}

module.exports = { unzip, zip, readXlsx, xlsxToText, writeXlsx, readDocx, writeDocx, readPptx, readPdf, readAny };
