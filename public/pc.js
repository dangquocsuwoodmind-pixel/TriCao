/* Trang máy tính Trí Cao */
'use strict';
const { api, esc, num, norm, fSL, fM3, pad, keyNgay, hienNgay, thuCua, gioGhi, badge, bar, can, badgeYC } = TC;

let U = null;            // người dùng hiện tại
let M = null;            // dữ liệu đã tính toán
let F = null;            // định nghĩa trường được sửa (từ máy chủ)
let YC = [];             // danh sách yêu cầu
let locYCv = 'cho';
const moLSX = new Set();
let hienSL = 'ca';
const $ = id => document.getElementById(id);

/* ====================== Khung chung ====================== */
function toast(msg, ms) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms || 3500);
}
function loading(on, txt) { const l = $('loading'); l.textContent = txt || 'Đang tải dữ liệu…'; l.style.display = on ? 'flex' : 'none'; }
function loi(e) {
  if (e && e.status === 401) { hienDangNhap(false); return; }
  toast('Lỗi: ' + (e && e.message || e), 6000);
}

/** Hộp thoại. buttons: [{t, cls, fn(el) → Promise; trả về false để giữ hộp thoại}] */
function modal(o) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '"><div class="mh"><h2>' + o.title + '</h2><button class="sm" data-x>✕</button></div>' +
    '<div class="mb">' + o.body + '<div class="err"></div></div><div class="mf"></div></div>';
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.querySelector('[data-x]').onclick = close;
  const mf = bg.querySelector('.mf'), err = bg.querySelector('.err');
  (o.buttons || []).concat([{ t: 'Đóng', fn: () => true }]).forEach(b => {
    const btn = document.createElement('button'); btn.textContent = b.t; if (b.cls) btn.className = b.cls;
    btn.onclick = async () => {
      err.textContent = ''; mf.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { const r = await b.fn(bg.querySelector('.modal')); if (r !== false) close(); }
      catch (e) { if (e.status === 401) { close(); hienDangNhap(false); } else err.textContent = e.message; }
      finally { mf.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
    };
    mf.appendChild(btn);
  });
  document.body.appendChild(bg);
  if (o.onOpen) o.onOpen(bg.querySelector('.modal'));
  const f = bg.querySelector('input:not([readonly]),textarea,select'); if (f) f.focus();
  return bg;
}

/* ====================== Đăng nhập ====================== */
function hienDangNhap(needSetup, msg) {
  U = null;
  const box = $('authBox');
  box.innerHTML = needSetup
    ? '<h2>Khởi tạo hệ thống</h2><p class="muted">Chưa có quản trị viên. Nhập mã khởi tạo (SETUP_KEY) để tạo tài khoản quản trị đầu tiên.</p>' +
      '<form class="form" onsubmit="event.preventDefault();khoiTao(this)">' +
      '<label>Mã khởi tạo<input name="key" type="password" required></label><label>Họ tên<input name="name" required></label>' +
      '<label>Email<input name="email" type="email" required autocomplete="username"></label>' +
      '<label>Mật khẩu (≥ 6 ký tự)<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>' +
      '<button class="pri">Tạo quản trị viên</button><div class="err"></div></form>'
    : '<h2>Trí Cao – Quản lý sản xuất</h2><p class="muted">Đăng nhập bản máy tính</p>' +
      '<form class="form" onsubmit="event.preventDefault();dangNhap(this)">' +
      '<label>Email<input name="email" type="email" required autocomplete="username"></label>' +
      '<label>Mật khẩu<input name="password" type="password" required autocomplete="current-password"></label>' +
      '<button class="pri">Đăng nhập</button><div class="err">' + esc(msg || '') + '</div></form>';
  $('auth').style.display = 'flex';
  const f = box.querySelector('input'); if (f) f.focus();
}
async function guiForm(form, url) {
  const err = form.querySelector('.err'), btn = form.querySelector('button');
  err.textContent = ''; btn.disabled = true;
  try {
    const r = await api(url, { body: Object.fromEntries(new FormData(form)) });
    U = r.user; vaoApp();
  } catch (e) { err.textContent = e.message; }
  finally { btn.disabled = false; }
}
const dangNhap = f => guiForm(f, '/api/auth?a=login');
const khoiTao = f => guiForm(f, '/api/auth?a=setup');
async function dangXuat() { try { await api('/api/auth?a=logout', { body: {} }); } catch (e) { /* bỏ qua */ } hienDangNhap(false); }

function doiMatKhau() {
  modal({
    title: 'Đổi mật khẩu',
    body: '<div class="form"><label>Mật khẩu hiện tại<input type="password" id="pwOld" autocomplete="current-password"></label>' +
      '<label>Mật khẩu mới (≥ 6 ký tự)<input type="password" id="pwNew" autocomplete="new-password"></label>' +
      '<label>Nhập lại mật khẩu mới<input type="password" id="pwNew2" autocomplete="new-password"></label></div>',
    buttons: [{ t: 'Lưu', cls: 'pri', fn: async () => {
      if ($('pwNew').value !== $('pwNew2').value) throw new Error('Hai lần nhập mật khẩu mới không khớp');
      await api('/api/auth?a=password', { body: { old: $('pwOld').value, password: $('pwNew').value } });
      toast('Đã đổi mật khẩu');
    } }]
  });
}

async function khoiDong() {
  try {
    const r = await api('/api/auth?a=me', { allowFail: true });
    if (r.ok) { U = r.user; vaoApp(); } else hienDangNhap(r.needSetup);
  } catch (e) { hienDangNhap(false, e.message); }
}
function vaoApp() {
  $('auth').style.display = 'none';
  $('who').textContent = U.name + ' · ' + U.roleName;
  document.querySelectorAll('[data-role]').forEach(b => { b.hidden = !can(U, b.dataset.role); });
  taiDuLieu(false);
  taiYC();
  if (typeof bomVaoApp === 'function') bomVaoApp();   // module Sản phẩm / BOM / Tạo lệnh (bom.js)
}

/* ====================== Dữ liệu ====================== */
async function taiDuLieu(fresh) {
  loading(true);
  try {
    const r = await api('/api/data' + (fresh ? '?fresh=1' : ''));
    U = r.user; F = r.fields;
    M = TC.buildModel(r.data);
    dienBoLoc(); ve(); veSL(); demYC();
    const n = new Date(r.at);
    $('capNhat').textContent = 'Dữ liệu lúc ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()) + ' ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1) + '/' + n.getFullYear();
  } catch (e) { loi(e); }
  finally { loading(false); }
}
function dienBoLoc() {
  const sel = $('fTT'), cur = sel.value;
  const tts = [...new Set(M.lsx.map(l => l.Trang_Thai).filter(Boolean))];
  sel.innerHTML = '<option value="">Tất cả trạng thái</option>' + tts.map(t => '<option' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  const selCD = $('slCD'), curCD = selCD.value;
  selCD.innerHTML = '<option value="">Tất cả công đoạn</option>' + TC.sapCD(M, [...new Set(M.sl.map(r => r.cd))])
    .map(c => '<option' + (c === curCD ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  const selL = $('slLSX'), curL = selL.value;
  selL.innerHTML = '<option value="">Tất cả lệnh SX</option>' + [...new Set(M.sl.map(r => r.lsx).filter(Boolean))].sort()
    .map(c => '<option' + (c === curL ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
}
function chonTab(b) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === b.dataset.tab));
  if (b.dataset.tab === 'tabYC') taiYC();
  if (b.dataset.tab === 'tabTK') taiTK();
  if (b.dataset.tab === 'tabNK') taiNK();
  if (b.dataset.tab === 'tabBOM') bomTai();
  if (b.dataset.tab === 'tabLX') lxTai();
}

/* ====================== Tab 1: Lệnh sản xuất ====================== */
function locLSX() {
  const q = norm($('q').value), tt = $('fTT').value, chiTre = $('fTre').checked, anHT = $('fAnHT').checked;
  return M.lsx.filter(l => (!q || l.searchText.includes(q)) && (!tt || l.Trang_Thai === tt) && (!chiTre || l.tre) &&
    (!anHT || (l.pct < 1 && !/HỦY|HUỶ|HOÀN THÀNH/.test(norm(l.Trang_Thai)))));
}
const jsq = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
function nutLSX(l) {
  if (!can(U, 'de_xuat')) return '';
  return '<button class="sm" onclick="event.stopPropagation();deXuatSua(\'' + jsq(l.So_LSX) + '\')">✎ Sửa</button>' +
    '<button class="sm" onclick="event.stopPropagation();deXuatXoa(\'LSX\',\'' + jsq(l.So_LSX) + '\')">🗑 Xoá</button>';
}
function ve() {
  if (!M) return;
  const ds = locLSX();
  const allPsx = ds.flatMap(l => l.psx);
  const pctChung = allPsx.length ? allPsx.reduce((a, p) => a + p.pct, 0) / allPsx.length : 0;
  $('kpis').innerHTML = [
    ['Lệnh sản xuất', ds.length], ['Phiếu sản xuất', allPsx.length], ['Chi tiết', ds.reduce((a, l) => a + l.soCT, 0)],
    ['Phiếu hoàn thành', allPsx.filter(p => p.pct >= 1).length], ['Tiến độ chung', Math.round(pctChung * 100) + '%'],
    ['Lệnh trễ hạn', ds.filter(l => l.tre).length, 'warn']
  ].map(k => '<div class="kpi ' + (k[2] || '') + '"><div class="l">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>').join('');

  const tb = $('tbLSX');
  if (!ds.length) { tb.innerHTML = '<tr><td colspan="11" class="empty">Không có lệnh sản xuất phù hợp.</td></tr>'; return; }
  const q = norm($('q').value);
  const choXoa = new Set(M.choDuyet.map(r => norm(r.Doi_Tuong)));
  tb.innerHTML = ds.map(l => {
    const open = moLSX.has(l.So_LSX) || (q && !l.ownText.includes(q) && l.psx.some(p => p.searchText.includes(q)));
    let h = '<tr class="lsx' + (open ? ' open' : '') + '" onclick="toggleLSX(\'' + jsq(l.So_LSX) + '\')">' +
      '<td><span class="caret">▶</span></td><td><b>' + esc(l.So_LSX) + '</b></td><td class="wrap">' + esc(l.Ten_LSX) + '</td>' +
      '<td>' + esc(l.Ngay_Cap_Lenh) + '</td><td>' + esc(l.nguoi) + '</td><td>' + esc(l.Ngay_Hoan_Thanh) + '</td>' +
      '<td>' + badge(l.Trang_Thai) + (l.tre ? '<span class="badge b-late">Trễ hạn</span>' : '') +
      (choXoa.has(norm(l.So_LSX)) ? '<span class="badge b-hold" style="margin-left:4px">Có YC chờ duyệt</span>' : '') + '</td>' +
      '<td>' + l.psx.length + '</td><td>' + l.soCT + '</td><td>' + bar(l.pct) + '</td><td class="act">' + nutLSX(l) + '</td></tr>';
    if (open) h += '<tr class="sub"><td colspan="11">' + bangPhieu(l) + '</td></tr>';
    return h;
  }).join('');
}
function bangPhieu(l) {
  if (!l.psx.length) return '<div class="muted">Lệnh này chưa có phiếu sản xuất.</div>';
  const q = norm($('q').value);
  const ps = l.psx.filter(p => !q || l.ownText.includes(q) || p.searchText.includes(q));
  const dx = can(U, 'de_xuat');
  return '<div class="scroll"><table><thead><tr><th>Mã phiếu</th><th>Vật liệu</th><th>Người thực hiện</th><th>Ngày nhận</th>' +
    '<th>Trạng thái</th><th>Công đoạn</th><th>Chi tiết</th><th>Tiến độ</th><th></th></tr></thead><tbody>' +
    ps.map(p => '<tr class="psx" onclick="moPhieu(event,\'' + jsq(p.Ma_PSX) + '\')">' +
      '<td><b>' + esc(p.Ma_PSX) + '</b></td><td class="wrap">' + esc(p.Vat_Lieu) + '</td><td>' + esc(p.nguoi) + '</td>' +
      '<td>' + esc(p.Ngay_Nhan_Phieu) + '</td><td>' + badge(p.Trang_Thai) + '</td><td>' + stepChips(p) + '</td>' +
      '<td>' + p.lines.length + '</td><td>' + bar(p.pct) + '</td><td class="act">' +
      (dx ? '<button class="sm" onclick="event.stopPropagation();deXuatSua(\'' + jsq(l.So_LSX) + '\',\'' + jsq(p.Ma_PSX) + '\')">✎</button>' +
        '<button class="sm" title="Đề xuất xoá phiếu" onclick="event.stopPropagation();deXuatXoa(\'PSX\',\'' + jsq(p.Ma_PSX) + '\')">🗑</button>' : '') +
      '</td></tr>').join('') + '</tbody></table></div>';
}
function stepChips(p) {
  return '<div class="steps">' + p.steps.map((s, i) => {
    const c = (s.tong > 0 && s.xong >= s.tong) ? 'done' : (i === p.curIdx ? 'cur' : '');
    return '<span class="step ' + c + '" title="' + s.xong + '/' + s.tong + '">' + esc(s.ten) + '</span>';
  }).join('') + '</div>';
}
function toggleLSX(so) { moLSX.has(so) ? moLSX.delete(so) : moLSX.add(so); ve(); }

/* ====================== Tab 2: Sản lượng theo ngày ====================== */
function khoangNgay(n) {
  const den = new Date(), tu = new Date(); tu.setDate(tu.getDate() - n + 1);
  const k = d => keyNgay(d.getFullYear(), d.getMonth() + 1, d.getDate());
  $('slTu').value = n ? k(tu) : ''; $('slDen').value = n ? k(den) : '';
  veSL();
}
function cheDoSL(b) { hienSL = b.dataset.v; document.querySelectorAll('#slHT button').forEach(x => x.classList.toggle('on', x === b)); veSL(); }
function locSL() {
  const tu = $('slTu').value, den = $('slDen').value, cd = $('slCD').value, lsx = $('slLSX').value;
  return M.sl.filter(r => (!tu || r.ngay >= tu) && (!den || r.ngay <= den) && (!cd || r.cd === cd) && (!lsx || r.lsx === lsx));
}
const giaTri = o => hienSL === 'm3' ? o.m3 : o.q;
function oSL(o, cls, tb, attr) {
  cls = cls || ''; attr = attr || '';
  if (!o || (!o.q && !o.m3)) return '<td class="z ' + cls + '"' + attr + '>–</td>';
  if (tb && tb.n) { const avg = giaTri(tb) / tb.n; if (avg > 0) cls += giaTri(o) >= avg ? ' hi' : ' lo'; }
  const td = '<td class="' + cls + '"' + attr + '>';
  if (hienSL === 'sl') return td + fSL(o.q) + '</td>';
  if (hienSL === 'm3') return td + fM3(o.m3) + '</td>';
  return td + fSL(o.q) + '<small>' + fM3(o.m3) + ' m³</small></td>';
}
function veSL() {
  if (!M) return;
  const ds = locSL();
  const cot = TC.sapCD(M, [...new Set(ds.map(r => r.cd))]);
  const bang = {}, tongNgay = {}, tongCD = {}, tong = { q: 0, m3: 0 };
  const cong = (o, r) => { o.q += r.q; o.m3 += r.m3; };
  ds.forEach(r => {
    const row = bang[r.ngay] = bang[r.ngay] || {};
    cong(row[r.cd] = row[r.cd] || { q: 0, m3: 0 }, r);
    cong(tongNgay[r.ngay] = tongNgay[r.ngay] || { q: 0, m3: 0 }, r);
    cong(tongCD[r.cd] = tongCD[r.cd] || { q: 0, m3: 0 }, r);
    cong(tong, r);
  });
  const ngays = Object.keys(bang).sort().reverse();
  const thieuKT = ds.filter(r => !r.coKT).length;
  $('kpisSL').innerHTML = [
    ['Tổng số chi tiết', fSL(tong.q)], ['Tổng khối lượng', fM3(tong.m3) + ' <small>m³</small>'], ['Số ngày có sản lượng', ngays.length],
    ['Trung bình / ngày', ngays.length ? fM3(tong.m3 / ngays.length) + ' <small>m³</small>' : '–'], ['Lượt ghi nhận', ds.length],
    ['Lượt thiếu kích thước', thieuKT, thieuKT ? 'warn' : '']
  ].map(k => '<div class="kpi ' + (k[2] || '') + '"><div class="l">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>').join('');
  const el = $('pvSL');
  if (!ds.length) { el.innerHTML = '<div class="empty">Không có sản lượng trong khoảng lọc.</div>'; return; }
  const nN = ngays.length, tbCD = {}; cot.forEach(c => { tbCD[c] = Object.assign({}, tongCD[c], { n: nN }); });
  const tbTong = Object.assign({}, tong, { n: nN }), chia = o => ({ q: o.q / nN, m3: o.m3 / nN });
  const at = (n, c) => ' data-n="' + n + '"' + (c ? ' data-cd="' + esc(c) + '"' : '') + ' onclick="moO(this)"';
  el.innerHTML = '<table class="pv"><thead><tr><th>Ngày</th>' + cot.map(c => '<th>' + esc(c) + '</th>').join('') + '<th class="tot">Tổng ngày</th></tr></thead><tbody>' +
    ngays.map(n => '<tr><td' + at(n) + '><b>' + hienNgay(n) + '</b><span class="dow">' + thuCua(n) + '</span></td>' +
      cot.map(c => oSL(bang[n][c], '', tbCD[c], at(n, c))).join('') + oSL(tongNgay[n], 'tot', tbTong, at(n)) + '</tr>').join('') +
    '</tbody><tfoot><tr class="avg"><td>Trung bình / ngày</td>' + cot.map(c => oSL(chia(tongCD[c]))).join('') + oSL(chia(tong), 'tot') + '</tr>' +
    '<tr><td>Tổng cộng</td>' + cot.map(c => oSL(tongCD[c])).join('') + oSL(tong, 'tot') + '</tr></tfoot></table>';
}
function moO(td) { moNgay(td.dataset.n, td.dataset.cd || ''); }
function moNgay(n, cd) {
  const thuTu = TC.sapCD(M, [...new Set(M.sl.map(r => r.cd))]);
  const ds = locSL().filter(r => r.ngay === n && (!cd || r.cd === cd))
    .sort((a, b) => thuTu.indexOf(a.cd) - thuTu.indexOf(b.cd) || gioGhi(a.g.Thoi_Gian).localeCompare(gioGhi(b.g.Thoi_Gian)));
  const theoCD = {}; ds.forEach(r => { const k = cd ? r.cdGoc : r.cd, o = theoCD[k] = theoCD[k] || { q: 0, m3: 0 }; o.q += r.q; o.m3 += r.m3; });
  const q = ds.reduce((a, r) => a + r.q, 0), m3 = ds.reduce((a, r) => a + r.m3, 0);
  $('drTitle').textContent = (cd ? cd + ' – ' : '') + 'Sản lượng ngày ' + hienNgay(n) + ' (' + thuCua(n) + ')';
  $('drSub').textContent = fSL(q) + ' chi tiết · ' + fM3(m3) + ' m³ · ' + ds.length + ' lượt ghi';
  let h = '<div class="meta">' + TC.sapCD(M, Object.keys(theoCD)).map(c => '<div><b>' + esc(c) + '</b>' + fSL(theoCD[c].q) + ' chi tiết · ' + fM3(theoCD[c].m3) + ' m³</div>').join('') + '</div>';
  h += '<div class="card"><div class="scroll"><table><thead><tr><th>Giờ</th><th>Công đoạn</th><th>Lệnh SX</th><th>Mã dòng</th><th>Nhãn</th><th>Vật liệu</th>' +
    '<th class="r">D × R × Dày (mm)</th><th class="r">Số lượng</th><th class="r">m³</th><th>Người cập nhật</th><th>Ghi chú</th></tr></thead><tbody>' +
    ds.map(r => '<tr><td>' + gioGhi(r.g.Thoi_Gian) + '</td><td>' + esc(r.cdGoc) + '</td><td>' + esc(r.lsx) + '</td><td>' + esc(r.g.Ma_Dong) + '</td>' +
      '<td class="wrap">' + esc(r.dong ? r.dong.Nhan : '') + '</td><td>' + esc(r.p ? r.p.Vat_Lieu : '') + '</td>' +
      '<td class="r">' + (r.coKT ? r.dai + ' × ' + r.rong + ' × ' + r.day : '<span class="badge b-late">Thiếu KT</span>') + '</td>' +
      '<td class="r"><b>' + fSL(r.q) + '</b></td><td class="r">' + fM3(r.m3) + '</td>' +
      '<td>' + esc(M.tenNguoi[norm(r.g.Nguoi_Cap_Nhat)] || r.g.Nguoi_Cap_Nhat) + '</td><td class="wrap">' + esc(r.g.Ghi_Chu) + '</td></tr>').join('') +
    '</tbody></table></div></div>';
  moDrawer(h);
}

/* ====================== Chi tiết phiếu ====================== */
function moDrawer(h) { $('drBody').innerHTML = h; $('ov').classList.add('show'); $('dr').classList.add('show'); }
function dongPhieu() { $('ov').classList.remove('show'); $('dr').classList.remove('show'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('.modal-bg')) dongPhieu(); });

function moPhieu(ev, ma) {
  ev.stopPropagation();
  const p = M.psx.find(x => x.Ma_PSX === ma); if (!p) return;
  $('drTitle').innerHTML = 'Phiếu ' + esc(p.Ma_PSX) + ' ' + badge(p.Trang_Thai);
  $('drSub').textContent = 'Thuộc lệnh ' + p.Lenh_SX;
  let h = (can(U, 'de_xuat') ? '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button onclick="dongPhieu();deXuatSua(\'' + jsq(p.Lenh_SX) + '\',\'' + jsq(p.Ma_PSX) + '\')">✎ Đề xuất sửa phiếu</button>' +
    '<button onclick="dongPhieu();deXuatXoa(\'PSX\',\'' + jsq(p.Ma_PSX) + '\')">🗑 Đề xuất xoá phiếu</button></div>' : '') +
    '<div class="meta"><div><b>Vật liệu</b>' + esc(p.Vat_Lieu) + '</div><div><b>Người thực hiện</b>' + esc(p.nguoi) + '</div>' +
    '<div><b>Ngày nhận phiếu</b>' + esc(p.Ngay_Nhan_Phieu) + '</div><div><b>Số chi tiết</b>' + p.lines.length + '</div>' +
    '<div><b>Tiến độ</b>' + bar(p.pct) + '</div></div>' +
    '<div><b class="muted" style="font-size:12px">QUY TRÌNH CÔNG ĐOẠN</b><div style="margin-top:6px">' + stepChips(p) + '</div></div>';
  h += '<h3>Chi tiết sản phẩm và sản lượng theo công đoạn (đã làm / tổng)</h3><div class="card"><div class="scroll"><table><thead><tr>' +
    '<th>Mã dòng</th><th>Nhãn</th><th>Dài</th><th>Rộng</th><th>SL/bộ</th><th>Tổng SL</th>' +
    p.steps.map(s => '<th>' + esc(s.ten) + '</th>').join('') + '</tr></thead><tbody>' +
    (p.lines.length ? p.lines.map(l => {
      const d = M.done[norm(l.Ma_Dong)] || {}, t = num(l.Tong_So_Luong);
      return '<tr><td>' + esc(l.Ma_Dong) + '</td><td class="wrap">' + esc(l.Nhan) + '</td><td>' + esc(l.Dai) + '</td><td>' + esc(l.Rong) + '</td>' +
        '<td>' + esc(l.So_Luong_1_Bo) + '</td><td><b>' + esc(l.Tong_So_Luong) + '</b></td>' +
        p.steps.map(s => { const x = d[s.ten] || 0; const c = x >= t && t > 0 ? 'cell-ok' : (x > 0 ? 'cell-part' : 'cell-zero'); return '<td class="' + c + '">' + x + ' / ' + t + '</td>'; }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + (6 + p.steps.length) + '" class="empty">Phiếu chưa có chi tiết.</td></tr>') +
    '</tbody></table></div></div>';
  const logs = p.lines.flatMap(l => M.logTheoDong[norm(l.Ma_Dong)] || []);
  h += '<h3>Lịch sử ghi sản lượng (' + logs.length + ')</h3>';
  h += logs.length ? '<div class="card"><div class="scroll"><table><thead><tr><th>Thời gian</th><th>Mã dòng</th><th>Công đoạn</th><th>Số lượng</th><th>Người cập nhật</th><th>Ghi chú</th></tr></thead><tbody>' +
    logs.slice().reverse().map(g => '<tr><td>' + esc(g.Thoi_Gian) + '</td><td>' + esc(g.Ma_Dong) + '</td><td>' + esc(g.Cong_Doan) + '</td><td><b>' + esc(g.So_Luong) + '</b></td>' +
      '<td>' + esc(M.tenNguoi[norm(g.Nguoi_Cap_Nhat)] || g.Nguoi_Cap_Nhat) + '</td><td class="wrap">' + esc(g.Ghi_Chu) + '</td></tr>').join('') +
    '</tbody></table></div></div>' : '<div class="muted">Chưa có ghi nhận sản lượng nào cho phiếu này.</div>';
  moDrawer(h);
}

/* ====================== Đề xuất SỬA ====================== */
/** Ô nhập cho 1 trường; giữ giá trị gốc ở data-o để chỉ gửi phần thay đổi. */
function oNhap(s, k, f, v, cls) {
  const [type, label] = F[s].fields[f];
  const list = f === 'Trang_Thai' ? ' list="dlTT"' : /^CD\d+$/.test(f) ? ' list="dlCD"' : '';
  const ph = type === 'date' ? ' placeholder="dd/mm/yyyy"' : '';
  return '<input class="' + (cls || '') + '" data-s="' + s + '" data-k="' + esc(k) + '" data-f="' + f + '" data-o="' + esc(v) + '" value="' + esc(v) + '"' + list + ph +
    ' title="' + esc(label) + '" oninput="this.classList.toggle(\'chg\',this.value.trim()!==this.dataset.o.trim());demThayDoi(this)">';
}
function demThayDoi(el) {
  const m = el.closest('.modal'); if (!m) return;
  const n = [...m.querySelectorAll('input[data-f]')].filter(i => i.value.trim() !== i.dataset.o.trim()).length;
  m.querySelector('#soThayDoi').textContent = n;
}
function noiDungPhieu(p) {
  const pf = F.PSX.fields;
  return '<div class="form">' + Object.keys(pf).filter(f => !/^CD\d+$/.test(f)).map(f => '<label>' + esc(pf[f][1]) + oNhap('PSX', p.Ma_PSX, f, p[f]) + '</label>').join('') + '</div>' +
    '<div style="margin-top:10px"><b class="muted" style="font-size:12px">QUY TRÌNH CÔNG ĐOẠN (CD1 → CD11)</b></div>' +
    '<div class="form" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-top:6px">' +
    Array.from({ length: 11 }, (_, i) => '<label>CD' + (i + 1) + oNhap('PSX', p.Ma_PSX, 'CD' + (i + 1), p['CD' + (i + 1)]) + '</label>').join('') + '</div>' +
    '<h3>Chi tiết (' + p.lines.length + ')</h3>' + (p.lines.length ? '<div class="scroll"><table><thead><tr><th>Mã dòng</th>' +
      Object.keys(F.CT.fields).map(f => '<th>' + esc(F.CT.fields[f][1]) + '</th>').join('') + '</tr></thead><tbody>' +
      p.lines.map(l => '<tr><td>' + esc(l.Ma_Dong) + '</td>' + Object.keys(F.CT.fields).map(f => '<td>' + oNhap('CT', l.Ma_Dong, f, l[f], f === 'Nhan' ? 'w-l' : '') + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' : '<div class="muted">Không có chi tiết.</div>');
}
function deXuatSua(so, focusPsx) {
  const l = M.lsx.find(x => x.So_LSX === so); if (!l) return;
  const lf = F.LSX.fields;
  const body =
    '<datalist id="dlTT">' + M.tatCaTT.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<datalist id="dlCD">' + M.tatCaCD.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<div class="infobox">Chỉ những ô bạn thay đổi (viền vàng) được gửi đi. Yêu cầu cần <b>một tài khoản duyệt khác</b> xác nhận mới được ghi vào Google Sheet.</div>' +
    '<h3>Thông tin lệnh</h3><div class="form">' + Object.keys(lf).map(f => '<label>' + esc(lf[f][1]) + oNhap('LSX', l.So_LSX, f, l[f]) + '</label>').join('') + '</div>' +
    '<h3>Phiếu sản xuất (' + l.psx.length + ') – bấm để mở và sửa</h3>' +
    l.psx.map(p => '<details class="pf" data-psx="' + esc(p.Ma_PSX) + '"' + (p.Ma_PSX === focusPsx ? ' open' : '') + '><summary>' + esc(p.Ma_PSX) + ' · ' + esc(p.Vat_Lieu) +
      ' · ' + p.lines.length + ' chi tiết <span style="float:right">' + badge(p.Trang_Thai) + '</span></summary><div class="in"></div></details>').join('') +
    '<h3>Lý do sửa</h3><div class="form"><label class="full"><textarea id="lyDo" rows="2" placeholder="Vd. Khách đổi hạn giao, nhập sai kích thước…"></textarea></label></div>' +
    '<p class="muted">Số ô thay đổi: <b id="soThayDoi">0</b></p>';
  modal({
    title: 'Đề xuất sửa lệnh ' + esc(l.So_LSX), wide: true, body,
    onOpen: m => {
      const fill = d => { const box = d.querySelector('.in'); if (!box.innerHTML) box.innerHTML = noiDungPhieu(M.psxTheoMa[norm(d.dataset.psx)]); };
      m.querySelectorAll('details.pf').forEach(d => { d.addEventListener('toggle', () => fill(d)); if (d.open) { fill(d); setTimeout(() => d.scrollIntoView({ block: 'start' }), 50); } });
    },
    buttons: [{ t: 'Gửi đề xuất sửa', cls: 'pri', fn: async m => {
      const changes = [...m.querySelectorAll('input[data-f]')].filter(i => i.value.trim() !== i.dataset.o.trim())
        .map(i => ({ s: i.dataset.s, k: i.dataset.k, f: i.dataset.f, n: i.value.trim() }));
      if (!changes.length) throw new Error('Bạn chưa thay đổi ô nào');
      const r = await api('/api/requests', { body: { a: 'create', loai: 'SUA', so_lsx: l.So_LSX, changes, ly_do: m.querySelector('#lyDo').value } });
      toast(r.applied ? 'Đã áp dụng thay đổi' : 'Đã gửi yêu cầu ' + r.id + ' – chờ người duyệt xác nhận');
      taiDuLieu(true); taiYC();
    } }]
  });
}

/* ====================== Đề xuất XOÁ ====================== */
function deXuatXoa(kind, key) {
  let ps, ten;
  if (kind === 'LSX') { const l = M.lsx.find(x => x.So_LSX === key); ps = l.psx; ten = 'lệnh ' + key + ' – ' + l.Ten_LSX; }
  else { const p = M.psxTheoMa[norm(key)]; ps = [p]; ten = 'phiếu ' + key + ' (lệnh ' + p.Lenh_SX + ')'; }
  const soCT = ps.reduce((a, p) => a + p.lines.length, 0);
  const logs = ps.flatMap(p => p.lines.flatMap(l => M.logTheoDong[norm(l.Ma_Dong)] || []));
  const tongSL = logs.reduce((a, g) => a + num(g.So_Luong), 0);
  const body =
    '<div class="warnbox"><b>Xoá ' + esc(ten) + '</b><br>Sẽ xoá khỏi Google Sheet: ' + (kind === 'LSX' ? '1 dòng lệnh, ' : '') +
    '<b>' + ps.length + '</b> phiếu sản xuất, <b>' + soCT + '</b> dòng chi tiết.' +
    (logs.length ? '<br>Đã có <b>' + logs.length + '</b> lượt ghi sản lượng (' + fSL(tongSL) + ' chi tiết).' : '') + '</div>' +
    (logs.length ? '<label style="display:block;margin:10px 0"><input type="checkbox" id="xoaSL"> Xoá cả ' + logs.length + ' lượt ghi sản lượng đã ghi</label>' +
      '<div class="infobox">Nếu lệnh đã sản xuất, nên <b>đổi trạng thái thành "Huỷ"</b> (đề xuất sửa) thay vì xoá để giữ số liệu sản lượng.</div>' : '') +
    '<div class="form"><label class="full">Lý do xoá (bắt buộc)<textarea id="lyDo" rows="3" placeholder="Vd. Lệnh tạo trùng, khách huỷ đơn trước khi sản xuất…"></textarea></label></div>' +
    '<p class="muted">Bước 1/2: yêu cầu sẽ được gửi tới người duyệt. Người duyệt (tài khoản khác bạn) phải gõ lại mã <b>' + esc(key) + '</b> để xác nhận xoá. Dữ liệu được sao lưu và có thể khôi phục.</p>';
  modal({
    title: 'Đề xuất xoá ' + (kind === 'LSX' ? 'lệnh' : 'phiếu') + ' ' + esc(key), body,
    buttons: [{ t: 'Gửi đề xuất xoá', cls: 'danger', fn: async m => {
      const x = m.querySelector('#xoaSL');
      const r = await api('/api/requests', { body: { a: 'create', loai: kind === 'LSX' ? 'XOA_LSX' : 'XOA_PSX', key, xoa_san_luong: !!(x && x.checked), ly_do: m.querySelector('#lyDo').value } });
      toast('Đã gửi yêu cầu ' + r.id + ' – chờ người duyệt xác nhận');
      taiDuLieu(true); taiYC();
    } }]
  });
}

/* ====================== Tab 3: Yêu cầu ====================== */
function demYC() {
  const n = M ? M.choDuyet.filter(r => r.Nguoi_De_Xuat !== (U && U.email)).length : 0;
  const el = $('cntYC'); el.hidden = !(n && can(U, 'duyet')); el.textContent = n;
}
async function taiYC() {
  try { const r = await api('/api/requests'); YC = r.list; veYC(); }
  catch (e) { loi(e); }
}
function locYC(b) { locYCv = b.dataset.v; document.querySelectorAll('#ycLoc button').forEach(x => x.classList.toggle('on', x === b)); veYC(); }
const tenNg = e => (M && M.tenNguoi[norm(e)]) || e || '';
function nutYC(r) {
  const h = [];
  const cho = r.trangThai === 'CHO_DUYET';
  if (cho && can(U, 'duyet') && r.nguoiDeXuat !== U.email) h.push('<button class="sm ok" onclick="event.stopPropagation();duyetYC(\'' + r.id + '\')">✔ Duyệt</button>', '<button class="sm" onclick="event.stopPropagation();tuChoiYC(\'' + r.id + '\')">✖ Từ chối</button>');
  if (cho && (r.nguoiDeXuat === U.email || U.role === 'admin')) h.push('<button class="sm" onclick="event.stopPropagation();huyYC(\'' + r.id + '\')">Huỷ YC</button>');
  if (r.trangThai === 'DA_DUYET' && /^XOA_/.test(r.loai) && U.role === 'admin') h.push('<button class="sm" onclick="event.stopPropagation();khoiPhucYC(\'' + r.id + '\')">↺ Khôi phục</button>');
  return h.join('');
}
function veYC() {
  const ds = YC.filter(r => locYCv === 'all' || (locYCv === 'cho' ? r.trangThai === 'CHO_DUYET' : r.nguoiDeXuat === U.email));
  const el = $('dsYC');
  if (!ds.length) { el.innerHTML = '<div class="empty">' + (locYCv === 'cho' ? 'Không có yêu cầu nào đang chờ duyệt.' : 'Chưa có yêu cầu.') + '</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Mã YC</th><th>Loại</th><th>Đối tượng</th><th>Nội dung</th><th>Lý do</th><th>Người đề xuất</th><th>Thời gian</th><th>Trạng thái</th><th>Người duyệt</th><th>Ghi chú duyệt</th><th></th></tr></thead><tbody>' +
    ds.map(r => '<tr class="clk" onclick="xemYC(\'' + r.id + '\')"><td>' + esc(r.id) + '</td><td><b>' + esc(r.loaiTen) + '</b></td><td>' + esc(r.doiTuong) + '</td>' +
      '<td class="wrap">' + esc(r.tomTat) + '</td><td class="wrap">' + esc(r.lyDo) + '</td><td>' + esc(tenNg(r.nguoiDeXuat)) + '</td><td>' + esc(r.tgDeXuat) + '</td>' +
      '<td>' + badgeYC(r.trangThai) + '</td><td>' + esc(tenNg(r.nguoiDuyet)) + (r.tgDuyet ? '<br><small class="muted">' + esc(r.tgDuyet) + '</small>' : '') + '</td>' +
      '<td class="wrap">' + esc(r.ghiChuDuyet) + '</td><td class="act">' + nutYC(r) + '</td></tr>').join('') + '</tbody></table>';
}
/** Bảng chi tiết thay đổi: giá trị lúc đề xuất → giá trị mới, kèm giá trị hiện tại trên sheet. */
function bangThayDoi(r) {
  if (r.loai !== 'SUA') {
    const c = r.noiDung.count || {};
    return '<div class="warnbox">' + esc(r.tomTat) + '<br>Lúc đề xuất: ' + (c.lsx ? c.lsx + ' lệnh, ' : '') + (c.psx || 0) + ' phiếu, ' + (c.ct || 0) + ' dòng chi tiết, ' +
      (c.gsl || 0) + ' lượt ghi sản lượng' + (r.noiDung.xoaSanLuong ? ' (<b>xoá cả sản lượng</b>)' : '') + '.</div>';
  }
  const hienTai = c => {
    const src = c.s === 'LSX' ? M.lsx.find(x => norm(x.So_LSX) === norm(c.k)) : c.s === 'PSX' ? M.psxTheoMa[norm(c.k)] : M.D.ct.find(x => norm(x.Ma_Dong) === norm(c.k));
    return src ? src[c.f] : '(không còn)';
  };
  return '<div class="scroll"><table class="diff"><thead><tr><th>Đối tượng</th><th>Trường</th><th>Thay đổi</th><th>Hiện tại trên sheet</th></tr></thead><tbody>' +
    (r.noiDung.changes || []).map(c => {
      const now = hienTai(c), lech = r.trangThai === 'CHO_DUYET' && String(now).trim() !== String(c.o).trim();
      return '<tr><td>' + esc(F[c.s].ten) + ' ' + esc(c.k) + '</td><td>' + esc(F[c.s].fields[c.f][1]) + '</td><td><del>' + esc(c.o || '(trống)') + '</del> → <ins>' + esc(c.n || '(trống)') + '</ins></td>' +
        '<td>' + esc(now) + (lech ? ' <span class="badge b-late">Đã thay đổi</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function xemYC(id) {
  const r = YC.find(x => x.id === id); if (!r) return;
  $('drTitle').innerHTML = esc(r.loaiTen) + ' ' + esc(r.doiTuong) + ' ' + badgeYC(r.trangThai);
  $('drSub').textContent = r.id + ' · đề xuất bởi ' + tenNg(r.nguoiDeXuat) + ' lúc ' + r.tgDeXuat;
  moDrawer('<div class="meta"><div><b>Lý do</b>' + esc(r.lyDo || '—') + '</div><div><b>Người duyệt</b>' + esc(tenNg(r.nguoiDuyet) || '—') + '</div>' +
    '<div><b>Thời gian duyệt</b>' + esc(r.tgDuyet || '—') + '</div><div><b>Ghi chú duyệt</b>' + esc(r.ghiChuDuyet || '—') + '</div></div>' +
    bangThayDoi(r) + '<div style="margin-top:14px;display:flex;gap:8px">' + nutYC(r).replace(/event\.stopPropagation\(\);/g, 'dongPhieu();') + '</div>');
}
function duyetYC(id) {
  const r = YC.find(x => x.id === id);
  const xoa = r.loai !== 'SUA';
  modal({
    title: 'Bước 2/2 – Xác nhận ' + esc(r.loaiTen.toLowerCase()) + ' ' + esc(r.doiTuong), wide: !xoa,
    body: '<p>Đề xuất bởi <b>' + esc(tenNg(r.nguoiDeXuat)) + '</b> lúc ' + esc(r.tgDeXuat) + '. Lý do: <i>' + esc(r.lyDo || '—') + '</i></p>' + bangThayDoi(r) +
      (xoa ? '<div class="form"><label class="full">Gõ lại chính xác mã <b style="color:var(--red)">' + esc(r.doiTuong) + '</b> để xác nhận xoá<input id="xn" autocomplete="off"></label></div>' : '') +
      '<div class="form" style="margin-top:10px"><label class="full">Ghi chú (không bắt buộc)<input id="gc"></label></div>',
    buttons: [{ t: xoa ? 'Xác nhận XOÁ' : 'Xác nhận áp dụng', cls: xoa ? 'danger' : 'ok', fn: async m => {
      const x = m.querySelector('#xn');
      await api('/api/requests', { body: { a: 'approve', id, confirm: x ? x.value : '', note: m.querySelector('#gc').value } });
      toast(xoa ? 'Đã xoá ' + r.doiTuong + ' (đã sao lưu vào _Thung_Rac)' : 'Đã áp dụng thay đổi cho ' + r.doiTuong);
      taiDuLieu(true); taiYC();
    } }]
  });
}
function tuChoiYC(id) {
  modal({
    title: 'Từ chối yêu cầu ' + esc(id),
    body: '<div class="form"><label class="full">Lý do từ chối (bắt buộc)<textarea id="gc" rows="3"></textarea></label></div>',
    buttons: [{ t: 'Từ chối', cls: 'danger', fn: async m => {
      await api('/api/requests', { body: { a: 'reject', id, note: m.querySelector('#gc').value } });
      toast('Đã từ chối'); taiYC(); taiDuLieu(true);
    } }]
  });
}
function huyYC(id) {
  modal({
    title: 'Huỷ yêu cầu ' + esc(id), body: '<p>Huỷ yêu cầu này? Không có thay đổi nào được ghi vào sheet.</p>',
    buttons: [{ t: 'Huỷ yêu cầu', cls: 'danger', fn: async () => { await api('/api/requests', { body: { a: 'cancel', id } }); toast('Đã huỷ yêu cầu'); taiYC(); taiDuLieu(true); } }]
  });
}
function khoiPhucYC(id) {
  const r = YC.find(x => x.id === id);
  modal({
    title: 'Khôi phục ' + esc(r.doiTuong),
    body: '<p>Thêm lại toàn bộ dữ liệu đã xoá bởi yêu cầu <b>' + esc(id) + '</b> (lấy từ sheet <code>_Thung_Rac</code>) vào cuối các sheet gốc.</p>',
    buttons: [{ t: 'Khôi phục', cls: 'pri', fn: async () => { await api('/api/requests', { body: { a: 'restore', id } }); toast('Đã khôi phục ' + r.doiTuong); taiYC(); taiDuLieu(true); } }]
  });
}

/* ====================== Tab 4: Tài khoản ====================== */
let TK = null;
async function taiTK() {
  try { TK = await api('/api/accounts'); veTK(); } catch (e) { loi(e); }
}
function veTK() {
  $('dsTK').innerHTML = '<table><thead><tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Nền tảng</th><th>Quyền BOM / lệnh SX</th><th>Trạng thái</th><th>Ngày tạo</th><th></th></tr></thead><tbody>' +
    TK.list.map((a, i) => '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.name) + '</td><td>' + esc(a.roleName) + '</td><td>' + esc(TK.platforms[a.platform] || a.platform) + '</td>' +
      '<td class="wrap"><small>' + (a.role === 'admin' ? 'Tất cả (quản trị)' : esc((a.perms || []).map(p => TK.perms[p] || p).join(', ') || '—')) + '</small></td>' +
      '<td>' + (a.active ? '<span class="badge b-done">Hoạt động</span>' : '<span class="badge b-late">Đã khoá</span>') + '</td><td>' + esc(a.created) + '</td>' +
      '<td class="act"><button class="sm" onclick="suaTK(' + i + ')">Sửa</button></td></tr>').join('') + '</tbody></table>';
}
function suaTK(i) {
  const a = i == null ? null : TK.list[i];
  const opt = (obj, cur) => Object.keys(obj).map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(obj[k].ten || obj[k]) + '</option>').join('');
  modal({
    title: a ? 'Sửa tài khoản ' + esc(a.email) : 'Thêm tài khoản',
    body: '<datalist id="dlND">' + TK.nguoiDung.map(n => '<option value="' + esc(n.email) + '">' + esc(n.name) + '</option>').join('') + '</datalist>' +
      '<div class="form"><label>Email<input id="tkE" type="email" list="dlND" value="' + esc(a ? a.email : '') + '"' + (a ? ' readonly' : '') + '></label>' +
      '<label>Họ tên<input id="tkN" value="' + esc(a ? a.name : '') + '"></label>' +
      '<label>Vai trò<select id="tkR">' + opt(TK.roles, a ? a.role : 'xem') + '</select></label>' +
      '<label>Nền tảng<select id="tkP">' + opt(TK.platforms, a ? a.platform : 'mobile') + '</select></label>' +
      '<label>' + (a ? 'Đặt lại mật khẩu (để trống nếu không đổi)' : 'Mật khẩu (≥ 6 ký tự)') + '<input id="tkW" type="text" autocomplete="off"></label>' +
      '<label style="flex-direction:row;align-items:center;gap:6px;margin-top:20px"><input type="checkbox" id="tkA"' + (!a || a.active ? ' checked' : '') + '> Đang hoạt động</label>' +
      '<label class="full">Quyền Sản phẩm / BOM / Tạo lệnh SX (chỉ dùng trên máy tính; quản trị có tất cả)<span class="perms">' +
      Object.keys(TK.perms || {}).map(p => '<span><input type="checkbox" data-perm-cb="' + p + '"' + (a && (a.perms || []).includes(p) ? ' checked' : '') + '> ' + esc(TK.perms[p]) + '</span>').join('') +
      '</span></label></div>' +
      '<p class="muted">Người upload/sửa BOM và người tạo lệnh không được tự duyệt – cần ít nhất 2 người có quyền duyệt tương ứng.</p>',
    onOpen: m => {
      const e = m.querySelector('#tkE'), n = m.querySelector('#tkN');
      e.addEventListener('change', () => { const x = TK.nguoiDung.find(z => z.email.toLowerCase() === e.value.trim().toLowerCase()); if (x && !n.value) n.value = x.name; });
    },
    buttons: [{ t: 'Lưu', cls: 'pri', fn: async m => {
      const g = id => m.querySelector(id);
      await api('/api/accounts', { body: { a: 'save', email: g('#tkE').value, name: g('#tkN').value, role: g('#tkR').value, platform: g('#tkP').value, password: g('#tkW').value, active: g('#tkA').checked,
        perms: [...m.querySelectorAll('[data-perm-cb]')].filter(x => x.checked).map(x => x.dataset.permCb) } });
      toast('Đã lưu tài khoản'); taiTK();
    } }]
  });
}

/* ====================== Tab 5: Nhật ký ====================== */
async function taiNK() {
  try {
    const r = await api('/api/accounts?a=log');
    $('dsNK').innerHTML = r.list.length ? '<table><thead><tr><th>Thời gian</th><th>Người</th><th>Nền tảng</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>' +
      r.list.map(x => '<tr><td>' + esc(x.Thoi_Gian) + '</td><td>' + esc(tenNg(x.Nguoi)) + '</td><td>' + esc(x.Nen_Tang === 'm' ? 'Điện thoại' : x.Nen_Tang === 'pc' ? 'Máy tính' : x.Nen_Tang) + '</td>' +
        '<td>' + esc(x.Hanh_Dong) + '</td><td>' + esc(x.Doi_Tuong) + '</td><td class="wrap"><small>' + esc(x.Chi_Tiet) + '</small></td></tr>').join('') + '</tbody></table>'
      : '<div class="empty">Chưa có nhật ký.</div>';
  } catch (e) { loi(e); }
}

khoiDong();
