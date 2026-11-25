/* Phần dùng chung cho trang máy tính và ứng dụng điện thoại Trí Cao.
   Trang phải đặt window.TC_APP = 'pc' | 'm' trước khi nạp file này. */
(function (G) {
  'use strict';
  const APP = G.TC_APP;

  /* ---------- Gọi API ---------- */
  async function api(path, opt) {
    opt = opt || {};
    const r = await fetch(path, {
      method: opt.method || (opt.body ? 'POST' : 'GET'),
      headers: Object.assign({ 'X-TC-App': APP }, opt.body ? { 'content-type': 'application/json' } : {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      credentials: 'same-origin'
    });
    let j = {};
    try { j = await r.json(); } catch (e) { j = { ok: false, error: 'Máy chủ trả về dữ liệu không hợp lệ (HTTP ' + r.status + ')' }; }
    if (!r.ok || j.ok === false && !opt.allowFail) {
      const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e;
    }
    return j;
  }

  /* ---------- Tiện ích ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const norm = s => String(s == null ? '' : s).trim().toUpperCase();
  const fSL = n => Math.round(n).toLocaleString('vi-VN');
  const fM3 = n => n.toLocaleString('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const pad = n => String(n).padStart(2, '0');
  const keyNgay = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const hienNgay = k => k.slice(8) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4);
  const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const thuCua = k => THU[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8)).getDay()];
  function parseNgay(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], m[2] - 1, +m[1]) : null; }
  const THANG = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  /** Ngày của 1 lượt ghi: "dd/MM/yyyy HH:mm" hoặc chuỗi JS "Thu Oct 22 2026 15:52:44 GMT+0700 (...)" */
  function ngayGhi(s) {
    s = String(s || '');
    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return keyNgay(m[3], m[2], m[1]);
    m = s.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/); if (m && THANG[m[1].toUpperCase()]) return keyNgay(m[3], THANG[m[1].toUpperCase()], m[2]);
    const d = new Date(s); return isNaN(d) ? null : keyNgay(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function gioGhi(s) { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : ''; }
  /** Gộp Cắt ván 2, 3… / Dán biên 2… về công đoạn gốc */
  function gomCD(t) { t = String(t || '').normalize('NFC'); const m = t.match(/^(CẮT VÁN|DÁN BIÊN)\s*[-_]?\s*\d+$/); return m ? m[1] : t; }
  function doDay(vl) { const m = String(vl || '').match(/(\d+(?:[.,]\d+)?)\s*mm\b/i); return m ? num(m[1]) : 0; }
  function badgeClass(tt) {
    const t = norm(tt);
    if (/HOÀN THÀNH|XONG|DONE/.test(t)) return 'b-done';
    if (/ĐANG|SẢN XUẤT|RUN/.test(t)) return 'b-run';
    if (/TẠM|DỪNG|HỦY|HUỶ|CHỜ/.test(t)) return 'b-hold';
    return 'b-new';
  }
  const badge = tt => '<span class="badge ' + badgeClass(tt) + '">' + esc(tt || '—') + '</span>';
  function bar(p) {
    const v = Math.round(p * 100);
    return '<div class="bar"><div class="t"><div class="f' + (v >= 100 ? ' full' : '') + '" style="width:' + v + '%"></div></div><span>' + v + '%</span></div>';
  }
  function bayGio() { const n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()) + ' ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1); }

  /** values[][] → object theo dòng tiêu đề, bỏ dòng trống */
  function toObjects(v) {
    if (!v || v.length < 2) return [];
    const head = v[0].map(x => String(x).trim());
    return v.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => {
      const o = {}; head.forEach((k, i) => { if (k) o[k] = r[i] == null ? '' : r[i]; }); return o;
    });
  }

  /* ---------- Tính tiến độ (giữ nguyên logic báo cáo cũ) ---------- */
  function buildModel(raw) {
    const D = {}; Object.keys(raw).forEach(k => { D[k] = toObjects(raw[k]); });
    const cdTen = {}; D.cd.forEach(c => { cdTen[norm(c.Ma_CD)] = c.Ten_Cong_Doan; });
    const tenNguoi = {}; D.nd.forEach(n => { tenNguoi[norm(n.Ma_NV)] = n.Ho_Ten; });
    const tenCD = x => norm(cdTen[norm(x)] || x);

    const done = {}, logTheoDong = {};
    D.gsl.forEach(g => {
      const k = norm(g.Ma_Dong), cd = tenCD(g.Cong_Doan);
      (done[k] = done[k] || {})[cd] = (done[k][cd] || 0) + num(g.So_Luong);
      (logTheoDong[k] = logTheoDong[k] || []).push(g);
    });
    const ctTheoPSX = {}; D.ct.forEach(c => { (ctTheoPSX[norm(c.Ma_PSX)] = ctTheoPSX[norm(c.Ma_PSX)] || []).push(c); });

    const psxTheoLSX = {};
    const psx = D.psx.map(p => {
      const steps = []; for (let i = 1; i <= 11; i++) { const v = p['CD' + i]; if (v !== '' && v != null && !steps.includes(norm(v))) steps.push(norm(v)); }
      const lines = ctTheoPSX[norm(p.Ma_PSX)] || [];
      let tong = 0, xong = 0;
      const stepState = steps.map(s => {
        let t = 0, x = 0; lines.forEach(l => { const q = num(l.Tong_So_Luong); t += q; x += Math.min((done[norm(l.Ma_Dong)] || {})[s] || 0, q); });
        tong += t; xong += x; return { ten: s, tong: t, xong: x };
      });
      const curIdx = stepState.findIndex(s => s.tong === 0 || s.xong < s.tong);
      const pct = tong ? xong / tong : (/HOÀN THÀNH/.test(norm(p.Trang_Thai)) ? 1 : 0);
      const soSL = lines.reduce((a, l) => a + ((logTheoDong[norm(l.Ma_Dong)] || []).length), 0);
      const o = Object.assign({}, p, {
        steps: stepState, curIdx, lines, pct, soSL,
        nguoi: tenNguoi[norm(p.Nguoi_Thuc_Hien)] || p.Nguoi_Thuc_Hien,
        searchText: norm([p.Ma_PSX, p.Vat_Lieu, p.Nguoi_Thuc_Hien].concat(lines.map(l => l.Nhan)).join(' '))
      });
      (psxTheoLSX[norm(p.Lenh_SX)] = psxTheoLSX[norm(p.Lenh_SX)] || []).push(o);
      return o;
    });

    const homNay = new Date(); homNay.setHours(0, 0, 0, 0);
    const lsx = D.lsx.map(l => {
      const ps = psxTheoLSX[norm(l.So_LSX)] || [];
      const pct = ps.length ? ps.reduce((a, p) => a + p.pct, 0) / ps.length : (/HOÀN THÀNH/.test(norm(l.Trang_Thai)) ? 1 : 0);
      const han = parseNgay(l.Ngay_Hoan_Thanh);
      const huy = /HỦY|HUỶ/.test(norm(l.Trang_Thai));
      const tre = !!han && han < homNay && pct < 1 && !/HOÀN THÀNH/.test(norm(l.Trang_Thai)) && !huy;
      const soCT = ps.reduce((a, p) => a + p.lines.length, 0);
      return Object.assign({}, l, {
        psx: ps, pct, tre, soCT, soSL: ps.reduce((a, p) => a + p.soSL, 0),
        nguoi: tenNguoi[norm(l.Nguoi_Cap_Lenh)] || l.Nguoi_Cap_Lenh,
        ownText: norm([l.So_LSX, l.Ten_LSX, l.Nguoi_Cap_Lenh, l.Trang_Thai].join(' ')),
        searchText: norm([l.So_LSX, l.Ten_LSX, l.Nguoi_Cap_Lenh, l.Trang_Thai].join(' ')) + ' ' + ps.map(p => p.searchText).join(' ')
      });
    });

    const dongTheoMa = {}; D.ct.forEach(c => { dongTheoMa[norm(c.Ma_Dong)] = c; });
    const psxTheoMa = {}; psx.forEach(p => { psxTheoMa[norm(p.Ma_PSX)] = p; });
    const thuTuCD = {}; D.cd.forEach((c, i) => { const k = gomCD(norm(c.Ten_Cong_Doan)); if (!(k in thuTuCD)) thuTuCD[k] = i; });
    const sl = D.gsl.map(g => {
      const dong = dongTheoMa[norm(g.Ma_Dong)] || null, p = dong ? psxTheoMa[norm(dong.Ma_PSX)] : null;
      const q = num(g.So_Luong), dai = dong ? num(dong.Dai) : 0, rong = dong ? num(dong.Rong) : 0, day = p ? doDay(p.Vat_Lieu) : 0;
      const coKT = dai > 0 && rong > 0 && day > 0;
      const cdGoc = tenCD(g.Cong_Doan);
      return { g, ngay: ngayGhi(g.Thoi_Gian), cd: gomCD(cdGoc), cdGoc, q, m3: coKT ? dai * rong * day * q / 1e9 : 0, coKT, dong, p, lsx: p ? p.Lenh_SX : '', dai, rong, day };
    }).filter(r => r.ngay && r.cd);

    const yc = D.yc || [];
    const choDuyet = yc.filter(r => r.Trang_Thai === 'CHO_DUYET');
    const tatCaCD = [...new Set(D.cd.map(c => norm(c.Ten_Cong_Doan)).filter(Boolean))];
    const tatCaTT = [...new Set(['Mới', 'Đang sản xuất', 'Tạm dừng', 'Hoàn thành', 'Huỷ'].concat(D.lsx.map(l => l.Trang_Thai), D.psx.map(p => p.Trang_Thai)).filter(Boolean))];
    return { D, lsx, psx, done, logTheoDong, tenNguoi, sl, thuTuCD, choDuyet, tatCaCD, tatCaTT, psxTheoMa };
  }

  function sapCD(M, ds) {
    const t = M ? M.thuTuCD : {};
    return ds.sort((a, b) => ((a in t) ? t[a] : 999) - ((b in t) ? t[b] : 999) || a.localeCompare(b, 'vi'));
  }

  /* ---------- Quyền ---------- */
  const RANK = { xem: 0, de_xuat: 1, duyet: 2, admin: 3 };
  const can = (u, need) => !!u && (RANK[u.role] || 0) >= RANK[need];

  const TT_YC = {
    CHO_DUYET: ['Chờ duyệt', 'b-hold'], DANG_XU_LY: ['Đang xử lý', 'b-run'], DA_DUYET: ['Đã duyệt', 'b-done'],
    TU_CHOI: ['Từ chối', 'b-late'], DA_HUY: ['Đã huỷ', 'b-new'], DA_KHOI_PHUC: ['Đã khôi phục', 'b-run']
  };
  const badgeYC = s => { const t = TT_YC[s] || [s, 'b-new']; return '<span class="badge ' + t[1] + '">' + esc(t[0]) + '</span>'; };

  G.TC = { APP, api, esc, num, norm, fSL, fM3, pad, keyNgay, hienNgay, thuCua, parseNgay, ngayGhi, gioGhi, gomCD, doDay, badge, badgeClass, bar, bayGio, toObjects, buildModel, sapCD, can, badgeYC, TT_YC };
})(window);
