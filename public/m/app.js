/* Ứng dụng điện thoại Trí Cao (PWA) */
'use strict';
const { api, esc, num, norm, fSL, fM3, pad, keyNgay, hienNgay, thuCua, gioGhi, badge, bar, can, badgeYC } = TC;
const $ = id => document.getElementById(id);
let U = null, M = null, F = null, YC = [], dataAt = 0;
const st = { q: '', loc: 'chay', ycLoc: 'cho', slNgay: '' };
let installEvt = null;

/* ---------- Khung ---------- */
function toast(m, ms) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), ms || 3200); }
function loading(on) { $('loading').style.display = on ? 'block' : 'none'; }
function loi(e) { if (e && e.status === 401) return hienDangNhap(false); toast('Lỗi: ' + (e && e.message || e), 6000); }
const jsq = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const tenNg = e => (M && M.tenNguoi[norm(e)]) || e || '';

/** Bảng trượt (bottom sheet). buttons: [{t, cls, fn(el) → Promise; false = giữ mở}] */
function sheet(o) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = '<div class="sheet"><div class="sh"><h2>' + o.title + '</h2><button data-x>✕</button></div><div class="sb">' + o.body + '<div class="err"></div></div><div class="sf"></div></div>';
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  bg.querySelector('[data-x]').onclick = close;
  const sf = bg.querySelector('.sf'), err = bg.querySelector('.err');
  (o.buttons || []).forEach(b => {
    const btn = document.createElement('button'); btn.textContent = b.t; if (b.cls) btn.className = b.cls;
    btn.onclick = async () => {
      err.textContent = ''; sf.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { const r = await b.fn(bg.querySelector('.sheet')); if (r !== false) close(); }
      catch (e) { if (e.status === 401) { close(); hienDangNhap(false); } else { err.textContent = e.message; err.scrollIntoView({ block: 'nearest' }); } }
      finally { sf.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
    };
    sf.appendChild(btn);
  });
  if (!o.buttons || !o.buttons.length) sf.remove();
  document.body.appendChild(bg);
  if (o.onOpen) o.onOpen(bg.querySelector('.sheet'));
  return bg;
}

/* ---------- Đăng nhập ---------- */
function hienDangNhap(needSetup, msg) {
  U = null;
  $('authBox').innerHTML = needSetup
    ? '<h2>Chưa khởi tạo</h2><p class="t2">Hệ thống chưa có quản trị viên. Hãy khởi tạo trên máy tính trước.</p>'
    : '<h2>Trí Cao</h2><p class="t2">Đăng nhập ứng dụng điện thoại</p><form onsubmit="event.preventDefault();dangNhap(this)">' +
      '<label class="fld"><span>Email</span><input name="email" type="email" required autocomplete="username" autocapitalize="none"></label>' +
      '<label class="fld"><span>Mật khẩu</span><input name="password" type="password" required autocomplete="current-password"></label>' +
      '<button class="pri block">Đăng nhập</button><div class="err">' + esc(msg || '') + '</div></form>';
  $('auth').style.display = 'flex';
}
async function dangNhap(f) {
  const err = f.querySelector('.err'), b = f.querySelector('button'); err.textContent = ''; b.disabled = true;
  try { const r = await api('/api/auth?a=login', { body: Object.fromEntries(new FormData(f)) }); U = r.user; vaoApp(); }
  catch (e) { err.textContent = e.message; } finally { b.disabled = false; }
}
async function dangXuat() { try { await api('/api/auth?a=logout', { body: {} }); } catch (e) { /* bỏ qua */ } location.hash = ''; hienDangNhap(false); }
async function khoiDong() {
  try { const r = await api('/api/auth?a=me', { allowFail: true }); if (r.ok) { U = r.user; vaoApp(); } else hienDangNhap(r.needSetup); }
  catch (e) { hienDangNhap(false, e.message); }
}
function vaoApp() { $('auth').style.display = 'none'; taiDuLieu(false); taiYC(); }

/* ---------- Dữ liệu ---------- */
async function taiDuLieu(fresh) {
  loading(true);
  try {
    const r = await api('/api/data' + (fresh ? '?fresh=1' : ''));
    U = r.user; F = r.fields; M = TC.buildModel(r.data); dataAt = r.at;
    demYC(); render();
  } catch (e) { loi(e); } finally { loading(false); }
}
async function taiYC() { try { YC = (await api('/api/requests')).list; demYC(); if (route()[0] === 'yc') render(); } catch (e) { loi(e); } }
function demYC() {
  const n = YC.filter(r => r.trangThai === 'CHO_DUYET' && r.nguoiDeXuat !== (U && U.email)).length;
  const el = $('cntYC'); el.hidden = !(n && can(U, 'duyet')); el.textContent = n;
}
// Tự làm mới khi mở lại ứng dụng sau hơn 1 phút
document.addEventListener('visibilitychange', () => { if (!document.hidden && U && Date.now() - dataAt > 60_000) { taiDuLieu(false); taiYC(); } });

/* ---------- Điều hướng theo hash: #lsx, #lsx/<so>, #psx/<ma>, #sl, #yc, #yc/<id>, #toi ---------- */
const route = () => (location.hash.slice(1) || 'lsx').split('/').map(decodeURIComponent);
function diTab(v) { location.hash = v; }
window.addEventListener('hashchange', render);
function render() {
  if (!U) return;
  const [v, id] = route();
  const tab = v === 'psx' ? 'lsx' : v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
  $('back').hidden = !id;
  const view = $('view');
  if (!M) { view.innerHTML = '<div class="empty">Đang tải…</div>'; return; }
  const fn = { lsx: id ? vLSX : vDanhSach, psx: vPhieu, sl: vSanLuong, yc: id ? vYC : vDsYC, toi: vToi }[v] || vDanhSach;
  fn(view, id);
  if (!id) window.scrollTo(0, 0);
}
function setTitle(t) { $('title').textContent = t; }

/* ---------- Danh sách lệnh ---------- */
function vDanhSach(view) {
  setTitle('Lệnh sản xuất');
  const q = norm(st.q);
  const ds = M.lsx.filter(l => (!q || l.searchText.includes(q)) &&
    (st.loc === 'all' || (st.loc === 'tre' ? l.tre : l.pct < 1 && !/HỦY|HUỶ|HOÀN THÀNH/.test(norm(l.Trang_Thai))))).slice().reverse();
  const allP = ds.flatMap(l => l.psx);
  view.innerHTML =
    '<input id="q" type="search" placeholder="Tìm lệnh, phiếu, vật liệu, nhãn…" value="' + esc(st.q) + '">' +
    '<div class="chips">' + [['chay', 'Đang thực hiện'], ['tre', 'Trễ hạn'], ['all', 'Tất cả']].map(c =>
      '<button class="' + (st.loc === c[0] ? 'on' : '') + '" onclick="st.loc=\'' + c[0] + '\';render()">' + c[1] + '</button>').join('') + '</div>' +
    '<div class="kpis"><div class="kpi"><div class="l">Lệnh</div><div class="v">' + ds.length + '</div></div>' +
    '<div class="kpi"><div class="l">Phiếu hoàn thành</div><div class="v">' + allP.filter(p => p.pct >= 1).length + '/' + allP.length + '</div></div></div>' +
    (ds.length ? ds.map(l => '<div class="card tap" onclick="location.hash=\'lsx/' + encodeURIComponent(l.So_LSX) + '\'">' +
      '<div class="row"><div class="grow"><div class="t1">' + esc(l.So_LSX) + '</div><div class="t2 ell">' + esc(l.Ten_LSX) + '</div></div><div>' + badge(l.Trang_Thai) + '</div></div>' +
      '<div class="t2" style="margin-top:4px">Hạn ' + esc(l.Ngay_Hoan_Thanh || '—') + ' · ' + l.psx.length + ' phiếu · ' + l.soCT + ' chi tiết' +
      (l.tre ? ' <span class="badge b-late">Trễ hạn</span>' : '') + '</div>' + bar(l.pct) + '</div>').join('')
      : '<div class="empty">Không có lệnh phù hợp.</div>');
  const inp = $('q');
  inp.addEventListener('input', () => { st.q = inp.value; clearTimeout(inp._t); inp._t = setTimeout(() => { render(); const n = $('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); });
}

/* ---------- Chi tiết lệnh ---------- */
function stepChips(p) {
  return '<div class="steps">' + p.steps.map((s, i) => '<span class="step ' + ((s.tong > 0 && s.xong >= s.tong) ? 'done' : (i === p.curIdx ? 'cur' : '')) + '">' + esc(s.ten) + '</span>').join('') + '</div>';
}
function vLSX(view, so) {
  const l = M.lsx.find(x => x.So_LSX === so);
  if (!l) { view.innerHTML = '<div class="empty">Không tìm thấy lệnh ' + esc(so) + ' (có thể đã bị xoá).</div>'; return; }
  setTitle(l.So_LSX);
  const cho = YC.filter(r => r.trangThai === 'CHO_DUYET' && norm(r.soLSX) === norm(so));
  view.innerHTML = '<div class="card"><div class="t1">' + esc(l.Ten_LSX) + '</div>' +
    '<div class="meta"><div><b>Trạng thái</b>' + badge(l.Trang_Thai) + (l.tre ? ' <span class="badge b-late">Trễ</span>' : '') + '</div><div><b>Hạn hoàn thành</b>' + esc(l.Ngay_Hoan_Thanh || '—') + '</div>' +
    '<div><b>Ngày cấp</b>' + esc(l.Ngay_Cap_Lenh) + '</div><div><b>Người cấp</b>' + esc(l.nguoi) + '</div></div>' + bar(l.pct) + '</div>' +
    (cho.length ? '<div class="infobox">Có ' + cho.length + ' yêu cầu đang chờ duyệt cho lệnh này. <a href="#yc">Xem</a></div>' : '') +
    (can(U, 'de_xuat') ? '<div class="acts"><button onclick="suaLSX(\'' + jsq(so) + '\')">✎ Đề xuất sửa</button><button onclick="xoa(\'LSX\',\'' + jsq(so) + '\')">🗑 Đề xuất xoá</button></div>' : '') +
    '<h3>Phiếu sản xuất (' + l.psx.length + ')</h3>' +
    (l.psx.length ? l.psx.map(p => '<div class="card tap" onclick="location.hash=\'psx/' + encodeURIComponent(p.Ma_PSX) + '\'">' +
      '<div class="row"><div class="grow"><div class="t1">' + esc(p.Ma_PSX) + '</div><div class="t2 ell">' + esc(p.Vat_Lieu) + ' · ' + p.lines.length + ' chi tiết</div></div>' + badge(p.Trang_Thai) + '</div>' +
      stepChips(p) + bar(p.pct) + '</div>').join('') : '<div class="empty">Chưa có phiếu.</div>');
}

/* ---------- Chi tiết phiếu ---------- */
function vPhieu(view, ma) {
  const p = M.psxTheoMa[norm(ma)];
  if (!p) { view.innerHTML = '<div class="empty">Không tìm thấy phiếu ' + esc(ma) + '.</div>'; return; }
  setTitle(p.Ma_PSX);
  view.innerHTML = '<div class="card"><div class="row"><div class="grow t1">' + esc(p.Vat_Lieu) + '</div>' + badge(p.Trang_Thai) + '</div>' +
    '<div class="meta"><div><b>Lệnh</b><a href="#lsx/' + encodeURIComponent(p.Lenh_SX) + '">' + esc(p.Lenh_SX) + '</a></div><div><b>Người thực hiện</b>' + esc(p.nguoi) + '</div>' +
    '<div><b>Ngày nhận</b>' + esc(p.Ngay_Nhan_Phieu) + '</div><div><b>Lượt ghi SL</b>' + p.soSL + '</div></div>' + stepChips(p) + bar(p.pct) + '</div>' +
    (can(U, 'de_xuat') ? '<div class="acts"><button onclick="suaLSX(\'' + jsq(p.Lenh_SX) + '\',\'' + jsq(p.Ma_PSX) + '\')">✎ Đề xuất sửa</button><button onclick="xoa(\'PSX\',\'' + jsq(p.Ma_PSX) + '\')">🗑 Đề xuất xoá</button></div>' : '') +
    '<h3>Chi tiết (' + p.lines.length + ') – đã làm / tổng</h3><div class="card lines">' +
    (p.lines.length ? p.lines.map(l => {
      const d = M.done[norm(l.Ma_Dong)] || {}, t = num(l.Tong_So_Luong);
      return '<div class="ln"><div class="row"><div class="grow"><b>' + esc(l.Nhan) + '</b><div class="t2">' + esc(l.Ma_Dong) + ' · ' + esc(l.Dai) + '×' + esc(l.Rong) + ' · SL ' + esc(l.Tong_So_Luong) + '</div></div></div>' +
        '<div class="grid2">' + p.steps.map(s => { const x = d[s.ten] || 0; return '<div>' + esc(s.ten) + ': <span class="' + (x >= t && t > 0 ? 'cell-ok' : x > 0 ? 'cell-part' : 'cell-zero') + '">' + x + '/' + t + '</span></div>'; }).join('') + '</div></div>';
    }).join('') : '<div class="empty">Không có chi tiết.</div>') + '</div>';
}

/* ---------- Đề xuất sửa ---------- */
function oNhap(s, k, f, v) {
  const [type, label] = F[s].fields[f];
  const list = f === 'Trang_Thai' ? ' list="dlTT"' : /^CD\d+$/.test(f) ? ' list="dlCD"' : '';
  const im = type === 'num' ? ' inputmode="decimal"' : type === 'date' ? ' inputmode="numeric" placeholder="dd/mm/yyyy"' : '';
  return '<label class="fld"><span>' + esc(label) + '</span><input data-s="' + s + '" data-k="' + esc(k) + '" data-f="' + f + '" data-o="' + esc(v) + '" value="' + esc(v) + '"' + list + im +
    ' oninput="this.classList.toggle(\'chg\',this.value.trim()!==this.dataset.o.trim())"></label>';
}
function formPhieu(p) {
  return Object.keys(F.PSX.fields).map(f => oNhap('PSX', p.Ma_PSX, f, p[f])).join('') +
    '<h3>Chi tiết</h3>' + p.lines.map(l => '<details class="pf"><summary>' + esc(l.Ma_Dong) + ' · ' + esc(l.Nhan) + '</summary><div class="in">' +
      Object.keys(F.CT.fields).map(f => oNhap('CT', l.Ma_Dong, f, l[f])).join('') + '</div></details>').join('');
}
function suaLSX(so, maPsx) {
  const l = M.lsx.find(x => x.So_LSX === so); if (!l) return;
  const p = maPsx ? M.psxTheoMa[norm(maPsx)] : null;
  const body = '<datalist id="dlTT">' + M.tatCaTT.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<datalist id="dlCD">' + M.tatCaCD.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<div class="infobox">Chỉ ô đổi màu vàng được gửi. Cần một tài khoản duyệt khác xác nhận.</div>' +
    (p ? formPhieu(p) : Object.keys(F.LSX.fields).map(f => oNhap('LSX', l.So_LSX, f, l[f])).join('')) +
    '<label class="fld"><span>Lý do sửa</span><textarea id="lyDo" rows="2"></textarea></label>';
  sheet({
    title: 'Sửa ' + esc(p ? p.Ma_PSX : l.So_LSX), body,
    buttons: [{ t: 'Gửi đề xuất', cls: 'pri', fn: async s => {
      const changes = [...s.querySelectorAll('input[data-f]')].filter(i => i.value.trim() !== i.dataset.o.trim()).map(i => ({ s: i.dataset.s, k: i.dataset.k, f: i.dataset.f, n: i.value.trim() }));
      if (!changes.length) throw new Error('Bạn chưa thay đổi ô nào');
      const r = await api('/api/requests', { body: { a: 'create', loai: 'SUA', so_lsx: l.So_LSX, changes, ly_do: s.querySelector('#lyDo').value } });
      toast(r.applied ? 'Đã áp dụng' : 'Đã gửi yêu cầu – chờ duyệt'); taiYC(); taiDuLieu(true);
    } }]
  });
}

/* ---------- Đề xuất xoá ---------- */
function xoa(kind, key) {
  const ps = kind === 'LSX' ? M.lsx.find(x => x.So_LSX === key).psx : [M.psxTheoMa[norm(key)]];
  const soCT = ps.reduce((a, p) => a + p.lines.length, 0), soSL = ps.reduce((a, p) => a + p.soSL, 0);
  sheet({
    title: 'Xoá ' + (kind === 'LSX' ? 'lệnh ' : 'phiếu ') + esc(key),
    body: '<div class="warnbox">Sẽ xoá ' + (kind === 'LSX' ? '1 lệnh, ' : '') + ps.length + ' phiếu, ' + soCT + ' dòng chi tiết' + (soSL ? '. Đã có <b>' + soSL + '</b> lượt ghi sản lượng.' : '.') + '</div>' +
      (soSL ? '<label class="fld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="xoaSL" style="width:auto"> Xoá cả ' + soSL + ' lượt ghi sản lượng</label>' +
        '<div class="infobox">Lệnh đã sản xuất nên đổi trạng thái thành "Huỷ" thay vì xoá.</div>' : '') +
      '<label class="fld"><span>Lý do xoá (bắt buộc)</span><textarea id="lyDo" rows="3"></textarea></label>' +
      '<p class="t2">Bước 1/2. Người duyệt khác phải gõ lại mã để xác nhận. Dữ liệu được sao lưu, có thể khôi phục.</p>',
    buttons: [{ t: 'Gửi đề xuất xoá', cls: 'danger', fn: async s => {
      const x = s.querySelector('#xoaSL');
      await api('/api/requests', { body: { a: 'create', loai: kind === 'LSX' ? 'XOA_LSX' : 'XOA_PSX', key, xoa_san_luong: !!(x && x.checked), ly_do: s.querySelector('#lyDo').value } });
      toast('Đã gửi yêu cầu xoá – chờ duyệt'); taiYC(); taiDuLieu(true);
    } }]
  });
}

/* ---------- Sản lượng ---------- */
function vSanLuong(view) {
  setTitle('Sản lượng');
  const homNay = new Date(), kHom = keyNgay(homNay.getFullYear(), homNay.getMonth() + 1, homNay.getDate());
  const ngay = st.slNgay || kHom;
  const ds = M.sl.filter(r => r.ngay === ngay);
  const theoCD = {}; ds.forEach(r => { const o = theoCD[r.cd] = theoCD[r.cd] || { q: 0, m3: 0, n: 0 }; o.q += r.q; o.m3 += r.m3; o.n++; });
  const q = ds.reduce((a, r) => a + r.q, 0), m3 = ds.reduce((a, r) => a + r.m3, 0);
  view.innerHTML = '<input type="date" id="slNgay" value="' + ngay + '" max="' + kHom + '">' +
    '<p class="t2" style="margin:6px 2px">' + thuCua(ngay) + ', ' + hienNgay(ngay) + '</p>' +
    '<div class="kpis"><div class="kpi"><div class="l">Chi tiết</div><div class="v">' + fSL(q) + '</div></div><div class="kpi"><div class="l">Khối lượng</div><div class="v">' + fM3(m3) + '<small style="font-size:13px"> m³</small></div></div></div>' +
    (ds.length ? '<h3>Theo công đoạn</h3>' + TC.sapCD(M, Object.keys(theoCD)).map(c => '<div class="card row"><div class="grow t1">' + esc(c) + '</div><div style="text-align:right"><b>' + fSL(theoCD[c].q) + '</b><div class="t2">' + fM3(theoCD[c].m3) + ' m³ · ' + theoCD[c].n + ' lượt</div></div></div>').join('') +
      '<h3>Lượt ghi (' + ds.length + ')</h3><div class="card lines">' + ds.slice().sort((a, b) => gioGhi(b.g.Thoi_Gian).localeCompare(gioGhi(a.g.Thoi_Gian))).map(r =>
        '<div class="ln row"><div class="grow"><b>' + esc(r.cdGoc) + '</b> · ' + esc(r.dong ? r.dong.Nhan : r.g.Ma_Dong) + '<div class="t2">' + gioGhi(r.g.Thoi_Gian) + ' · ' + esc(r.lsx) + ' · ' + esc(tenNg(r.g.Nguoi_Cap_Nhat)) + '</div></div><b>' + fSL(r.q) + '</b></div>').join('') + '</div>'
      : '<div class="empty">Không có sản lượng trong ngày này.</div>');
  $('slNgay').onchange = e => { st.slNgay = e.target.value; render(); };
}

/* ---------- Yêu cầu / duyệt ---------- */
function vDsYC(view) {
  setTitle('Yêu cầu sửa / xoá');
  const ds = YC.filter(r => st.ycLoc === 'all' || (st.ycLoc === 'cho' ? r.trangThai === 'CHO_DUYET' : r.nguoiDeXuat === U.email));
  view.innerHTML = '<div class="chips">' + [['cho', 'Chờ duyệt'], ['toi', 'Của tôi'], ['all', 'Tất cả']].map(c =>
    '<button class="' + (st.ycLoc === c[0] ? 'on' : '') + '" onclick="st.ycLoc=\'' + c[0] + '\';render()">' + c[1] + '</button>').join('') +
    '<button onclick="taiYC()">⟳</button></div>' +
    (ds.length ? ds.map(r => '<div class="card tap" onclick="location.hash=\'yc/' + encodeURIComponent(r.id) + '\'"><div class="row"><div class="grow"><div class="t1">' + esc(r.loaiTen) + ' ' + esc(r.doiTuong) + '</div>' +
      '<div class="t2">' + esc(tenNg(r.nguoiDeXuat)) + ' · ' + esc(r.tgDeXuat) + '</div></div>' + badgeYC(r.trangThai) + '</div><div class="t2" style="margin-top:6px">' + esc(r.tomTat) + '</div></div>').join('')
      : '<div class="empty">Không có yêu cầu.</div>');
}
function bangThayDoi(r) {
  if (r.loai !== 'SUA') {
    const c = r.noiDung.count || {};
    return '<div class="warnbox">' + esc(r.tomTat) + (r.noiDung.xoaSanLuong ? '<br><b>Xoá cả ' + (c.gsl || 0) + ' lượt ghi sản lượng</b>' : '') + '</div>';
  }
  return '<div class="card diff">' + (r.noiDung.changes || []).map(c => '<div class="ln" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="t2">' + esc(F[c.s].ten) + ' ' + esc(c.k) + ' · ' + esc(F[c.s].fields[c.f][1]) + '</div>' +
    '<del>' + esc(c.o || '(trống)') + '</del> → <ins>' + esc(c.n || '(trống)') + '</ins></div>').join('') + '</div>';
}
function vYC(view, id) {
  const r = YC.find(x => x.id === id);
  if (!r) { view.innerHTML = '<div class="empty">Không tìm thấy yêu cầu.</div>'; return; }
  setTitle(r.loaiTen + ' ' + r.doiTuong);
  const cho = r.trangThai === 'CHO_DUYET';
  const duyet = cho && can(U, 'duyet') && r.nguoiDeXuat !== U.email;
  const huy = cho && (r.nguoiDeXuat === U.email || U.role === 'admin');
  view.innerHTML = '<div class="card"><div class="row"><div class="grow t1">' + esc(r.id) + '</div>' + badgeYC(r.trangThai) + '</div>' +
    '<div class="meta"><div><b>Người đề xuất</b>' + esc(tenNg(r.nguoiDeXuat)) + '</div><div><b>Thời gian</b>' + esc(r.tgDeXuat) + '</div>' +
    '<div><b>Người duyệt</b>' + esc(tenNg(r.nguoiDuyet) || '—') + '</div><div><b>Duyệt lúc</b>' + esc(r.tgDuyet || '—') + '</div></div>' +
    '<div><b class="t2">LÝ DO</b><div>' + esc(r.lyDo || '—') + '</div></div>' + (r.ghiChuDuyet ? '<div style="margin-top:6px"><b class="t2">GHI CHÚ DUYỆT</b><div>' + esc(r.ghiChuDuyet) + '</div></div>' : '') + '</div>' +
    bangThayDoi(r) +
    (cho && r.nguoiDeXuat === U.email && can(U, 'duyet') ? '<div class="infobox">Đây là yêu cầu của bạn – cần một tài khoản duyệt khác xác nhận.</div>' : '') +
    (duyet ? '<div class="acts"><button class="ok" onclick="duyet(\'' + jsq(id) + '\')">✔ Duyệt</button><button onclick="tuChoi(\'' + jsq(id) + '\')">✖ Từ chối</button></div>' : '') +
    (huy ? '<button class="block" onclick="huyYC(\'' + jsq(id) + '\')">Huỷ yêu cầu</button>' : '');
}
function duyet(id) {
  const r = YC.find(x => x.id === id), xoaYC = r.loai !== 'SUA';
  sheet({
    title: 'Bước 2/2 – Xác nhận',
    body: bangThayDoi(r) + (xoaYC ? '<label class="fld"><span>Gõ lại mã <b style="color:var(--red)">' + esc(r.doiTuong) + '</b> để xác nhận xoá</span><input id="xn" autocomplete="off" autocapitalize="characters"></label>' : '') +
      '<label class="fld"><span>Ghi chú (không bắt buộc)</span><input id="gc"></label>',
    buttons: [{ t: xoaYC ? 'Xác nhận XOÁ' : 'Xác nhận áp dụng', cls: xoaYC ? 'danger' : 'ok', fn: async s => {
      const x = s.querySelector('#xn');
      await api('/api/requests', { body: { a: 'approve', id, confirm: x ? x.value : '', note: s.querySelector('#gc').value } });
      toast('Đã duyệt ' + r.doiTuong); await taiYC(); taiDuLieu(true);
    } }]
  });
}
function tuChoi(id) {
  sheet({
    title: 'Từ chối yêu cầu', body: '<label class="fld"><span>Lý do từ chối (bắt buộc)</span><textarea id="gc" rows="3"></textarea></label>',
    buttons: [{ t: 'Từ chối', cls: 'danger', fn: async s => { await api('/api/requests', { body: { a: 'reject', id, note: s.querySelector('#gc').value } }); toast('Đã từ chối'); await taiYC(); taiDuLieu(true); } }]
  });
}
function huyYC(id) {
  sheet({
    title: 'Huỷ yêu cầu?', body: '<p>Không có thay đổi nào được ghi vào sheet.</p>',
    buttons: [{ t: 'Huỷ yêu cầu', cls: 'danger', fn: async () => { await api('/api/requests', { body: { a: 'cancel', id } }); toast('Đã huỷ'); await taiYC(); taiDuLieu(true); } }]
  });
}

/* ---------- Tôi ---------- */
const laIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const daCai = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function vToi(view) {
  setTitle('Tài khoản');
  view.innerHTML = '<div class="card"><div class="t1">' + esc(U.name) + '</div><div class="t2">' + esc(U.email) + '</div><div style="margin-top:6px"><span class="badge b-run">' + esc(U.roleName) + '</span></div></div>' +
    (daCai() ? '' : '<div class="card"><div class="t1">Cài ứng dụng lên màn hình chính</div>' +
      (installEvt ? '<button class="pri block" onclick="caiDat()">📲 Cài ứng dụng</button>'
        : '<div class="t2" style="margin-top:6px">' + (laIOS ? 'Trên iPhone: mở bằng <b>Safari</b> → bấm nút <b>Chia sẻ</b> (⬆️) → <b>Thêm vào MH chính</b>.'
          : 'Trên Android: mở bằng <b>Chrome</b> → menu ⋮ → <b>Cài đặt ứng dụng</b> / <b>Thêm vào màn hình chính</b>.') + '</div>') + '</div>') +
    '<button class="block" onclick="doiMK()">Đổi mật khẩu</button><button class="block" onclick="dangXuat()">Đăng xuất</button>' +
    '<p class="t2" style="text-align:center;margin-top:20px">Trí Cao · ứng dụng điện thoại<br>Dữ liệu lúc ' + (dataAt ? new Date(dataAt).toLocaleString('vi-VN') : '—') + '</p>';
}
async function caiDat() { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (route()[0] === 'toi') render(); });
function doiMK() {
  sheet({
    title: 'Đổi mật khẩu',
    body: '<label class="fld"><span>Mật khẩu hiện tại</span><input type="password" id="o" autocomplete="current-password"></label>' +
      '<label class="fld"><span>Mật khẩu mới (≥ 6 ký tự)</span><input type="password" id="n" autocomplete="new-password"></label>' +
      '<label class="fld"><span>Nhập lại</span><input type="password" id="n2" autocomplete="new-password"></label>',
    buttons: [{ t: 'Lưu', cls: 'pri', fn: async s => {
      const g = x => s.querySelector(x).value;
      if (g('#n') !== g('#n2')) throw new Error('Hai lần nhập không khớp');
      await api('/api/auth?a=password', { body: { old: g('#o'), password: g('#n') } }); toast('Đã đổi mật khẩu');
    } }]
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' }).catch(() => {});
khoiDong();
