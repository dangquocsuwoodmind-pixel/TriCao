// Nghiệp vụ Sản phẩm – Phiên bản BOM – Tạo lệnh sản xuất từ BOM.
// Mọi thao tác ghi nhiều dòng/nhiều sheet được gom vào 1 batchUpdate (Google áp dụng nguyên tử).
import crypto from 'node:crypto';
import { batchGet, batchUpdate, updateValues, sheetMap, q } from './google.js';
import { HttpError, nowVN, sleep } from './http.js';
import { S, HELPER, norm, toObjects, ensureSheets } from './store.js';

/* ======================= Trạng thái ======================= */
export const TT_BOM = {
  CHO_DUYET: 'Chờ duyệt', DA_DUYET: 'Đã duyệt (hiện hành)', THAY_THE: 'Đã thay thế', TU_CHOI: 'Bị từ chối', DA_HUY: 'Đã huỷ'
};
export const TT_DE = { CHO_DUYET: 'Chờ duyệt', DANG_XU_LY: 'Đang xử lý', DA_DUYET: 'Đã duyệt', TU_CHOI: 'Từ chối', DA_HUY: 'Đã huỷ' };
const LOCK_MS = 120_000;
export const MAX_CD = 11;              // Phieu_San_Xuat có CD1 … CD11

/* ======================= Công đoạn ======================= */
/** Thứ tự cột công đoạn trong sheet "QUY TRINH SAN XUAT" của file BOM. */
export const BUOC_CHUAN = ['BỊ LIỆU', 'CẮT VÁN', 'CNC', 'DÁN BIÊN', 'ĐỊNH HÌNH', 'KHOAN THỦ CÔNG', '6 MẶT', 'KHOAN NGANG', 'MANG CÁ', 'ÉP VÁN', 'UV', 'KHO THÀNH PHẨM'];
const ALIAS = { 'KHOAN TC': 'KHOAN THỦ CÔNG', 'KHOANG NGANG': 'KHOAN NGANG', 'KHO TP': 'KHO THÀNH PHẨM', 'KHO': 'KHO THÀNH PHẨM' };

/** Bỏ dấu, chỉ giữ chữ/số – dùng để so khớp tên. */
export const boDau = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const baseName = s => String(s ?? '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim().replace(/\s+\d+$/, '');

/** Bảng tra tên công đoạn: khoá không dấu → tên chuẩn có dấu (gồm danh mục chuẩn + sheet Cong_Doan). */
export function stepIndex(cdNames = []) {
  const m = {};
  for (const s of [...BUOC_CHUAN, ...cdNames]) { const b = baseName(s); if (b && !m[boDau(b)]) m[boDau(b)] = b; }
  for (const [a, b] of Object.entries(ALIAS)) if (!m[a]) m[a] = b;
  return m;
}
/** Tên công đoạn chuẩn (bỏ số lặp "CẮT VÁN 2" → "CẮT VÁN"), null nếu không có trong danh mục. */
export function canonStep(name, idx) {
  const k = boDau(name).replace(/\s+\d+$/, '');
  return idx[k] || null;
}
/** Đánh số công đoạn lặp: CẮT VÁN, ÉP VÁN, CẮT VÁN → CẮT VÁN, ÉP VÁN, CẮT VÁN 2 */
export function numberSteps(buoc) {
  const c = {};
  return buoc.map(s => { c[s] = (c[s] || 0) + 1; return c[s] > 1 ? s + ' ' + c[s] : s; });
}

/* ======================= Chuẩn hoá dòng BOM ======================= */
const numOrNull = v => {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
};
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const up = (v, n) => txt(v, n).toUpperCase();

/**
 * Kiểm tra & chuẩn hoá danh sách dòng BOM do người dùng gửi lên.
 * Dòng: {loai:'CUM'|'CT', maCum, maPK, maPL, ten, dai, rong, day, slct, vatLieu, buoc:[...]|'A > B', ghiChu:{congDoan: ghi chú}}
 */
export function cleanLines(input, idx) {
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, 'BOM chưa có dòng nào');
  if (input.length > 1500) throw new HttpError(400, 'BOM quá lớn (tối đa 1500 dòng)');
  const lines = [], errors = [], warnings = [];
  input.forEach((x, i) => {
    x = x || {};
    const L = {
      stt: i + 1, loai: x.loai === 'CUM' ? 'CUM' : 'CT', maCum: txt(x.maCum, 40), maPK: txt(x.maPK, 40), maPL: txt(x.maPL, 40),
      ten: up(x.ten, 200), dai: numOrNull(x.dai), rong: numOrNull(x.rong), day: numOrNull(x.day), slct: numOrNull(x.slct),
      vatLieu: up(x.vatLieu, 100), buoc: [], ghiChu: {}
    };
    const where = `Dòng ${L.stt}${L.ten ? ' (' + L.ten + ')' : ''}`;
    if (!L.ten) errors.push(`${where}: thiếu tên chi tiết`);
    for (const [f, lb] of [['dai', 'Dài'], ['rong', 'Rộng'], ['day', 'Dày'], ['slct', 'SLCT']])
      if (Number.isNaN(L[f]) || L[f] < 0) { errors.push(`${where}: ${lb} phải là số không âm`); L[f] = null; }
    const raw = Array.isArray(x.buoc) ? x.buoc : String(x.buoc || '').split(/\s*(?:>|→|,|;|\n)\s*/);
    raw.map(s => String(s ?? '').trim()).filter(Boolean).forEach(s => {
      const c = canonStep(s, idx);
      if (c) L.buoc.push(c); else errors.push(`${where}: công đoạn "${s}" không có trong danh mục`);
    });
    if (x.ghiChu && typeof x.ghiChu === 'object')
      for (const [k, v] of Object.entries(x.ghiChu)) { const c = canonStep(k, idx), t = txt(v, 200); if (c && t) L.ghiChu[c] = t; }
    if (L.loai === 'CT') {
      if (!L.slct) L.slct = 1;
      if (L.buoc.length) {
        if (!L.vatLieu) errors.push(`${where}: thiếu vật liệu`);
        if (!(L.day > 0)) errors.push(`${where}: thiếu độ dày`);
        if (!(L.dai > 0) || !(L.rong > 0)) errors.push(`${where}: thiếu kích thước Dài/Rộng`);
        if (L.buoc.length > MAX_CD) errors.push(`${where}: ${L.buoc.length} công đoạn – phiếu sản xuất chỉ chứa tối đa ${MAX_CD}`);
      } else warnings.push(`${where}: chưa có quy trình công đoạn – sẽ không đưa vào phiếu sản xuất`);
    } else { L.buoc = []; L.ghiChu = {}; }
    lines.push(L);
  });
  if (!lines.some(l => l.loai === 'CT')) errors.push('BOM không có dòng chi tiết nào (dòng có Mã phụ kiện)');
  return { lines, errors, warnings };
}

/** Dấu vân tay nội dung sản xuất của BOM (không tính ghi chú) – phát hiện BOM bị đổi giữa lúc đề xuất và lúc duyệt. */
export function hashLines(lines) {
  const s = JSON.stringify(lines.map(l => [l.loai, l.ten, l.dai, l.rong, l.day, l.slct, l.vatLieu, l.buoc.join('>')]));
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

const lineToRow = (ma, l) => ({
  Ma_BOM: ma, STT: l.stt, Loai: l.loai, Ma_Cum: l.maCum, Ma_PK: l.maPK, Ma_PL: l.maPL, Ten_CT: l.ten,
  Dai: l.dai ?? '', Rong: l.rong ?? '', Day: l.day ?? '', SLCT: l.slct ?? '', Vat_Lieu: l.vatLieu,
  Quy_Trinh: l.buoc.join(' > '), Ghi_Chu_CD: Object.keys(l.ghiChu).length ? JSON.stringify(l.ghiChu) : ''
});
const rowToLine = r => {
  let gc = {}; try { gc = r.Ghi_Chu_CD ? JSON.parse(r.Ghi_Chu_CD) : {}; } catch { /* bỏ qua */ }
  const n = v => (v === '' || v == null ? null : Number(v));
  return {
    stt: Number(r.STT) || 0, loai: r.Loai === 'CUM' ? 'CUM' : 'CT', maCum: String(r.Ma_Cum ?? ''), maPK: String(r.Ma_PK ?? ''), maPL: String(r.Ma_PL ?? ''),
    ten: String(r.Ten_CT ?? ''), dai: n(r.Dai), rong: n(r.Rong), day: n(r.Day), slct: n(r.SLCT), vatLieu: String(r.Vat_Lieu ?? ''),
    buoc: String(r.Quy_Trinh || '').split('>').map(s => s.trim()).filter(Boolean), ghiChu: gc
  };
};

/* ======================= Ghi Google Sheet theo ô có kiểu ======================= */
const cellOf = v => {
  if (v == null || v === '') return {};
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  if (typeof v === 'object' && 'date' in v)
    return { userEnteredValue: { numberValue: v.date }, userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } };
  return { userEnteredValue: { stringValue: String(v) } };   // chuỗi luôn là chữ – không bao giờ thành công thức
};
const rowCells = (head, o) => ({ values: head.map(h => cellOf(h ? o[h] : '')) });
export const appendReq = (sheetId, head, objs) =>
  ({ appendCells: { sheetId, rows: objs.map(o => rowCells(head, o)), fields: 'userEnteredValue,userEnteredFormat.numberFormat' } });
const updateRowReq = (sheetId, r, head, o) => ({
  updateCells: { range: { sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: 0, endColumnIndex: head.length }, rows: [rowCells(head, o)], fields: 'userEnteredValue' }
});

/** Kiểm tra ngay trước khi ghi: các dòng dự định sửa/xoá vẫn đúng khoá ở cột A. */
async function verifyRows(targets) {
  if (!targets.length) return;
  const sheets = [...new Set(targets.map(t => t.sheet))];
  const vals = await batchGet(sheets.map(s => q(s) + '!A:A'), 'UNFORMATTED_VALUE');
  const col = {}; sheets.forEach((s, i) => { col[s] = vals[i]; });
  for (const t of targets)
    if (norm((col[t.sheet][t.r - 1] || [])[0]) !== norm(t.a)) throw new HttpError(409, `Dữ liệu sheet ${t.sheet} vừa thay đổi (dòng ${t.r}). Vui lòng thử lại.`);
}
function delRanges(idx) {
  const s = [...new Set(idx)].sort((a, b) => a - b), out = [];
  for (const i of s) { const last = out[out.length - 1]; if (last && last[1] === i) last[1] = i + 1; else out.push([i, i + 1]); }
  return out.reverse();
}

/* ======================= Ngày ======================= */
export function parseDMY(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3], t = Date.UTC(y, mo - 1, d), dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const p = n => String(n).padStart(2, '0');
  return { text: p(d) + '/' + p(mo) + '/' + y, serial: Math.round((t - Date.UTC(1899, 11, 30)) / 86400000), y, mo, d };
}
export const todayVN = () => nowVN().slice(0, 10);

/* ======================= Đọc toàn bộ dữ liệu BOM ======================= */
export async function loadDB() {
  await ensureSheets();
  const [sp, pb, ct, lb, de, lsxA, cd] = await batchGet(
    [q(S.sp), q(S.pb), q(S.bct), q(S.lb), q(S.de), q(S.lsx) + '!A:A', q(S.cd)], 'UNFORMATTED_VALUE');
  const products = toObjects(sp).map(o => ({
    _r: o._r, maSP: String(o.Ma_SP ?? '').trim(), tenSP: String(o.Ten_SP ?? ''), quyCach: String(o.Quy_Cach ?? ''), ghiChu: String(o.Ghi_Chu ?? ''),
    trangThai: String(o.Trang_Thai || 'Đang dùng'), nguoiTao: o.Nguoi_Tao, ngayTao: o.Ngay_Tao
  })).filter(p => p.maSP);
  const versions = toObjects(pb).map(o => ({
    _r: o._r, ma: String(o.Ma_BOM ?? '').trim(), maSP: String(o.Ma_SP ?? '').trim(), pb: Number(o.Phien_Ban) || 0, tt: String(o.Trang_Thai || ''),
    nguon: String(o.Nguon ?? ''), tuPB: String(o.Tu_Phien_Ban ?? ''), soCT: Number(o.So_Chi_Tiet) || 0, ghiChu: String(o.Ghi_Chu ?? ''),
    nguoiTao: o.Nguoi_Tao, tgTao: o.TG_Tao, nguoiGui: o.Nguoi_Gui, tgGui: o.TG_Gui, nguoiDuyet: o.Nguoi_Duyet, tgDuyet: o.TG_Duyet,
    ghiChuDuyet: String(o.Ghi_Chu_Duyet ?? ''), hash: String(o.Hash ?? '')
  })).filter(v => v.ma);
  const ctRows = toObjects(ct);
  const links = toObjects(lb).map(o => ({ _r: o._r, soLSX: String(o.So_LSX ?? ''), maSP: String(o.Ma_SP ?? ''), ma: String(o.Ma_BOM ?? ''), sl: Number(o.So_Luong) || 0 }));
  const drafts = toObjects(de).map(parseDraft).filter(d => d.id);
  const lsxSet = new Set(lsxA.slice(1).map(r => norm(r[0])).filter(Boolean));
  const cdRows = toObjects(cd);
  const cdNames = cdRows.map(c => String(c.Ten_Cong_Doan ?? '').normalize('NFC').toUpperCase().trim()).filter(Boolean);
  const idx = stepIndex(cdNames);

  const vByMa = {}; versions.forEach(v => { vByMa[norm(v.ma)] = v; });
  const linesOf = ma => ctRows.filter(r => norm(r.Ma_BOM) === norm(ma)).map(rowToLine).sort((a, b) => a.stt - b.stt);
  const rowsOf = ma => ctRows.filter(r => norm(r.Ma_BOM) === norm(ma));

  /** Ma_BOM → danh sách lệnh đang dùng (đã tạo, hoặc đang chờ duyệt). Lệnh đã bị xoá khỏi sheet LSX thì không tính. */
  const usage = {};
  const add = (ma, s) => { const k = norm(ma); (usage[k] = usage[k] || []); if (!usage[k].includes(s)) usage[k].push(s); };
  links.forEach(l => { if (lsxSet.has(norm(l.soLSX))) add(l.ma, l.soLSX); });
  drafts.filter(d => d.tt === 'CHO_DUYET' || d.tt === 'DANG_XU_LY')
    .forEach(d => (d.noiDung.items || []).forEach(it => add(it.ma, d.soLSX + ' (chờ duyệt)')));

  const versionsOf = maSP => versions.filter(v => norm(v.maSP) === norm(maSP)).sort((a, b) => a.pb - b.pb);
  /** Phiên bản mới nhất (không tính bản đã huỷ) – chỉ phiên bản này được sửa. */
  const latestOf = maSP => versionsOf(maSP).filter(v => v.tt !== 'DA_HUY').pop() || null;
  const currentOf = maSP => versionsOf(maSP).filter(v => v.tt === 'DA_DUYET').pop() || null;

  return { products, versions, ctRows, links, drafts, lsxSet, cdNames, idx, vByMa, linesOf, rowsOf, usage, versionsOf, latestOf, currentOf };
}

function parseDraft(o) {
  let nd = {}; try { nd = JSON.parse(o.Noi_Dung || '{}'); } catch { /* bỏ qua */ }
  let tt = String(o.Trang_Thai || '');
  const lock = String(o.Ghi_Chu_Duyet || '').match(/^LOCK:(\d+):/);
  if (tt === 'DANG_XU_LY' && lock && Date.now() - +lock[1] > LOCK_MS) tt = 'CHO_DUYET';
  return {
    _r: o._r, id: String(o.ID ?? ''), soLSX: String(o.So_LSX ?? ''), tenLSX: String(o.Ten_LSX ?? ''), tomTat: String(o.Tom_Tat ?? ''), noiDung: nd,
    nguoiTao: o.Nguoi_Tao, tgTao: o.TG_Tao, tt, nguoiDuyet: tt === 'CHO_DUYET' ? '' : o.Nguoi_Duyet, tgDuyet: tt === 'CHO_DUYET' ? '' : o.TG_Duyet,
    ghiChuDuyet: /^LOCK:/.test(o.Ghi_Chu_Duyet || '') ? '' : String(o.Ghi_Chu_Duyet ?? '')
  };
}

/* ======================= Ghi BOM ======================= */
const H = name => HELPER[name].head;
const verRow = v => ({
  Ma_BOM: v.ma, Ma_SP: v.maSP, Phien_Ban: v.pb, Trang_Thai: v.tt, Nguon: v.nguon, Tu_Phien_Ban: v.tuPB, So_Chi_Tiet: v.soCT, Ghi_Chu: v.ghiChu,
  Nguoi_Tao: v.nguoiTao, TG_Tao: v.tgTao, Nguoi_Gui: v.nguoiGui, TG_Gui: v.tgGui, Nguoi_Duyet: v.nguoiDuyet || '', TG_Duyet: v.tgDuyet || '',
  Ghi_Chu_Duyet: v.ghiChuDuyet || '', Hash: v.hash
});
export const maBOM = (maSP, pb) => maSP + '-PB' + String(pb).padStart(2, '0');

/** Tạo phiên bản BOM mới (kèm tạo sản phẩm nếu chưa có) – 1 batchUpdate. */
export async function writeNewVersion(DB, { product, newProduct, ver, lines }) {
  const map = await sheetMap();
  const reqs = [];
  if (newProduct) reqs.push(appendReq(map[S.sp], H(S.sp), [{
    Ma_SP: product.maSP, Ten_SP: product.tenSP, Quy_Cach: product.quyCach, Ghi_Chu: product.ghiChu, Trang_Thai: 'Đang dùng', Nguoi_Tao: product.nguoiTao, Ngay_Tao: product.ngayTao
  }]));
  reqs.push(appendReq(map[S.pb], H(S.pb), [verRow(ver)]));
  reqs.push(appendReq(map[S.bct], H(S.bct), lines.map(l => lineToRow(ver.ma, l))));
  await batchUpdate(reqs);
}

/** Ghi đè nội dung 1 phiên bản (chưa dùng trong lệnh nào): xoá dòng cũ + thêm dòng mới + cập nhật dòng phiên bản – 1 batchUpdate. */
export async function overwriteVersion(DB, ver, lines) {
  const map = await sheetMap();
  const old = DB.rowsOf(ver.ma);
  await verifyRows([...old.map(r => ({ sheet: S.bct, r: r._r, a: r.Ma_BOM })), { sheet: S.pb, r: ver._r, a: ver.ma }]);
  const reqs = delRanges(old.map(r => r._r - 1)).map(([a, b]) =>
    ({ deleteDimension: { range: { sheetId: map[S.bct], dimension: 'ROWS', startIndex: a, endIndex: b } } }));
  reqs.push(appendReq(map[S.bct], H(S.bct), lines.map(l => lineToRow(ver.ma, l))));
  reqs.push(updateRowReq(map[S.pb], ver._r, H(S.pb), verRow(ver)));
  await batchUpdate(reqs);
}

/** Cập nhật trạng thái nhiều phiên bản (duyệt / thay thế / từ chối / huỷ) – 1 batchUpdate. */
export async function updateVersions(vers) {
  const map = await sheetMap();
  await verifyRows(vers.map(v => ({ sheet: S.pb, r: v._r, a: v.ma })));
  await batchUpdate(vers.map(v => updateRowReq(map[S.pb], v._r, H(S.pb), verRow(v))));
}

export async function saveProduct(p, isNew) {
  const map = await sheetMap();
  const o = { Ma_SP: p.maSP, Ten_SP: p.tenSP, Quy_Cach: p.quyCach, Ghi_Chu: p.ghiChu, Trang_Thai: p.trangThai || 'Đang dùng', Nguoi_Tao: p.nguoiTao, Ngay_Tao: p.ngayTao };
  if (isNew) return batchUpdate([appendReq(map[S.sp], H(S.sp), [o])]);
  await verifyRows([{ sheet: S.sp, r: p._r, a: p.maSP }]);
  return batchUpdate([updateRowReq(map[S.sp], p._r, H(S.sp), o)]);
}

/* ======================= Lệnh sản xuất từ BOM ======================= */
/** Kiểm tra thông tin lệnh: {soLSX, tenLSX, ngayCap, nguoiCap, hanHT} */
export function cleanHeader(h) {
  h = h || {};
  const soLSX = String(h.soLSX || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._\-/]{2,39}$/.test(soLSX)) throw new HttpError(400, 'Số LSX chỉ gồm chữ, số, dấu - . _ / (3–40 ký tự)');
  const tenLSX = txt(h.tenLSX, 200);
  if (!tenLSX) throw new HttpError(400, 'Vui lòng nhập tên lệnh');
  const ngayCap = parseDMY(h.ngayCap || todayVN());
  if (!ngayCap) throw new HttpError(400, 'Ngày cấp lệnh phải có dạng dd/mm/yyyy');
  const han = parseDMY(h.hanHT);
  if (!han) throw new HttpError(400, 'Hạn hoàn thành phải có dạng dd/mm/yyyy');
  if (han.serial < ngayCap.serial) throw new HttpError(400, 'Hạn hoàn thành phải sau ngày cấp lệnh');
  const nguoiCap = txt(h.nguoiCap, 100);
  if (!nguoiCap) throw new HttpError(400, 'Vui lòng nhập người cấp lệnh');
  return { soLSX, tenLSX, ngayCap: ngayCap.text, nguoiCap, hanHT: han.text };
}

/** items: [{ma: Ma_BOM, sl: số bộ}] */
export function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Chưa chọn sản phẩm nào');
  if (items.length > 60) throw new HttpError(400, 'Tối đa 60 sản phẩm trong 1 lệnh');
  return items.map(it => {
    const sl = numOrNull(it && it.sl);
    if (!(sl > 0) || !Number.isInteger(sl)) throw new HttpError(400, `Số lượng của ${it && it.ma} phải là số nguyên dương`);
    return { ma: String(it.ma || '').trim(), sl };
  });
}

const fmtNum = n => String(Math.round(n * 1000) / 1000);
const pad2 = n => String(n).padStart(2, '0');

/**
 * Lập kế hoạch phiếu: gộp chi tiết cùng TÊN + VẬT LIỆU + ĐỘ DÀY + QUY TRÌNH CÔNG ĐOẠN thành 1 phiếu.
 * Mỗi sản phẩm là 1 dòng trong phiếu (cùng sản phẩm, cùng kích thước thì cộng dồn SL/bộ).
 * mode 'create': phiên bản phải đang hiện hành; 'approve': chấp nhận cả bản đã bị thay thế, nhưng nội dung phải khớp hash lúc đề xuất.
 */
export function buildPlan(DB, header, items, mode = 'create', hashes = {}) {
  const errors = [], warnings = [];
  const seenSP = new Set(), groups = new Map(), its = [];
  let ord = 0;
  for (const it of items) {
    const v = DB.vByMa[norm(it.ma)];
    if (!v) { errors.push(`Không tìm thấy phiên bản BOM ${it.ma}`); continue; }
    if (seenSP.has(norm(v.maSP))) { errors.push(`Sản phẩm ${v.maSP} bị chọn 2 lần`); continue; }
    seenSP.add(norm(v.maSP));
    const p = DB.products.find(x => norm(x.maSP) === norm(v.maSP));
    if (mode === 'create' && v.tt !== 'DA_DUYET') errors.push(`${v.ma}: BOM chưa được duyệt hoặc không còn hiện hành (${TT_BOM[v.tt] || v.tt})`);
    if (mode !== 'create' && !['DA_DUYET', 'THAY_THE'].includes(v.tt)) errors.push(`${v.ma}: BOM không còn ở trạng thái đã duyệt (${TT_BOM[v.tt] || v.tt})`);
    if (mode !== 'create' && v.tt === 'THAY_THE') warnings.push(`${v.ma}: đã có phiên bản BOM mới hơn được duyệt sau khi đề xuất lệnh`);
    if (p && /NGỪNG/i.test(p.trangThai) && mode === 'create') errors.push(`Sản phẩm ${v.maSP} đang ở trạng thái Ngừng`);
    const lines = DB.linesOf(v.ma);
    const h = hashLines(lines);
    if (hashes[norm(v.ma)] && hashes[norm(v.ma)] !== h) errors.push(`${v.ma}: nội dung BOM đã thay đổi so với lúc đề xuất lệnh`);
    its.push({ maSP: v.maSP, tenSP: p ? p.tenSP : '', ma: v.ma, pb: v.pb, sl: it.sl, hash: h });
    for (const l of lines) {
      if (l.loai !== 'CT') continue;
      if (!l.buoc.length) { warnings.push(`${v.maSP} – ${l.ten}: không có quy trình công đoạn, bỏ qua`); continue; }
      const key = [norm(l.ten), norm(l.vatLieu), fmtNum(l.day || 0), l.buoc.join('>')].join('|');
      let g = groups.get(key);
      if (!g) groups.set(key, g = { ten: l.ten, vatLieu: l.vatLieu, day: l.day || 0, buoc: l.buoc, ord: ord++, lines: [] });
      const lk = norm(v.maSP) + '|' + (l.dai || 0) + '|' + (l.rong || 0);
      const x = g.lines.find(y => y.k === lk);
      if (x) x.sl1 += l.slct || 1;
      else g.lines.push({ k: lk, maSP: v.maSP, ten: l.ten, dai: l.dai || 0, rong: l.rong || 0, sl1: l.slct || 1, sp: it.sl });
    }
  }
  const so = header.soLSX;
  const cdSet = new Set(DB.cdNames);
  const lack = new Set();
  const psx = [...groups.values()].sort((a, b) => a.ord - b.ord).map((g, i) => {
    const maPSX = so + '-P' + pad2(i + 1);
    const steps = numberSteps(g.buoc);
    steps.forEach(s => { if (!cdSet.has(s)) lack.add(s); });
    g.lines.sort((a, b) => b.dai - a.dai || b.rong - a.rong || a.maSP.localeCompare(b.maSP));
    return {
      ma: maPSX, ten: g.ten, vatLieu: `${g.vatLieu} ${fmtNum(g.day)}mm`, buoc: steps,
      lines: g.lines.map((l, j) => ({ ma: maPSX + '-' + pad2(j + 1), maSP: l.maSP, nhan: l.maSP + ' - ' + l.ten, dai: l.dai, rong: l.rong, sl1: l.sl1, tong: l.sl1 * l.sp }))
    };
  });
  if (lack.size) warnings.push('Công đoạn chưa có trong sheet Cong_Doan (ứng dụng ghi sản lượng có thể chưa nhận): ' + [...lack].join(', '));
  if (!psx.length && !errors.length) errors.push('Không có chi tiết nào có quy trình công đoạn để tạo phiếu');
  const tong = psx.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.tong, 0), 0);
  return {
    header, items: its, psx, errors, warnings: [...new Set(warnings)],
    totals: { sp: its.length, psx: psx.length, dong: psx.reduce((a, p) => a + p.lines.length, 0), chiTiet: tong }
  };
}

/** Số lệnh gợi ý: MOyymmNN-HT (theo các lệnh đã có trong tháng). */
export function suggestSoLSX(DB) {
  const t = todayVN(), yy = t.slice(8, 10), mm = t.slice(3, 5);
  const pre = 'MO' + yy + mm;
  let max = 0;
  const all = [...DB.lsxSet, ...DB.drafts.filter(d => d.tt !== 'DA_HUY' && d.tt !== 'TU_CHOI').map(d => norm(d.soLSX))];
  all.forEach(s => { const m = s.match(new RegExp('^' + pre + '(\\d{2,})')); if (m) max = Math.max(max, +m[1]); });
  return pre + pad2(max + 1) + '-HT';
}

/** Kiểm tra số lệnh chưa trùng (LSX đã có + đề xuất đang chờ). */
export function assertSoLSXFree(DB, soLSX, exceptId) {
  if (DB.lsxSet.has(norm(soLSX))) throw new HttpError(409, `Số lệnh ${soLSX} đã tồn tại trong sheet LSX`);
  const d = DB.drafts.find(x => x.id !== exceptId && norm(x.soLSX) === norm(soLSX) && ['CHO_DUYET', 'DANG_XU_LY', 'DA_DUYET'].includes(x.tt));
  if (d) throw new HttpError(409, `Số lệnh ${soLSX} đã được dùng trong đề xuất ${d.id}`);
}

/** Ghi lệnh + phiếu + chi tiết + liên kết LSX_BOM trong 1 batchUpdate (nguyên tử). */
export async function writeLSX(plan, draftId) {
  const map = await sheetMap();
  const [hl, hp, hc] = await batchGet([q(S.lsx) + '!1:1', q(S.psx) + '!1:1', q(S.ct) + '!1:1']);
  const head = v => (v[0] || []).map(x => String(x).trim());
  const HL = head(hl), HP = head(hp), HC = head(hc);
  for (const [h, need, name] of [[HL, ['So_LSX', 'Ten_LSX'], S.lsx], [HP, ['Ma_PSX', 'Lenh_SX', 'CD1'], S.psx], [HC, ['Ma_Dong', 'Ma_PSX', 'Nhan'], S.ct]])
    for (const k of need) if (!h.includes(k)) throw new HttpError(500, `Sheet ${name} thiếu cột ${k}`);
  // Không cho trùng mã phiếu/mã dòng với dữ liệu sẵn có
  const [pa, ca] = await batchGet([q(S.psx) + '!A:A', q(S.ct) + '!A:A'], 'UNFORMATTED_VALUE');
  const ps = new Set(pa.map(r => norm(r[0]))), cs = new Set(ca.map(r => norm(r[0])));
  const dup = plan.psx.filter(p => ps.has(norm(p.ma))).map(p => p.ma).concat(plan.psx.flatMap(p => p.lines.filter(l => cs.has(norm(l.ma))).map(l => l.ma)));
  if (dup.length) throw new HttpError(409, 'Mã phiếu/mã dòng đã tồn tại: ' + dup.slice(0, 5).join(', '));

  const h = plan.header, dCap = { date: parseDMY(h.ngayCap).serial }, dHan = { date: parseDMY(h.hanHT).serial };
  const lsxRow = { So_LSX: h.soLSX, Ten_LSX: h.tenLSX, Ngay_Cap_Lenh: dCap, Nguoi_Cap_Lenh: h.nguoiCap, Ngay_Hoan_Thanh: dHan, Trang_Thai: 'Mới' };
  const psxRows = plan.psx.map(p => {
    const o = { Ma_PSX: p.ma, Lenh_SX: h.soLSX, Trang_Thai: 'Mới', Vat_Lieu: p.vatLieu, Nguoi_Thuc_Hien: h.nguoiCap, Ngay_Nhan_Phieu: dCap };
    for (let i = 1; i <= MAX_CD; i++) o['CD' + i] = p.buoc[i - 1] || '';
    return o;
  });
  const ctRows = plan.psx.flatMap(p => p.lines.map(l => ({ Ma_Dong: l.ma, Ma_PSX: p.ma, Nhan: l.nhan, Dai: l.dai, Rong: l.rong, Tong_So_Luong: l.tong, So_Luong_1_Bo: l.sl1 })));
  const t = nowVN();
  const lbRows = plan.items.map(it => ({ So_LSX: h.soLSX, Ma_SP: it.maSP, Ma_BOM: it.ma, So_Luong: it.sl, Thoi_Gian: t, De_Xuat_ID: draftId }));
  await batchUpdate([
    appendReq(map[S.lsx], HL, [lsxRow]),
    appendReq(map[S.psx], HP, psxRows),
    appendReq(map[S.ct], HC, ctRows),
    appendReq(map[S.lb], H(S.lb), lbRows)
  ]);
  return { lsx: 1, psx: psxRows.length, ct: ctRows.length };
}

/* ======================= Đề xuất lệnh: khoá xử lý ======================= */
export const setDraftStatus = (r, st, who, note) =>
  updateValues(q(S.de) + `!H${r}:K${r}`, [[st, who || '', who ? nowVN() : '', note || '']]);

/** Giành quyền xử lý 1 đề xuất (tránh 2 người duyệt cùng lúc tạo lệnh 2 lần). */
export async function claimDraft(r, who) {
  const tag = 'LOCK:' + Date.now() + ':' + crypto.randomBytes(6).toString('hex');
  await updateValues(q(S.de) + `!H${r}:K${r}`, [['DANG_XU_LY', who, nowVN(), tag]]);
  await sleep(1500);
  const [v] = await batchGet([q(S.de) + `!H${r}:K${r}`]);
  if (!v[0] || v[0][3] !== tag) throw new HttpError(409, 'Đề xuất đang được người khác xử lý');
}

export const newDraftId = () => 'LX' + nowVN().replace(/\D/g, '').slice(2, 14) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
