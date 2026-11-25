/* Trang máy tính – Sản phẩm, phiên bản BOM, tạo lệnh sản xuất từ BOM.
   Dùng chung các hàm của pc.js (modal, toast, loading, loi, moDrawer, dongPhieu, U, $ …) – nạp SAU pc.js.
   Tên toàn cục đều có tiền tố "bom" hoặc "lx" để không trùng với pc.js. */
'use strict';

let BD = null;     // dữ liệu /api/bom
let LXD = null;    // dữ liệu /api/lenh
let lxLocV = 'cho';
const bomCo = p => !!U && (U.role === 'admin' || (U.perms || []).includes(p));
const bomKhongDau = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const bomTT = {
  CHO_DUYET: ['Chờ duyệt', 'b-hold'], DA_DUYET: ['Hiện hành', 'b-done'], THAY_THE: ['Đã thay thế', 'b-new'],
  TU_CHOI: ['Bị từ chối', 'b-late'], DA_HUY: ['Đã huỷ', 'b-new'], DANG_XU_LY: ['Đang xử lý', 'b-run'], DA_DUYET_LX: ['Đã duyệt', 'b-done']
};
const bomBadge = (tt, lx) => { const t = bomTT[lx && tt === 'DA_DUYET' ? 'DA_DUYET_LX' : tt] || [tt, 'b-new']; return '<span class="badge ' + t[1] + '">' + esc(t[0]) + '</span>'; };
const bomChips = buoc => '<div class="steps">' + (buoc || []).map(s => '<span class="step">' + esc(s) + '</span>').join('') + '</div>';
const bomSo = v => (v == null || v === '' ? '' : String(v));
const bomList = (arr, cls, title) => arr && arr.length ? '<div class="' + cls + '">' + (title ? '<b>' + title + '</b>' : '') + '<ul style="margin:4px 0 0 18px;padding:0">' +
  arr.slice(0, 60).map(x => '<li>' + esc(x) + '</li>').join('') + (arr.length > 60 ? '<li>… và ' + (arr.length - 60) + ' mục khác</li>' : '') + '</ul></div>' : '';

/** Hộp thoại xác nhận → Promise<boolean> */
function bomXacNhan(title, html, okText, cls) {
  return new Promise(res => {
    let ok = false;
    const bg = modal({ title, body: html, buttons: [{ t: okText || 'Xác nhận', cls: cls || 'pri', fn: () => { ok = true; res(true); } }] });
    const obs = new MutationObserver(() => { if (!document.body.contains(bg)) { obs.disconnect(); if (!ok) res(false); } });
    obs.observe(document.body, { childList: true });
  });
}

function bomVaoApp() {
  document.querySelectorAll('[data-perm]').forEach(b => { b.hidden = !bomCo(b.dataset.perm); });
  bomTai(true); lxTai(true);
}

/* ============================ ĐỌC FILE BOM EXCEL ============================ */
/** Vị trí thứ tự trong ô công đoạn: 1 · "1-3" (làm ở bước 1 và 3) · ô bị Excel đổi "1-3" thành ngày. */
function bomViTri(v) {
  if (v === '' || v == null || v === false) return [];
  if (typeof v === 'number') {
    if (v > 31) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return [d.getUTCMonth() + 1, d.getUTCDate()]; }
    return v > 0 ? [v] : [];
  }
  return String(v).split(/[^0-9.]+/).filter(Boolean).map(Number).filter(n => n > 0);
}
const bomMa = v => (typeof v === 'number' ? String(+v.toPrecision(12)) : String(v == null ? '' : v).trim());

async function bomDocExcel(file) {
  const wb = await XLSX_LITE.open(file);
  const ten = wb.sheetNames.find(n => bomKhongDau(n) === 'QUY TRINH SAN XUAT');
  if (!ten) throw new Error('File không có sheet "QUY TRINH SAN XUAT" (có: ' + wb.sheetNames.join(', ') + ')');
  const ws = await wb.sheet(ten);
  const g = (r, c) => ws.get(r, c), k = (r, c) => bomKhongDau(g(r, c));
  let hr = 0;
  for (let r = 1; r <= Math.min(20, ws.maxRow) && !hr; r++) for (let c = 1; c <= ws.maxCol; c++) if (k(r, c).startsWith('TEN CHI TIET')) { hr = r; break; }
  if (!hr) throw new Error('Không tìm thấy dòng tiêu đề (cột "Tên Chi Tiết") trong sheet ' + ten);
  const col = {}, steps = [];
  for (let c = 1; c <= ws.maxCol; c++) {
    const h = k(hr, c); if (!h) continue;
    if (/^MA SP/.test(h) && !col.sp) col.sp = c;
    else if (/^MA CUM/.test(h)) col.cum = c;
    else if (/^MA PHU KIEN/.test(h)) col.pk = c;
    else if (/^MA PHU LIEU/.test(h)) col.pl = c;
    else if (/^TEN CHI TIET/.test(h)) col.ten = c;
    else if (/^QU[IY] CACH THANH PHAM/.test(h)) col.tp = c;
    else if (/^QU[IY] CACH BI LIEU/.test(h)) col.bl = c;
    else if (/^VAT LIEU/.test(h)) col.vl = c;
    else if (col.vl && c > col.vl) {
      if (/^GHI CHU/.test(h)) { if (steps.length && !steps[steps.length - 1].note) steps[steps.length - 1].note = c; }
      else steps.push({ ten: h, col: c, note: 0 });
    }
  }
  if (!col.ten || !col.vl || !col.tp) throw new Error('Sheet ' + ten + ' thiếu cột Tên chi tiết / Qui cách thành phẩm / Vật liệu');
  const end = col.bl || col.vl;
  for (let c = col.tp; c < end; c++) {
    const h = k(hr + 1, c);
    if (h === 'DAI' && !col.dai) col.dai = c; else if (h === 'RONG' && !col.rong) col.rong = c;
    else if (h === 'DAY' && !col.day) col.day = c; else if (/^SL/.test(h) && !col.sl) col.sl = c;
  }
  if (!col.dai || !col.rong || !col.day) throw new Error('Không tìm thấy cột Dài/Rộng/Dày dưới "Qui cách thành phẩm"');
  if (!steps.length) throw new Error('Không tìm thấy cột công đoạn nào sau cột Vật liệu');

  const lines = [], canhBao = [], maSPs = new Set();
  for (let r = hr + 2; r <= ws.maxRow; r++) {
    const tenCT = String(g(r, col.ten)).trim(), pk = col.pk ? bomMa(g(r, col.pk)) : '', cum = col.cum ? bomMa(g(r, col.cum)) : '';
    if (!tenCT && !pk && !cum) continue;
    if (typeof g(r, col.ten) === 'number') continue;          // dòng đánh số cột 1, 2, 3…
    const sp = col.sp ? String(g(r, col.sp)).trim() : '';
    if (sp) maSPs.add(sp.toUpperCase());
    const pairs = [], ghiChu = {};
    steps.forEach((s, si) => {
      const v = g(r, s.col);
      const pos = bomViTri(v);
      if (v !== '' && !pos.length) canhBao.push(`Dòng Excel ${r} (${tenCT}): ô ${s.ten} = "${v}" không phải số thứ tự – bỏ qua`);
      pos.forEach(p => pairs.push({ p, si, ten: s.ten }));
      if (s.note && pos.length) { const n = String(g(r, s.note)).replace(/\s+/g, ' ').trim(); if (n) ghiChu[s.ten] = n; }
    });
    pairs.sort((a, b) => a.p - b.p || a.si - b.si);
    for (let i = 1; i < pairs.length; i++) if (pairs[i].p === pairs[i - 1].p)
      canhBao.push(`Dòng Excel ${r} (${tenCT}): ${pairs[i - 1].ten} và ${pairs[i].ten} cùng thứ tự ${pairs[i].p}`);
    lines.push({
      loai: pk ? 'CT' : 'CUM', maCum: cum, maPK: pk, maPL: col.pl ? bomMa(g(r, col.pl)) : '', ten: tenCT,
      dai: g(r, col.dai), rong: g(r, col.rong), day: g(r, col.day), slct: col.sl ? g(r, col.sl) : '',
      vatLieu: String(g(r, col.vl)).trim(), buoc: pairs.map(x => x.ten), ghiChu
    });
  }
  if (!lines.length) throw new Error('Không có dòng dữ liệu nào trong sheet ' + ten);
  return { sheet: ten, maSP: maSPs.size === 1 ? [...maSPs][0] : '', maSPs: [...maSPs], lines, canhBao };
}

/* ============================ TAB SẢN PHẨM & BOM ============================ */
async function bomTai(im) {
  try { BD = await api('/api/bom'); bomVe(); bomDem(); }
  catch (e) { if (!im) loi(e); else $('dsBOM').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
function bomDem() {
  const n = BD && bomCo('bom_duyet') ? BD.versions.filter(v => v.tt === 'CHO_DUYET' && v.nguoiGui !== BD.me).length : 0;
  const el = $('cntBOM'); el.hidden = !n; el.textContent = n;
}
const bomVers = maSP => BD.versions.filter(v => norm(v.maSP) === norm(maSP)).sort((a, b) => a.pb - b.pb);
function bomVe() {
  if (!BD) return;
  const q = norm($('bomQ').value), loc = $('bomLoc').value;
  const rows = BD.products.map(p => {
    const vs = bomVers(p.maSP), cur = vs.filter(v => v.tt === 'DA_DUYET').pop(), last = vs.filter(v => v.tt !== 'DA_HUY').pop();
    const dung = [...new Set(vs.flatMap(v => v.dungTrong))];
    return { p, vs, cur, last, dung, cho: vs.some(v => v.tt === 'CHO_DUYET') };
  }).filter(x => (!q || norm(x.p.maSP + ' ' + x.p.tenSP + ' ' + x.p.quyCach).includes(q)) &&
    (!loc || (loc === 'cho' && x.cho) || (loc === 'chua' && !x.cur) || (loc === 'ngung' && /NGỪNG/i.test(x.p.trangThai))));
  const el = $('dsBOM');
  if (!rows.length) { el.innerHTML = '<div class="empty">' + (BD.products.length ? 'Không có sản phẩm phù hợp.' : 'Chưa có sản phẩm. Bấm "Upload BOM Excel" để tạo sản phẩm đầu tiên.') + '</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Mã SP</th><th>Tên sản phẩm</th><th>Quy cách</th><th>BOM hiện hành</th><th>Phiên bản mới nhất</th><th>Số PB</th><th>Đang dùng trong lệnh</th><th>Trạng thái</th></tr></thead><tbody>' +
    rows.map(x => '<tr class="clk" onclick="bomMoSP(\'' + jsq(x.p.maSP) + '\')"><td><b>' + esc(x.p.maSP) + '</b></td><td class="wrap">' + esc(x.p.tenSP) + '</td><td>' + esc(x.p.quyCach) + '</td>' +
      '<td>' + (x.cur ? esc(x.cur.ma) : '<span class="muted">Chưa có</span>') + '</td>' +
      '<td>' + (x.last ? esc(x.last.ma) + ' ' + bomBadge(x.last.tt) : '—') + '</td><td>' + x.vs.length + '</td>' +
      '<td class="wrap">' + (x.dung.length ? esc(x.dung.slice(0, 4).join(', ')) + (x.dung.length > 4 ? '…' : '') : '<span class="muted">—</span>') + '</td>' +
      '<td>' + badge(x.p.trangThai) + '</td></tr>').join('') + '</tbody></table>';
}

function bomNutPB(v) {
  const h = ['<button class="sm" onclick="bomXemPB(\'' + jsq(v.ma) + '\')">Xem</button>'];
  const vs = bomVers(v.maSP), last = vs.filter(x => x.tt !== 'DA_HUY').pop();
  if (last && last.ma === v.ma && bomCo('bom_sua')) h.push('<button class="sm" onclick="bomSua(\'' + jsq(v.ma) + '\')">✎ Sửa</button>');
  if (v.tt === 'CHO_DUYET' && bomCo('bom_duyet') && v.nguoiGui !== BD.me)
    h.push('<button class="sm ok" onclick="bomDuyet(\'' + jsq(v.ma) + '\')">✔ Duyệt</button><button class="sm" onclick="bomTuChoi(\'' + jsq(v.ma) + '\')">✖ Từ chối</button>');
  if (['CHO_DUYET', 'TU_CHOI'].includes(v.tt) && (v.nguoiGui === BD.me || U.role === 'admin') && !v.dungTrong.length)
    h.push('<button class="sm" onclick="bomHuy(\'' + jsq(v.ma) + '\')">Huỷ bản này</button>');
  return h.join('');
}
function bomMoSP(maSP) {
  const p = BD.products.find(x => norm(x.maSP) === norm(maSP)); if (!p) return;
  const vs = bomVers(maSP).reverse();
  $('drTitle').innerHTML = 'Sản phẩm ' + esc(p.maSP) + ' ' + badge(p.trangThai);
  $('drSub').textContent = p.tenSP;
  let h = '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    (bomCo('bom_sua') ? '<button onclick="bomSuaSP(\'' + jsq(p.maSP) + '\')">✎ Sửa thông tin sản phẩm</button>' : '') +
    (bomCo('bom_up') ? '<button class="pri" onclick="dongPhieu();bomUpload(\'' + jsq(p.maSP) + '\')">⬆ Upload phiên bản BOM mới</button>' : '') + '</div>' +
    '<div class="meta"><div><b>Mã SP</b>' + esc(p.maSP) + '</div><div><b>Tên</b>' + esc(p.tenSP) + '</div><div><b>Quy cách</b>' + esc(p.quyCach || '—') + '</div>' +
    '<div><b>Người tạo</b>' + esc(tenNg(p.nguoiTao)) + '<br><small class="muted">' + esc(p.ngayTao) + '</small></div><div><b>Ghi chú</b>' + esc(p.ghiChu || '—') + '</div></div>' +
    '<h3>Các phiên bản BOM (' + vs.length + ')</h3><div class="card"><div class="scroll"><table><thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Nguồn</th><th>Số CT</th>' +
    '<th>Người gửi</th><th>Người duyệt</th><th>Ghi chú duyệt</th><th>Dùng trong lệnh</th><th></th></tr></thead><tbody>' +
    (vs.length ? vs.map(v => '<tr><td><b>' + esc(v.ma) + '</b></td><td>' + bomBadge(v.tt) + '</td><td class="wrap">' + esc(v.nguon) + (v.ghiChu ? '<br><small class="muted">' + esc(v.ghiChu) + '</small>' : '') + '</td>' +
      '<td>' + v.soCT + '</td><td>' + esc(tenNg(v.nguoiGui)) + '<br><small class="muted">' + esc(v.tgGui) + '</small></td>' +
      '<td>' + esc(tenNg(v.nguoiDuyet)) + (v.tgDuyet ? '<br><small class="muted">' + esc(v.tgDuyet) + '</small>' : '') + '</td>' +
      '<td class="wrap">' + esc(v.ghiChuDuyet) + '</td><td class="wrap">' + (v.dungTrong.length ? '🔒 ' + esc(v.dungTrong.join(', ')) : '<span class="muted">—</span>') + '</td>' +
      '<td class="act">' + bomNutPB(v) + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">Chưa có phiên bản BOM.</td></tr>') +
    '</tbody></table></div></div>' +
    '<p class="note">🔒 Phiên bản đã nằm trong lệnh sản xuất (kể cả lệnh đang chờ duyệt) không bị sửa trực tiếp: khi sửa, hệ thống tự sao chép thành phiên bản cao hơn. Mọi lần upload/sửa đều phải được một tài khoản khác duyệt.</p>';
  moDrawer(h);
}

function bomBangDong(lines) {
  return '<div class="card"><div class="scroll"><table class="bomtb"><thead><tr><th>#</th><th>Mã cụm</th><th>Mã PK</th><th>Tên chi tiết</th><th class="r">Dài</th><th class="r">Rộng</th><th class="r">Dày</th>' +
    '<th class="r">SLCT</th><th>Vật liệu</th><th>Quy trình công đoạn</th></tr></thead><tbody>' +
    lines.map((l, i) => '<tr class="' + (l.loai === 'CUM' ? 'cum' : '') + '"><td>' + (l.stt || i + 1) + '</td><td>' + esc(l.maCum) + '</td><td>' + esc(l.maPK) + '</td>' +
      '<td class="wrap">' + esc(l.ten) + (l.loai === 'CUM' ? ' <small class="muted">(cụm)</small>' : '') + '</td>' +
      '<td class="r">' + esc(bomSo(l.dai)) + '</td><td class="r">' + esc(bomSo(l.rong)) + '</td><td class="r">' + esc(bomSo(l.day)) + '</td><td class="r">' + esc(bomSo(l.slct)) + '</td>' +
      '<td>' + esc(l.vatLieu) + '</td><td>' + (l.loai === 'CUM' ? '' : l.buoc.length ? bomChips(l.buoc) : '<span class="badge b-late">Chưa có</span>') +
      (Object.keys(l.ghiChu || {}).length ? '<small class="muted">' + esc(Object.entries(l.ghiChu).map(([a, b]) => a + ': ' + b).join(' · ')) + '</small>' : '') + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}
async function bomXemPB(ma) {
  try {
    loading(true, 'Đang tải BOM…');
    const r = await api('/api/bom?a=lines&ma=' + encodeURIComponent(ma)), v = r.version;
    $('drTitle').innerHTML = 'BOM ' + esc(v.ma) + ' ' + bomBadge(v.tt);
    $('drSub').textContent = 'Sản phẩm ' + v.maSP + ' · ' + v.soCT + ' chi tiết · ' + v.nguon;
    moDrawer('<div style="display:flex;gap:8px;justify-content:flex-end"><button onclick="bomMoSP(\'' + jsq(v.maSP) + '\')">← Về sản phẩm</button>' + bomNutPB(v) + '</div>' +
      '<div class="meta"><div><b>Người gửi</b>' + esc(tenNg(v.nguoiGui)) + '<br><small class="muted">' + esc(v.tgGui) + '</small></div>' +
      '<div><b>Người duyệt</b>' + esc(tenNg(v.nguoiDuyet) || '—') + '<br><small class="muted">' + esc(v.tgDuyet) + '</small></div>' +
      '<div><b>Sao chép từ</b>' + esc(v.tuPB || '—') + '</div><div><b>Dùng trong lệnh</b>' + esc(v.dungTrong.join(', ') || '—') + '</div>' +
      '<div><b>Ghi chú</b>' + esc(v.ghiChu || '—') + '</div><div><b>Ghi chú duyệt</b>' + esc(v.ghiChuDuyet || '—') + '</div></div>' + bomBangDong(r.lines));
  } catch (e) { loi(e); } finally { loading(false); }
}

/* ---------- Upload BOM ---------- */
function bomUpload(maSPsan) {
  let doc = null, kq = null, file = null;
  const body = '<div class="infobox">Chọn file BOM Excel (.xlsx) có sheet <b>QUY TRINH SAN XUAT</b>. File được đọc ngay trên máy tính này, không lưu file lên máy chủ. ' +
    'Chỉ dòng có <b>Mã phụ kiện</b> là chi tiết sản xuất; dòng chỉ có Mã cụm được giữ làm tiêu đề cụm. Sau khi gửi, BOM cần một <b>tài khoản duyệt khác</b> xác nhận.</div>' +
    '<div class="form"><label class="full">File BOM Excel<input type="file" id="bomFile" accept=".xlsx,.xlsm"></label>' +
    '<label>Mã sản phẩm<input id="bomMaSP" value="' + esc(maSPsan || '') + '" placeholder="vd. V0454"></label>' +
    '<label>Tên sản phẩm<input id="bomTenSP"></label><label>Quy cách<input id="bomQC"></label>' +
    '<label class="full">Ghi chú phiên bản<input id="bomGC" placeholder="vd. Bản gốc từ phòng kỹ thuật / sửa kích thước hộc kéo…"></label></div>' +
    '<div id="bomKQ" style="margin-top:12px"></div>';
  const kiemTra = async m => {
    const out = m.querySelector('#bomKQ');
    if (!doc) { out.innerHTML = ''; return; }
    const maSP = m.querySelector('#bomMaSP').value.trim();
    if (!maSP) { out.innerHTML = '<div class="warnbox">Nhập mã sản phẩm.</div>'; kq = null; return; }
    out.innerHTML = '<div class="muted">Đang kiểm tra…</div>';
    kq = await api('/api/bom', { body: { a: 'upload', dryRun: true, maSP, tenSP: m.querySelector('#bomTenSP').value, lines: doc.lines } });
    if (kq.product && !m.querySelector('#bomTenSP').value) { m.querySelector('#bomTenSP').value = kq.product.tenSP; m.querySelector('#bomQC').value = kq.product.quyCach; }
    const nCT = kq.lines.filter(l => l.loai === 'CT').length;
    out.innerHTML = '<div class="' + (kq.errors.length ? 'warnbox' : 'infobox') + '">' + (kq.isNew ? '<b>Sản phẩm mới</b> ' + esc(maSP.toUpperCase()) : 'Sản phẩm đã có – tạo <b>phiên bản mới</b>') +
      ' → mã BOM <b>' + esc(kq.ma) + '</b>. ' + kq.lines.length + ' dòng (' + nCT + ' chi tiết). File: ' + esc(file.name) + ' / sheet ' + esc(doc.sheet) + '</div>' +
      bomList(kq.errors, 'warnbox', 'Lỗi cần sửa trong file:') + bomList(doc.canhBao.concat(kq.warnings), 'infobox', 'Lưu ý:') + bomBangDong(kq.lines);
  };
  modal({
    title: 'Upload BOM sản phẩm', wide: true, body,
    onOpen: m => {
      m.querySelector('#bomFile').addEventListener('change', async e => {
        file = e.target.files[0]; doc = null; kq = null;
        const out = m.querySelector('#bomKQ'), err = m.querySelector('.err'); err.textContent = '';
        if (!file) return;
        try {
          out.innerHTML = '<div class="muted">Đang đọc file…</div>';
          doc = await bomDocExcel(file);
          if (doc.maSPs.length > 1) throw new Error('File chứa nhiều mã sản phẩm ở cột MA SP: ' + doc.maSPs.join(', ') + ' – mỗi file chỉ 1 sản phẩm');
          if (doc.maSP && !m.querySelector('#bomMaSP').value) m.querySelector('#bomMaSP').value = doc.maSP;
          else if (doc.maSP && norm(m.querySelector('#bomMaSP').value) !== norm(doc.maSP)) err.textContent = 'Chú ý: mã trong file là ' + doc.maSP + ', khác mã đang nhập.';
          await kiemTra(m);
        } catch (x) { doc = null; out.innerHTML = ''; err.textContent = x.message; }
      });
      ['#bomMaSP', '#bomTenSP'].forEach(s => m.querySelector(s).addEventListener('change', () => kiemTra(m).catch(x => { m.querySelector('.err').textContent = x.message; })));
    },
    buttons: [{ t: 'Gửi duyệt', cls: 'pri', fn: async m => {
      if (!doc) throw new Error('Chưa chọn file BOM');
      const g = s => m.querySelector(s).value;
      const r = await api('/api/bom', { body: { a: 'upload', maSP: g('#bomMaSP'), tenSP: g('#bomTenSP'), quyCach: g('#bomQC'), ghiChu: g('#bomGC'), nguon: 'Upload ' + file.name, lines: doc.lines } });
      toast('Đã upload ' + r.ma + ' – chờ người duyệt BOM xác nhận');
      await bomTai();
    } }]
  });
}

/* ---------- Sửa BOM ---------- */
const bomO = (k, v, cls, ph) => '<td><input data-k="' + k + '" class="' + (cls || '') + '" value="' + esc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></td>';
function bomDongSua(l) {
  l = l || { loai: 'CT', buoc: [], ghiChu: {} };
  const gc = Object.entries(l.ghiChu || {}).map(([a, b]) => a + ': ' + b).join('; ');
  return '<tr data-pl="' + esc(l.maPL || '') + '"><td><select data-k="loai"><option value="CT"' + (l.loai !== 'CUM' ? ' selected' : '') + '>Chi tiết</option><option value="CUM"' + (l.loai === 'CUM' ? ' selected' : '') + '>Cụm</option></select></td>' +
    bomO('maCum', l.maCum, 'w-s') + bomO('maPK', l.maPK, 'w-s') + bomO('ten', l.ten, 'w-l') + bomO('dai', l.dai, 'w-n') + bomO('rong', l.rong, 'w-n') + bomO('day', l.day, 'w-n') +
    bomO('slct', l.slct, 'w-n') + bomO('vatLieu', l.vatLieu, 'w-m') + bomO('buoc', (l.buoc || []).join(' > '), 'w-xl', 'CẮT VÁN > DÁN BIÊN > KHO THÀNH PHẨM') +
    bomO('ghiChu', gc, 'w-l', 'CẮT VÁN: ghi chú; …') +
    '<td class="act" style="white-space:nowrap"><button class="sm" title="Lên" onclick="bomDongLen(this)">↑</button><button class="sm" title="Chèn dòng dưới" onclick="bomDongChen(this)">＋</button><button class="sm" title="Xoá dòng" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>';
}
function bomDongLen(b) { const tr = b.closest('tr'); if (tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling); }
function bomDongChen(b) { b.closest('tr').insertAdjacentHTML('afterend', bomDongSua()); }
function bomThuDong(m) {
  return [...m.querySelectorAll('#bomEdit tbody tr')].map(tr => {
    const o = { maPL: tr.dataset.pl };
    tr.querySelectorAll('[data-k]').forEach(i => { o[i.dataset.k] = i.value.trim(); });
    const gc = {}; String(o.ghiChu || '').split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0 && p.slice(i + 1).trim()) gc[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    o.ghiChu = gc;
    return o;
  }).filter(o => o.ten || o.maPK || o.maCum);
}
async function bomSua(ma) {
  let r;
  try { loading(true, 'Đang tải BOM…'); r = await api('/api/bom?a=lines&ma=' + encodeURIComponent(ma)); }
  catch (e) { loi(e); return; } finally { loading(false); }
  dongPhieu();
  const v = r.version, dung = v.dungTrong.length;
  const body = (dung
    ? '<div class="warnbox">🔒 Phiên bản <b>' + esc(v.ma) + '</b> đang nằm trong lệnh sản xuất: <b>' + esc(v.dungTrong.join(', ')) + '</b>.<br>Khi lưu, hệ thống <b>sao chép thành phiên bản mới</b> và áp dụng thay đổi trên bản mới; bản cũ và các lệnh đã tạo giữ nguyên.</div>'
    : '<div class="infobox">Phiên bản chưa dùng trong lệnh nào – sửa trực tiếp. Sau khi lưu, phiên bản chuyển về <b>Chờ duyệt</b> và chỉ dùng tạo lệnh được khi đã duyệt lại.</div>') +
    '<p class="muted" style="margin:6px 0">Quy trình: ghi các công đoạn theo thứ tự, ngăn cách bằng dấu <b>&gt;</b>. Công đoạn lặp lại (vd. cắt ván 2 lần) cứ ghi lại tên, hệ thống tự đánh số khi tạo phiếu. Danh mục: ' +
    BD.steps.map(s => '<span class="step">' + esc(s) + '</span>').join(' ') + '</p>' +
    '<div class="scroll" style="max-height:55vh"><table id="bomEdit" class="bomed"><thead><tr><th>Loại</th><th>Mã cụm</th><th>Mã PK</th><th>Tên chi tiết</th><th>Dài</th><th>Rộng</th><th>Dày</th><th>SLCT</th><th>Vật liệu</th><th>Quy trình công đoạn</th><th>Ghi chú công đoạn</th><th></th></tr></thead><tbody>' +
    r.lines.map(bomDongSua).join('') + '</tbody></table></div>' +
    '<div class="form" style="margin-top:10px"><label class="full">Ghi chú phiên bản / lý do sửa<input id="bomGC" value="' + esc(v.ghiChu) + '"></label></div><div id="bomKQ"></div>';
  modal({
    title: 'Sửa BOM ' + esc(v.ma), wide: true, body,
    buttons: [
      { t: '+ Thêm dòng', fn: m => { m.querySelector('#bomEdit tbody').insertAdjacentHTML('beforeend', bomDongSua()); return false; } },
      { t: 'Kiểm tra', fn: async m => {
        const k = await api('/api/bom', { body: { a: 'edit', dryRun: true, ma: v.ma, lines: bomThuDong(m), ghiChu: m.querySelector('#bomGC').value } });
        m.querySelector('#bomKQ').innerHTML = (k.errors.length ? bomList(k.errors, 'warnbox', 'Lỗi:') : '<div class="infobox">Hợp lệ. Khi lưu: ' +
          (k.mode === 'new' ? 'tạo phiên bản mới <b>' + esc(k.newMa) + '</b>' : 'cập nhật <b>' + esc(k.newMa) + '</b>') + ' – chờ duyệt.</div>') + bomList(k.warnings, 'infobox', 'Lưu ý:');
        return false;
      } },
      { t: 'Lưu & gửi duyệt', cls: 'pri', fn: async m => {
        const lines = bomThuDong(m), ghiChu = m.querySelector('#bomGC').value;
        const k = await api('/api/bom', { body: { a: 'edit', dryRun: true, ma: v.ma, lines, ghiChu } });
        if (k.errors.length) { m.querySelector('#bomKQ').innerHTML = bomList(k.errors, 'warnbox', 'Lỗi:'); throw new Error('BOM còn ' + k.errors.length + ' lỗi – xem danh sách bên trên'); }
        if (k.mode === 'new' && !(await bomXacNhan('Tạo phiên bản BOM mới',
          '<p>' + esc(v.ma) + ' đang dùng trong lệnh <b>' + esc(k.usedIn.join(', ')) + '</b>.</p><p>Thay đổi sẽ được lưu thành phiên bản mới <b>' + esc(k.newMa) + '</b> (chờ duyệt). Tiếp tục?</p>', 'Tạo ' + k.newMa))) return false;
        const s = await api('/api/bom', { body: { a: 'edit', ma: v.ma, lines, ghiChu } });
        toast((s.mode === 'new' ? 'Đã tạo phiên bản mới ' : 'Đã cập nhật ') + s.ma + ' – chờ duyệt');
        await bomTai(); bomMoSP(v.maSP);
      } }
    ]
  });
}

/* ---------- Duyệt / từ chối / huỷ ---------- */
async function bomDuyet(ma) {
  let r;
  try { loading(true, 'Đang tải BOM…'); r = await api('/api/bom?a=lines&ma=' + encodeURIComponent(ma)); }
  catch (e) { loi(e); return; } finally { loading(false); }
  const v = r.version, vs = bomVers(v.maSP), cur = vs.filter(x => x.tt === 'DA_DUYET').pop();
  modal({
    title: 'Duyệt BOM ' + esc(v.ma), wide: true,
    body: '<p>Gửi bởi <b>' + esc(tenNg(v.nguoiGui)) + '</b> lúc ' + esc(v.tgGui) + ' · ' + esc(v.nguon) + (v.ghiChu ? ' · <i>' + esc(v.ghiChu) + '</i>' : '') + '</p>' +
      (cur ? '<div class="infobox">Sau khi duyệt, <b>' + esc(v.ma) + '</b> thành BOM hiện hành; <b>' + esc(cur.ma) + '</b> chuyển sang "Đã thay thế" (các lệnh đã tạo không đổi).</div>' : '') +
      bomBangDong(r.lines) + '<div class="form" style="margin-top:10px"><label class="full">Ghi chú duyệt (không bắt buộc)<input id="gcBom"></label></div>',
    buttons: [{ t: '✔ Duyệt BOM', cls: 'ok', fn: async m => {
      await api('/api/bom', { body: { a: 'approve', ma: v.ma, hash: v.hash, note: m.querySelector('#gcBom').value } });
      toast('Đã duyệt ' + v.ma); dongPhieu(); await bomTai(); lxTai(true);
    } }]
  });
}
function bomTuChoi(ma) {
  modal({
    title: 'Từ chối BOM ' + esc(ma), body: '<div class="form"><label class="full">Lý do từ chối (bắt buộc)<textarea id="gcBom" rows="3"></textarea></label></div>',
    buttons: [{ t: 'Từ chối', cls: 'danger', fn: async m => { await api('/api/bom', { body: { a: 'reject', ma, note: m.querySelector('#gcBom').value } }); toast('Đã từ chối ' + ma); dongPhieu(); await bomTai(); } }]
  });
}
function bomHuy(ma) {
  modal({
    title: 'Huỷ phiên bản ' + esc(ma), body: '<p>Huỷ phiên bản BOM này? Phiên bản đã huỷ không thể duyệt hay dùng tạo lệnh.</p>',
    buttons: [{ t: 'Huỷ phiên bản', cls: 'danger', fn: async () => { await api('/api/bom', { body: { a: 'cancel', ma } }); toast('Đã huỷ ' + ma); dongPhieu(); await bomTai(); } }]
  });
}
function bomSuaSP(maSP) {
  const p = maSP ? BD.products.find(x => norm(x.maSP) === norm(maSP)) : null;
  modal({
    title: p ? 'Sửa sản phẩm ' + esc(p.maSP) : 'Thêm sản phẩm',
    body: '<div class="form"><label>Mã sản phẩm<input id="spMa" value="' + esc(p ? p.maSP : '') + '"' + (p ? ' readonly' : '') + '></label>' +
      '<label>Tên sản phẩm<input id="spTen" value="' + esc(p ? p.tenSP : '') + '"></label><label>Quy cách<input id="spQC" value="' + esc(p ? p.quyCach : '') + '"></label>' +
      '<label>Trạng thái<select id="spTT"><option' + (!p || !/NGỪNG/i.test(p.trangThai) ? ' selected' : '') + '>Đang dùng</option><option' + (p && /NGỪNG/i.test(p.trangThai) ? ' selected' : '') + '>Ngừng</option></select></label>' +
      '<label class="full">Ghi chú<input id="spGC" value="' + esc(p ? p.ghiChu : '') + '"></label></div>' +
      '<p class="muted">Sản phẩm "Ngừng" không được chọn khi tạo lệnh sản xuất. Thông tin sản phẩm không cần duyệt; nội dung BOM luôn cần duyệt.</p>',
    buttons: [{ t: 'Lưu', cls: 'pri', fn: async m => {
      const g = s => m.querySelector(s).value;
      await api('/api/bom', { body: { a: 'product', maSP: g('#spMa'), tenSP: g('#spTen'), quyCach: g('#spQC'), trangThai: g('#spTT'), ghiChu: g('#spGC') } });
      toast('Đã lưu sản phẩm'); await bomTai(); if (p) bomMoSP(p.maSP);
    } }]
  });
}

/* ============================ TAB TẠO LỆNH SX TỪ BOM ============================ */
async function lxTai(im) {
  try { LXD = await api('/api/lenh'); lxVe(); lxDem(); }
  catch (e) { if (!im) loi(e); else $('dsLX').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
function lxDem() {
  const n = LXD && bomCo('lsx_duyet') ? LXD.list.filter(d => d.tt === 'CHO_DUYET' && d.nguoiTao !== LXD.me).length : 0;
  const el = $('cntLX'); el.hidden = !n; el.textContent = n;
}
function lxLoc(b) { lxLocV = b.dataset.v; document.querySelectorAll('#lxLoc button').forEach(x => x.classList.toggle('on', x === b)); lxVe(); }
function lxNut(d) {
  const h = ['<button class="sm" onclick="event.stopPropagation();lxXem(\'' + d.id + '\')">Xem</button>'];
  if (d.tt === 'CHO_DUYET' && bomCo('lsx_duyet') && d.nguoiTao !== LXD.me)
    h.push('<button class="sm ok" onclick="event.stopPropagation();lxDuyet(\'' + d.id + '\')">✔ Phê duyệt</button><button class="sm" onclick="event.stopPropagation();lxTuChoi(\'' + d.id + '\')">✖ Từ chối</button>');
  if (d.tt === 'CHO_DUYET' && (d.nguoiTao === LXD.me || U.role === 'admin')) h.push('<button class="sm" onclick="event.stopPropagation();lxHuy(\'' + d.id + '\')">Huỷ</button>');
  return h.join('');
}
function lxVe() {
  if (!LXD) return;
  const ds = LXD.list.filter(d => lxLocV === 'all' || (lxLocV === 'cho' ? d.tt === 'CHO_DUYET' || d.tt === 'DANG_XU_LY' : d.nguoiTao === LXD.me));
  const el = $('dsLX');
  if (!ds.length) { el.innerHTML = '<div class="empty">' + (lxLocV === 'cho' ? 'Không có đề xuất lệnh nào đang chờ duyệt.' : 'Chưa có đề xuất lệnh.') + '</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Mã đề xuất</th><th>Số LSX</th><th>Tên lệnh</th><th>Nội dung</th><th>Người tạo</th><th>Trạng thái</th><th>Người duyệt</th><th>Ghi chú duyệt</th><th></th></tr></thead><tbody>' +
    ds.map(d => '<tr class="clk" onclick="lxXem(\'' + d.id + '\')"><td>' + esc(d.id) + '</td><td><b>' + esc(d.soLSX) + '</b></td><td class="wrap">' + esc(d.tenLSX) + '</td>' +
      '<td class="wrap">' + esc(d.tomTat) + '</td><td>' + esc(tenNg(d.nguoiTao)) + '<br><small class="muted">' + esc(d.tgTao) + '</small></td><td>' + bomBadge(d.tt, true) + '</td>' +
      '<td>' + esc(tenNg(d.nguoiDuyet)) + (d.tgDuyet ? '<br><small class="muted">' + esc(d.tgDuyet) + '</small>' : '') + '</td><td class="wrap">' + esc(d.ghiChuDuyet) + '</td>' +
      '<td class="act">' + lxNut(d) + '</td></tr>').join('') + '</tbody></table>';
}

/** Hiển thị bản xem trước: tổng quan, lỗi/lưu ý, sản phẩm, từng phiếu với danh sách chi tiết. */
function lxVePlan(p) {
  const t = p.totals, h = p.header || {};
  return '<section class="kpis" style="margin-top:10px">' + [['Sản phẩm', t.sp], ['Phiếu sản xuất', t.psx], ['Dòng chi tiết', t.dong], ['Tổng số chi tiết', fSL(t.chiTiet)]]
    .map(k => '<div class="kpi"><div class="l">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>').join('') + '</section>' +
    bomList(p.errors, 'warnbox', 'Lỗi – chưa thể tạo lệnh:') + bomList(p.warnings, 'infobox', 'Lưu ý:') +
    '<div class="meta"><div><b>Số LSX</b>' + esc(h.soLSX) + '</div><div><b>Tên lệnh</b>' + esc(h.tenLSX) + '</div><div><b>Ngày cấp</b>' + esc(h.ngayCap) + '</div>' +
    '<div><b>Người cấp</b>' + esc(h.nguoiCap) + '</div><div><b>Hạn hoàn thành</b>' + esc(h.hanHT) + '</div></div>' +
    '<div class="card"><div class="scroll"><table><thead><tr><th>Mã SP</th><th>Tên sản phẩm</th><th>Phiên bản BOM</th><th class="r">Số bộ</th></tr></thead><tbody>' +
    p.items.map(i => '<tr><td><b>' + esc(i.maSP) + '</b></td><td>' + esc(i.tenSP) + '</td><td>' + esc(i.ma) + '</td><td class="r">' + fSL(i.sl) + '</td></tr>').join('') + '</tbody></table></div></div>' +
    '<h3>Phiếu sản xuất sẽ tạo (' + p.psx.length + ') – gộp chi tiết cùng tên, vật liệu, độ dày và quy trình</h3>' +
    p.psx.map((x, i) => '<details class="pf"' + (i < 3 ? ' open' : '') + '><summary><b>' + esc(x.ma) + '</b> · ' + esc(x.ten) + ' · ' + esc(x.vatLieu) + ' · ' + x.lines.length + ' dòng · ' +
      fSL(x.lines.reduce((a, l) => a + l.tong, 0)) + ' chi tiết</summary><div class="in">' + bomChips(x.buoc) +
      '<div class="scroll" style="margin-top:8px"><table><thead><tr><th>Mã dòng</th><th>Nhãn</th><th class="r">Dài</th><th class="r">Rộng</th><th class="r">SL/bộ</th><th class="r">Tổng SL</th></tr></thead><tbody>' +
      x.lines.map(l => '<tr><td>' + esc(l.ma) + '</td><td>' + esc(l.nhan) + '</td><td class="r">' + esc(l.dai) + '</td><td class="r">' + esc(l.rong) + '</td><td class="r">' + esc(l.sl1) + '</td><td class="r"><b>' + fSL(l.tong) + '</b></td></tr>').join('') +
      '</tbody></table></div></div></details>').join('');
}

const lxIso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const lxDmy = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
function lxDongSP() {
  return '<tr><td><select data-k="ma" style="min-width:380px"><option value="">— Chọn sản phẩm (BOM hiện hành) —</option>' +
    LXD.choices.map(c => '<option value="' + esc(c.ma) + '">' + esc(c.maSP + ' – ' + c.tenSP + ' (' + c.ma + ', ' + c.soCT + ' CT)') + '</option>').join('') + '</select></td>' +
    '<td><input data-k="sl" type="number" min="1" step="1" style="width:110px" placeholder="Số bộ"></td>' +
    '<td><button class="sm" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>';
}
function lxThu(m) {
  const g = s => m.querySelector(s).value;
  return {
    header: { soLSX: g('#lxSo'), tenLSX: g('#lxTen'), ngayCap: lxDmy(g('#lxNgay')), nguoiCap: g('#lxNguoi'), hanHT: lxDmy(g('#lxHan')) },
    items: [...m.querySelectorAll('#lxSP tbody tr')].map(tr => ({ ma: tr.querySelector('[data-k=ma]').value, sl: tr.querySelector('[data-k=sl]').value })).filter(x => x.ma)
  };
}
function lxTao() {
  if (!LXD) return;
  if (!LXD.choices.length) { toast('Chưa có sản phẩm nào có BOM đã duyệt.'); return; }
  let daXem = null;
  const body = '<div class="infobox">Bước 1: nhập thông tin lệnh và chọn sản phẩm → <b>Xem trước</b>. Bước 2: kiểm tra các phiếu → <b>Xác nhận & gửi duyệt</b>. ' +
    'Lệnh chỉ được ghi vào sheet LSX / Phieu_San_Xuat / Chi_Tiet_PSX khi <b>một tài khoản duyệt khác</b> phê duyệt.</div>' +
    '<div class="form"><label>Số LSX<input id="lxSo" value="' + esc(LXD.suggest) + '"></label><label class="full" style="grid-column:span 2">Tên lệnh<input id="lxTen" placeholder="vd. 605 MLM6626---PO - 5090-5132"></label>' +
    '<label>Ngày cấp lệnh<input id="lxNgay" type="date" value="' + lxIso(LXD.today) + '"></label><label>Người cấp lệnh<input id="lxNguoi" value="' + esc(U.name) + '"></label>' +
    '<label>Hạn hoàn thành<input id="lxHan" type="date"></label></div>' +
    '<h3>Sản phẩm trong lệnh</h3><table id="lxSP"><thead><tr><th>Sản phẩm / BOM</th><th>Số lượng (bộ)</th><th></th></tr></thead><tbody>' + lxDongSP() + '</tbody></table>' +
    '<div id="lxXemTruoc"></div>';
  modal({
    title: 'Tạo lệnh sản xuất từ BOM', wide: true, body,
    buttons: [
      { t: '+ Thêm sản phẩm', fn: m => { m.querySelector('#lxSP tbody').insertAdjacentHTML('beforeend', lxDongSP()); return false; } },
      { t: '👁 Xem trước', fn: async m => {
        const inp = lxThu(m);
        const r = await api('/api/lenh', { body: { a: 'preview', ...inp } });
        daXem = { key: JSON.stringify(inp), ok: !r.plan.errors.length };
        m.querySelector('#lxXemTruoc').innerHTML = '<h3>Xem trước</h3>' + lxVePlan(r.plan);
        m.querySelector('#lxXemTruoc').scrollIntoView({ behavior: 'smooth' });
        return false;
      } },
      { t: 'Xác nhận & gửi duyệt', cls: 'pri', fn: async m => {
        const inp = lxThu(m);
        if (!daXem || daXem.key !== JSON.stringify(inp)) throw new Error('Hãy bấm "Xem trước" (thông tin đã thay đổi kể từ lần xem trước)');
        if (!daXem.ok) throw new Error('Bản xem trước còn lỗi – hãy sửa trước khi gửi');
        const r = await api('/api/lenh', { body: { a: 'create', ...inp } });
        toast('Đã gửi đề xuất ' + r.id + ' – chờ phê duyệt'); await lxTai(); bomTai(true);
      } }
    ]
  });
}
async function lxLay(id) {
  loading(true, 'Đang lập bản xem trước…');
  try { return await api('/api/lenh', { body: { a: 'view', id } }); } finally { loading(false); }
}
async function lxXem(id) {
  try {
    const r = await lxLay(id), d = r.draft;
    $('drTitle').innerHTML = 'Lệnh ' + esc(d.soLSX) + ' ' + bomBadge(d.tt, true);
    $('drSub').textContent = d.id + ' · tạo bởi ' + tenNg(d.nguoiTao) + ' lúc ' + d.tgTao;
    moDrawer('<div style="display:flex;gap:8px;justify-content:flex-end">' + lxNut(d).replace(/event\.stopPropagation\(\);/g, 'dongPhieu();') + '</div>' +
      (d.tt !== 'CHO_DUYET' ? '<div class="infobox">' + esc(bomTT[d.tt === 'DA_DUYET' ? 'DA_DUYET_LX' : d.tt]?.[0] || d.tt) + (d.nguoiDuyet ? ' bởi ' + esc(tenNg(d.nguoiDuyet)) + ' lúc ' + esc(d.tgDuyet) : '') +
        (d.ghiChuDuyet ? ' – ' + esc(d.ghiChuDuyet) : '') + '. ' + (d.tt === 'DA_DUYET' ? 'Bản dưới đây tính lại từ BOM hiện tại để đối chiếu; dữ liệu thật xem ở tab Tình trạng lệnh sản xuất.' : '') + '</div>' : '') +
      lxVePlan(r.plan));
  } catch (e) { loi(e); }
}
async function lxDuyet(id) {
  let r;
  try { r = await lxLay(id); } catch (e) { loi(e); return; }
  const d = r.draft;
  modal({
    title: 'Phê duyệt lệnh ' + esc(d.soLSX), wide: true,
    body: '<p>Đề xuất bởi <b>' + esc(tenNg(d.nguoiTao)) + '</b> lúc ' + esc(d.tgTao) + '.</p>' + lxVePlan(r.plan) +
      '<div class="form" style="margin-top:10px"><label class="full">Ghi chú (không bắt buộc)<input id="gcLX"></label></div>' +
      '<p class="muted">Phê duyệt sẽ ghi 1 dòng LSX, ' + r.plan.totals.psx + ' phiếu và ' + r.plan.totals.dong + ' dòng chi tiết vào Google Sheet trong một lần ghi; các phiên bản BOM dùng trong lệnh bị khoá sửa trực tiếp.</p>',
    buttons: [{ t: '✔ Phê duyệt & tạo lệnh', cls: 'ok', fn: async m => {
      if (r.plan.errors.length) throw new Error('Bản xem trước còn lỗi – không thể phê duyệt. Hãy từ chối để người tạo lập lại.');
      const x = await api('/api/lenh', { body: { a: 'approve', id, note: m.querySelector('#gcLX').value } });
      toast('Đã tạo lệnh ' + d.soLSX + ': ' + x.result.psx + ' phiếu, ' + x.result.ct + ' dòng chi tiết');
      dongPhieu(); await lxTai(); bomTai(true); taiDuLieu(true);
    } }]
  });
}
function lxTuChoi(id) {
  modal({
    title: 'Từ chối đề xuất ' + esc(id), body: '<div class="form"><label class="full">Lý do từ chối (bắt buộc)<textarea id="gcLX" rows="3"></textarea></label></div>',
    buttons: [{ t: 'Từ chối', cls: 'danger', fn: async m => { await api('/api/lenh', { body: { a: 'reject', id, note: m.querySelector('#gcLX').value } }); toast('Đã từ chối'); dongPhieu(); await lxTai(); bomTai(true); } }]
  });
}
function lxHuy(id) {
  modal({
    title: 'Huỷ đề xuất ' + esc(id), body: '<p>Huỷ đề xuất lệnh này? Không có dữ liệu nào được ghi vào sheet lệnh sản xuất.</p>',
    buttons: [{ t: 'Huỷ đề xuất', cls: 'danger', fn: async () => { await api('/api/lenh', { body: { a: 'cancel', id } }); toast('Đã huỷ'); dongPhieu(); await lxTai(); bomTai(true); } }]
  });
}
