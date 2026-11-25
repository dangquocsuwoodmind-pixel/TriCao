/* Đọc file .xlsx / .xlsm ngay trong trình duyệt (không thư viện ngoài, không gửi file lên máy chủ).
   Dùng DecompressionStream('deflate-raw') – có sẵn trên Chrome/Edge/Firefox/Safari bản mới.
   XLSX.open(file) → { sheetNames, sheet(name) → { maxRow, maxCol, get(r, c) } }  (r, c bắt đầu từ 1) */
(function (G) {
  'use strict';
  const td = new TextDecoder();

  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('File không phải định dạng Excel .xlsx/.xlsm (file .xls cũ hãy mở bằng Excel và lưu lại thành .xlsx)');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('File Excel bị hỏng');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files[td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/^\/+/, '')] = { method, csize, off };
      p += 46 + nl + xl + cl;
    }
    return async function text(name) {
      const key = Object.keys(files).find(k => k.toLowerCase() === name.toLowerCase());
      if (!key) return null;
      const f = files[key];
      const ln = dv.getUint16(f.off + 26, true), le = dv.getUint16(f.off + 28, true), start = f.off + 30 + ln + le;
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return td.decode(data);
      if (f.method !== 8) throw new Error('Kiểu nén trong file Excel không được hỗ trợ');
      if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt quá cũ – hãy dùng Chrome/Edge bản mới');
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return td.decode(out);
    };
  }

  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const textOf = node => all(node, 't').map(t => t.textContent).join('');
  function colIdx(letters) { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

  async function open(file) {
    const text = await unzip(await file.arrayBuffer());
    const wbXml = await text('xl/workbook.xml');
    if (!wbXml) throw new Error('Không đọc được workbook trong file Excel');
    const wb = xml(wbXml), rels = xml(await text('xl/_rels/workbook.xml.rels') || '<x/>');
    const relMap = {}; all(rels, 'Relationship').forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const sheets = all(wb, 'sheet').map(s => {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let t = relMap[rid] || ''; t = t.replace(/^\/?xl\//, '').replace(/^\//, '');
      return { name: s.getAttribute('name'), path: 'xl/' + t };
    });
    const ssXml = await text('xl/sharedStrings.xml');
    const ss = ssXml ? all(xml(ssXml), 'si').map(textOf) : [];

    async function sheet(name) {
      const s = sheets.find(x => x.name === name);
      if (!s) throw new Error('Không có sheet ' + name);
      const doc = xml(await text(s.path) || '<x/>');
      const cells = new Map();
      let maxRow = 0, maxCol = 0;
      all(doc, 'c').forEach(c => {
        const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r') || '');
        if (!m) return;
        const t = c.getAttribute('t'), vEl = all(c, 'v')[0];
        let v = vEl ? vEl.textContent : null;
        if (t === 's') v = v == null ? '' : (ss[+v] ?? '');
        else if (t === 'inlineStr') v = textOf(c);
        else if (t === 'b') v = v === '1';
        else if (t === 'e') v = '';
        else if (t === 'str') v = v ?? '';
        else if (v != null && v !== '') v = Number(v);
        if (v == null || v === '') return;
        const r = +m[2], col = colIdx(m[1]);
        cells.set(r + ':' + col, v);
        if (r > maxRow) maxRow = r; if (col > maxCol) maxCol = col;
      });
      return { name, maxRow, maxCol, get: (r, c) => { const v = cells.get(r + ':' + c); return v == null ? '' : v; } };
    }
    return { sheetNames: sheets.map(s => s.name), sheet };
  }

  G.XLSX_LITE = { open };
})(window);
