// Nghiệp vụ sửa / xoá lệnh sản xuất trên các sheet gốc.
import crypto from 'node:crypto';
import { batchGet, batchUpdate, append, sheetMap, q } from './google.js';
import { HttpError, nowVN } from './http.js';
import { S, norm, toObjects } from './store.js';

/** Các trường được phép sửa: kiểu dữ liệu + nhãn hiển thị. */
export const FIELDS = {
  LSX: {
    sheet: S.lsx, key: 'So_LSX', ten: 'Lệnh SX',
    fields: {
      Ten_LSX: ['text', 'Tên lệnh'], Ngay_Cap_Lenh: ['date', 'Ngày cấp'], Nguoi_Cap_Lenh: ['text', 'Người cấp'],
      Ngay_Hoan_Thanh: ['date', 'Hạn hoàn thành'], Trang_Thai: ['text', 'Trạng thái']
    }
  },
  PSX: {
    sheet: S.psx, key: 'Ma_PSX', ten: 'Phiếu SX',
    fields: Object.assign({
      Trang_Thai: ['text', 'Trạng thái'], Vat_Lieu: ['text', 'Vật liệu'], Nguoi_Thuc_Hien: ['text', 'Người thực hiện'],
      Ngay_Nhan_Phieu: ['date', 'Ngày nhận phiếu']
    }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['CD' + (i + 1), ['text', 'Công đoạn ' + (i + 1)]])))
  },
  CT: {
    sheet: S.ct, key: 'Ma_Dong', ten: 'Chi tiết',
    fields: {
      Nhan: ['text', 'Nhãn'], Dai: ['num', 'Dài'], Rong: ['num', 'Rộng'],
      Tong_So_Luong: ['num', 'Tổng SL'], So_Luong_1_Bo: ['num', 'SL/bộ']
    }
  }
};

/* ---------------- Kiểm tra & chuyển đổi giá trị ---------------- */
function parseDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const t = Date.UTC(y, mo - 1, d), dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { d, mo, y, serial: Math.round((t - Date.UTC(1899, 11, 30)) / 86400000) };
}
const parseNum = s => { const t = String(s).trim().replace(/\s/g, '').replace(',', '.'); return /^\d+(\.\d+)?$/.test(t) ? +t : null; };
const pad = n => String(n).padStart(2, '0');

/** Chuẩn hoá giá trị mới theo kiểu; ném lỗi nếu sai định dạng. */
export function cleanValue(type, label, v) {
  v = String(v == null ? '' : v).trim();
  if (v.length > 500) throw new HttpError(400, `${label}: quá dài`);
  if (v === '') return '';
  if (type === 'date') {
    const d = parseDate(v);
    if (!d) throw new HttpError(400, `${label}: ngày phải có dạng dd/mm/yyyy (vd. 30/11/2026)`);
    return pad(d.d) + '/' + pad(d.mo) + '/' + d.y;
  }
  if (type === 'num') {
    const n = parseNum(v);
    if (n === null) throw new HttpError(400, `${label}: phải là số không âm`);
    return String(n);
  }
  return v;
}
/** So sánh giá trị cũ (đã định dạng từ sheet) và mới theo kiểu. */
function same(type, a, b) {
  a = String(a == null ? '' : a).trim(); b = String(b == null ? '' : b).trim();
  if (type === 'date') { const x = parseDate(a), y = parseDate(b); return x && y ? x.serial === y.serial : a === b; }
  if (type === 'num') { const x = parseNum(a), y = parseNum(b); return x !== null && y !== null ? x === y : a === b; }
  return a === b;
}
function cellValue(type, v) {
  if (v === '') return {};
  if (type === 'date') return { numberValue: parseDate(v).serial };   // giữ nguyên định dạng ngày của ô
  if (type === 'num') return { numberValue: parseNum(v) };
  return { stringValue: v };
}

/* ---------------- Đọc bảng tươi ---------------- */
async function readTables(names) {
  const vals = await batchGet(names.map(n => q(n)));
  const out = {};
  names.forEach((n, i) => { out[n] = { head: (vals[i][0] || []).map(x => String(x).trim()), rows: toObjects(vals[i]) }; });
  return out;
}

/** Phạm vi ảnh hưởng khi xoá 1 lệnh hoặc 1 phiếu. */
export async function deletePlan(kind, key) {
  const T = await readTables([S.lsx, S.psx, S.ct, S.gsl]);
  const k = norm(key);
  let lsx = [], psx;
  if (kind === 'LSX') {
    lsx = T[S.lsx].rows.filter(r => norm(r.So_LSX) === k);
    if (!lsx.length) throw new HttpError(404, 'Không tìm thấy lệnh ' + key);
    psx = T[S.psx].rows.filter(r => norm(r.Lenh_SX) === k);
  } else {
    psx = T[S.psx].rows.filter(r => norm(r.Ma_PSX) === k);
    if (!psx.length) throw new HttpError(404, 'Không tìm thấy phiếu ' + key);
  }
  const psxKeys = new Set(psx.map(r => norm(r.Ma_PSX)));
  const ct = T[S.ct].rows.filter(r => psxKeys.has(norm(r.Ma_PSX)));
  const dongKeys = new Set(ct.map(r => norm(r.Ma_Dong)));
  const gsl = T[S.gsl].rows.filter(r => dongKeys.has(norm(r.Ma_Dong)));
  return {
    T, lsx, psx, ct, gsl,
    soLSX: kind === 'LSX' ? lsx[0].So_LSX : psx[0].Lenh_SX,
    count: { lsx: lsx.length, psx: psx.length, ct: ct.length, gsl: gsl.length, slTong: gsl.reduce((a, g) => a + (parseNum(g.So_Luong) || 0), 0) }
  };
}

/** Gom chỉ số dòng (0-based) thành các khoảng liên tiếp, sắp giảm dần để xoá không lệch chỉ số. */
function ranges(idx) {
  const s = [...new Set(idx)].sort((a, b) => a - b), out = [];
  for (const i of s) { const last = out[out.length - 1]; if (last && last[1] === i) last[1] = i + 1; else out.push([i, i + 1]); }
  return out.reverse();
}

/** Kiểm tra lại ngay trước khi ghi: các dòng dự định thao tác vẫn đúng khoá ở cột A (phòng sheet bị chèn/xoá/sắp xếp). */
async function verifyRows(targets) {
  const sheets = [...new Set(targets.map(t => t.sheet))];
  const vals = await batchGet(sheets.map(s => q(s) + '!A:A'));
  const col = {}; sheets.forEach((s, i) => { col[s] = vals[i]; });
  for (const t of targets) {
    const cur = (col[t.sheet][t.r - 1] || [])[0];
    if (norm(cur) !== norm(t.a)) throw new HttpError(409, `Dữ liệu sheet ${t.sheet} vừa thay đổi (dòng ${t.r}). Vui lòng thử lại.`);
  }
}

/** Thực thi xoá: sao lưu vào _Thung_Rac rồi xoá nguyên tử tất cả dòng trong 1 batchUpdate. */
export async function execDelete(reqId, kind, key, withOutput) {
  const P = await deletePlan(kind, key);
  if (P.gsl.length && !withOutput)
    throw new HttpError(409, `Đã phát sinh ${P.gsl.length} lượt ghi sản lượng kể từ khi đề xuất. Cần đề xuất lại với tuỳ chọn xoá cả sản lượng.`);
  const groups = [[S.lsx, P.lsx, 'So_LSX'], [S.psx, P.psx, 'Ma_PSX'], [S.ct, P.ct, 'Ma_Dong'], [S.gsl, withOutput ? P.gsl : [], 'ID']];
  const targets = [];
  const trash = [];
  const t = nowVN();
  for (const [sheet, rows, keyField] of groups) {
    const head = P.T[sheet].head;
    for (const r of rows) {
      targets.push({ sheet, r: r._r, a: r[head[0]] });
      trash.push([t, reqId, sheet, r[keyField], JSON.stringify(head.map(h => (h ? r[h] ?? '' : '')))]);
    }
  }
  await verifyRows(targets);
  if (trash.length) await append(S.tr, trash);
  const map = await sheetMap();
  const requests = [];
  for (const sheet of [S.gsl, S.ct, S.psx, S.lsx]) {
    const idx = targets.filter(x => x.sheet === sheet).map(x => x.r - 1);
    for (const [a, b] of ranges(idx))
      requests.push({ deleteDimension: { range: { sheetId: map[sheet], dimension: 'ROWS', startIndex: a, endIndex: b } } });
  }
  if (requests.length) await batchUpdate(requests);
  return P.count;
}

/**
 * Chuẩn bị yêu cầu sửa: kiểm tra trường hợp lệ, thuộc đúng lệnh, ghi lại giá trị cũ.
 * changes: [{s:'LSX'|'PSX'|'CT', k:khoá, f:trường, n:giá trị mới}]
 */
export async function prepareEdit(soLSX, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new HttpError(400, 'Chưa có thay đổi nào');
  if (changes.length > 300) throw new HttpError(400, 'Quá nhiều thay đổi trong 1 yêu cầu');
  const T = await readTables([S.lsx, S.psx, S.ct]);
  const k = norm(soLSX);
  if (!T[S.lsx].rows.some(r => norm(r.So_LSX) === k)) throw new HttpError(404, 'Không tìm thấy lệnh ' + soLSX);
  const psxOf = new Set(T[S.psx].rows.filter(r => norm(r.Lenh_SX) === k).map(r => norm(r.Ma_PSX)));
  const out = [], seen = new Set();
  for (const c of changes) {
    const def = FIELDS[c.s];
    if (!def || !def.fields[c.f]) throw new HttpError(400, 'Trường không được phép sửa: ' + c.s + '.' + c.f);
    const [type, label] = def.fields[c.f];
    const row = T[def.sheet].rows.find(r => norm(r[def.key]) === norm(c.k));
    if (!row) throw new HttpError(404, `Không tìm thấy ${def.ten} ${c.k}`);
    const belongs = c.s === 'LSX' ? norm(row.So_LSX) === k : c.s === 'PSX' ? psxOf.has(norm(row.Ma_PSX)) : psxOf.has(norm(row.Ma_PSX));
    if (!belongs) throw new HttpError(400, `${def.ten} ${c.k} không thuộc lệnh ${soLSX}`);
    const id = c.s + '|' + norm(c.k) + '|' + c.f;
    if (seen.has(id)) throw new HttpError(400, 'Trùng thay đổi: ' + c.k + ' ' + label);
    seen.add(id);
    const n = cleanValue(type, `${c.k} – ${label}`, c.n);
    const o = row[c.f] == null ? '' : String(row[c.f]);
    if (same(type, o, n)) continue;
    out.push({ s: c.s, k: row[def.key], f: c.f, o, n });
  }
  if (!out.length) throw new HttpError(400, 'Giá trị mới giống giá trị hiện tại – không có gì để sửa');
  return out;
}

/** Áp dụng yêu cầu sửa. Từ chối nếu giá trị hiện tại đã khác giá trị cũ lúc đề xuất. */
export async function execEdit(changes) {
  const sheets = [...new Set(changes.map(c => FIELDS[c.s].sheet))];
  const T = await readTables(sheets);
  const map = await sheetMap();
  const targets = [], requests = [], conflicts = [];
  for (const c of changes) {
    const def = FIELDS[c.s], [type, label] = def.fields[c.f];
    const tb = T[def.sheet];
    const row = tb.rows.find(r => norm(r[def.key]) === norm(c.k));
    if (!row) { conflicts.push(`${c.k} không còn tồn tại`); continue; }
    if (!same(type, row[c.f], c.o) && !same(type, row[c.f], c.n)) { conflicts.push(`${c.k} – ${label}: hiện là "${row[c.f]}", lúc đề xuất là "${c.o}"`); continue; }
    const col = tb.head.indexOf(c.f);
    if (col < 0) throw new HttpError(500, 'Không thấy cột ' + c.f + ' trong sheet ' + def.sheet);
    targets.push({ sheet: def.sheet, r: row._r, a: row[tb.head[0]] });
    requests.push({
      updateCells: {
        range: { sheetId: map[def.sheet], startRowIndex: row._r - 1, endRowIndex: row._r, startColumnIndex: col, endColumnIndex: col + 1 },
        rows: [{ values: [{ userEnteredValue: cellValue(type, c.n) }] }], fields: 'userEnteredValue'
      }
    });
  }
  if (conflicts.length) throw new HttpError(409, 'Dữ liệu đã bị thay đổi sau khi đề xuất:\n- ' + conflicts.join('\n- ') + '\nHãy từ chối và đề xuất lại.');
  await verifyRows(targets);
  await batchUpdate(requests);
  return { soO: requests.length };
}

/** Khôi phục dữ liệu đã xoá từ _Thung_Rac (thêm lại vào cuối các sheet gốc). */
export async function execRestore(reqId) {
  const T = await readTables([S.tr, S.lsx, S.psx, S.ct, S.gsl]);
  const items = T[S.tr].rows.filter(r => r.Yeu_Cau_ID === reqId);
  if (!items.length) throw new HttpError(404, 'Không tìm thấy dữ liệu sao lưu của yêu cầu này');
  const keyField = { [S.lsx]: 'So_LSX', [S.psx]: 'Ma_PSX', [S.ct]: 'Ma_Dong', [S.gsl]: 'ID' };
  const dup = items.filter(it => T[it.Sheet] && T[it.Sheet].rows.some(r => norm(r[keyField[it.Sheet]]) === norm(it.Khoa)));
  if (dup.length) throw new HttpError(409, 'Không thể khôi phục vì đã tồn tại: ' + dup.slice(0, 5).map(d => d.Khoa).join(', '));
  const count = {};
  for (const sheet of [S.lsx, S.psx, S.ct, S.gsl]) {
    const rows = items.filter(it => it.Sheet === sheet).map(it => JSON.parse(it.Du_Lieu));
    if (!rows.length) continue;
    await append(sheet, rows, 'USER_ENTERED');
    count[sheet] = rows.length;
  }
  return count;
}

export const newId = () => 'YC' + nowVN().replace(/\D/g, '').slice(2, 14) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
