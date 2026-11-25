// Lớp dữ liệu: tên sheet, sheet phụ, tài khoản, phiên đăng nhập, phân quyền, nhật ký.
import crypto from 'node:crypto';
import { batchGet, batchUpdate, updateValues, append, sheetMap, gridOf, q } from './google.js';
import { HttpError, nowVN } from './http.js';

export const S = {
  lsx: 'LSX', psx: 'Phieu_San_Xuat', ct: 'Chi_Tiet_PSX', gsl: 'Ghi_San_Luong', cd: 'Cong_Doan', nd: 'Nguoi_Dung',
  tk: '_Tai_Khoan', yc: '_Yeu_Cau', tr: '_Thung_Rac', nk: '_Nhat_Ky',
  sp: 'San_Pham', pb: 'BOM_Phien_Ban', bct: 'BOM_Chi_Tiet', lb: 'LSX_BOM', de: '_LSX_De_Xuat'
};

/** Sheet phụ do hệ thống này tạo (tự tạo nếu chưa có). Không đụng tới cấu trúc sheet gốc.
 *  Sheet đã có mà thiếu cột ở cuối (bản cũ) sẽ được tự thêm cột + tiêu đề. */
export const HELPER = {
  [S.tk]: { hidden: true, head: ['Email', 'Ho_Ten', 'Vai_Tro', 'Nen_Tang', 'Mat_Khau', 'Kich_Hoat', 'Ngay_Tao', 'Ghi_Chu', 'Quyen'] },
  [S.yc]: { hidden: false, head: ['ID', 'Loai', 'Doi_Tuong', 'So_LSX', 'Tom_Tat', 'Noi_Dung', 'Ly_Do', 'Nguoi_De_Xuat', 'Thoi_Gian_De_Xuat', 'Trang_Thai', 'Nguoi_Duyet', 'Thoi_Gian_Duyet', 'Ghi_Chu_Duyet'] },
  [S.tr]: { hidden: true, head: ['Thoi_Gian', 'Yeu_Cau_ID', 'Sheet', 'Khoa', 'Du_Lieu'] },
  [S.nk]: { hidden: false, head: ['Thoi_Gian', 'Nguoi', 'Nen_Tang', 'Hanh_Dong', 'Doi_Tuong', 'Chi_Tiet'] },
  // ---- Sản phẩm / BOM / Lệnh SX từ BOM ----
  [S.sp]: { hidden: false, head: ['Ma_SP', 'Ten_SP', 'Quy_Cach', 'Ghi_Chu', 'Trang_Thai', 'Nguoi_Tao', 'Ngay_Tao'] },
  [S.pb]: { hidden: false, head: ['Ma_BOM', 'Ma_SP', 'Phien_Ban', 'Trang_Thai', 'Nguon', 'Tu_Phien_Ban', 'So_Chi_Tiet', 'Ghi_Chu',
    'Nguoi_Tao', 'TG_Tao', 'Nguoi_Gui', 'TG_Gui', 'Nguoi_Duyet', 'TG_Duyet', 'Ghi_Chu_Duyet', 'Hash'] },
  [S.bct]: { hidden: false, head: ['Ma_BOM', 'STT', 'Loai', 'Ma_Cum', 'Ma_PK', 'Ma_PL', 'Ten_CT', 'Dai', 'Rong', 'Day', 'SLCT', 'Vat_Lieu', 'Quy_Trinh', 'Ghi_Chu_CD'] },
  [S.lb]: { hidden: false, head: ['So_LSX', 'Ma_SP', 'Ma_BOM', 'So_Luong', 'Thoi_Gian', 'De_Xuat_ID'] },
  [S.de]: { hidden: false, head: ['ID', 'So_LSX', 'Ten_LSX', 'Tom_Tat', 'Noi_Dung', 'Nguoi_Tao', 'TG_Tao', 'Trang_Thai', 'Nguoi_Duyet', 'TG_Duyet', 'Ghi_Chu_Duyet'] }
};

/* ---------------- Quyền chức năng (gán riêng từng tài khoản, quản trị có tất cả) ---------------- */
export const PERMS = {
  bom_up: 'Upload BOM / tạo sản phẩm',
  bom_sua: 'Sửa BOM & thông tin sản phẩm',
  bom_duyet: 'Duyệt BOM',
  lsx_tao: 'Tạo lệnh SX từ BOM',
  lsx_duyet: 'Phê duyệt lệnh SX từ BOM'
};
export const hasPerm = (u, p) => !!u && (u.role === 'admin' || (u.perms || []).includes(p));

/* ---------------- Vai trò & quyền ---------------- */
export const ROLES = {
  xem: { rank: 0, ten: 'Chỉ xem' },
  de_xuat: { rank: 1, ten: 'Đề xuất sửa/xoá' },
  duyet: { rank: 2, ten: 'Duyệt yêu cầu' },
  admin: { rank: 3, ten: 'Quản trị' }
};
export const PLATFORMS = { pc: 'Chỉ máy tính', mobile: 'Chỉ điện thoại', ca_hai: 'Cả hai' };
export const rank = r => (ROLES[r] ? ROLES[r].rank : -1);
export const can = (user, need) => rank(user.role) >= rank(need);

/* ---------------- Tiện ích bảng ---------------- */
export const norm = s => String(s == null ? '' : s).trim().toUpperCase();

/** values[][] (dòng 1 là tiêu đề) -> mảng object, mỗi object có _r = số dòng thật trên sheet (1-based) */
export function toObjects(values) {
  if (!values.length) return [];
  const head = values[0].map(x => String(x).trim());
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r.some(c => String(c).trim() !== '')) continue;
    const o = { _r: i + 1 };
    head.forEach((k, j) => { if (k) o[k] = r[j] == null ? '' : r[j]; });
    out.push(o);
  }
  return out;
}

/* ---------------- Tạo sheet phụ ---------------- */
let ensured = false;
export async function ensureSheets() {
  if (ensured) return;
  const map = await sheetMap();
  const titles = Object.keys(HELPER);
  const missing = titles.filter(t => !(t in map));
  if (missing.length) {
    await batchUpdate(missing.map(title => ({
      addSheet: { properties: { title, hidden: HELPER[title].hidden, gridProperties: { rowCount: 1000, columnCount: HELPER[title].head.length, frozenRowCount: 1 } } }
    })));
    for (const t of missing) await updateValues(q(t) + '!A1', [HELPER[t].head]);
    await sheetMap(true);
  }
  // Nâng cấp sheet phụ đã có: thêm cột mới ở cuối (vd. cột Quyen của _Tai_Khoan)
  const existing = titles.filter(t => !missing.includes(t));
  if (existing.length) {
    const heads = await batchGet(existing.map(t => q(t) + '!1:1'));
    const grow = [], rewrite = [];
    existing.forEach((t, i) => {
      const cur = (heads[i][0] || []).map(x => String(x).trim()), want = HELPER[t].head;
      if (want.every((h, j) => cur[j] === h)) return;
      if (!cur.every((h, j) => !h || h === want[j])) { console.error('Tiêu đề sheet ' + t + ' khác dự kiến – không tự nâng cấp'); return; }
      const cols = gridOf(t).cols;
      if (cols < want.length) grow.push({ appendDimension: { sheetId: map[t], dimension: 'COLUMNS', length: want.length - cols } });
      rewrite.push(t);
    });
    if (grow.length) await batchUpdate(grow);
    for (const t of rewrite) await updateValues(q(t) + '!A1', [HELPER[t].head]);
    if (grow.length) await sheetMap(true);
  }
  ensured = true;
}

/* ---------------- Mật khẩu ---------------- */
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 32);
  return 's1$' + salt.toString('base64') + '$' + h.toString('base64');
}
export function checkPw(pw, stored) {
  const [v, s, h] = String(stored || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}
export function validPw(pw) {
  if (String(pw || '').length < 6) throw new HttpError(400, 'Mật khẩu phải có ít nhất 6 ký tự');
}

/* ---------------- Tài khoản ---------------- */
let accCache = { at: 0, list: null };
export async function readAccounts(force = false) {
  if (!force && accCache.list && Date.now() - accCache.at < 20_000) return accCache.list;
  await ensureSheets();
  const [v] = await batchGet([q(S.tk)]);
  const list = toObjects(v).map(o => ({
    _r: o._r, email: String(o.Email).trim().toLowerCase(), name: o.Ho_Ten, role: o.Vai_Tro || 'xem',
    platform: o.Nen_Tang || 'ca_hai', hash: o.Mat_Khau, active: !/^(0|FALSE|KHÔNG|NO)$/i.test(String(o.Kich_Hoat).trim()),
    created: o.Ngay_Tao, note: o.Ghi_Chu,
    perms: String(o.Quyen || '').split(/[\s,;]+/).filter(p => PERMS[p])
  })).filter(a => a.email);
  accCache = { at: Date.now(), list };
  return list;
}
export function clearAccCache() { accCache = { at: 0, list: null }; }

export const accRow = a => [a.email, a.name || '', a.role, a.platform, a.hash || '', a.active ? '1' : '0', a.created || nowVN(), a.note || '',
  (a.perms || []).filter(p => PERMS[p]).join(',')];

export async function saveAccount(a) {
  await ensureSheets();
  if (a._r) await updateValues(q(S.tk) + `!A${a._r}:I${a._r}`, [accRow(a)]);
  else await append(S.tk, [accRow(a)]);
  clearAccCache();
}

export const publicUser = a => ({ email: a.email, name: a.name, role: a.role, roleName: ROLES[a.role]?.ten || a.role, platform: a.platform, active: a.active, created: a.created, perms: a.perms || [] });

/* ---------------- Phiên đăng nhập (cookie ký HMAC, gắn nền tảng) ---------------- */
const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'Máy chủ chưa cấu hình SESSION_SECRET');
  return s;
};
const hmac = data => crypto.createHmac('sha256', SECRET()).update(data).digest('base64url');

export function signSession(p) {
  const data = Buffer.from(JSON.stringify(p)).toString('base64url');
  return data + '.' + hmac(data);
}
function verifySession(t) {
  const [data, sig] = String(t || '').split('.');
  if (!data || !sig) return null;
  const want = Buffer.from(hmac(data)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const p = JSON.parse(Buffer.from(data, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

export const isMobileUA = ua => /Android|iPhone|iPod|iPad|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(ua || '');

/** Ứng dụng đang gọi: 'pc' (máy tính) hoặc 'm' (điện thoại). Kiểm tra khớp thiết bị. */
export function appOf(req) {
  const app = req.headers['x-tc-app'];
  if (app !== 'pc' && app !== 'm') throw new HttpError(400, 'Yêu cầu không hợp lệ (thiếu X-TC-App)');
  const mobile = isMobileUA(req.headers['user-agent']);
  if (app === 'm' && !mobile) throw new HttpError(403, 'Ứng dụng điện thoại chỉ dùng được trên điện thoại. Trên máy tính hãy mở trang chủ.', { wrongDevice: true });
  if (app === 'pc' && mobile) throw new HttpError(403, 'Trang máy tính không dùng được trên điện thoại. Hãy cài ứng dụng điện thoại tại /m/', { wrongDevice: true });
  return app;
}
export const platformAllows = (platform, app) => platform === 'ca_hai' || (platform === 'pc' && app === 'pc') || (platform === 'mobile' && app === 'm');

const cookieName = app => 'tc_' + app;
export function setSessionCookie(res, app, acc) {
  const maxAge = app === 'm' ? 30 * 86400 : 12 * 3600;  // điện thoại giữ đăng nhập 30 ngày, máy tính 12 giờ
  const t = signSession({ e: acc.email, a: app, exp: Date.now() + maxAge * 1000 });
  res.setHeader('Set-Cookie', `${cookieName(app)}=${t}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`);
}
export function clearSessionCookie(res, app) {
  res.setHeader('Set-Cookie', `${cookieName(app)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

/** Bắt buộc đăng nhập. Mỗi lần gọi đều kiểm tra lại tài khoản (còn kích hoạt, vai trò, nền tảng hiện tại). */
export async function requireUser(req, need = 'xem') {
  const app = appOf(req);
  const p = verifySession(readCookie(req, cookieName(app)));
  if (!p || p.a !== app) throw new HttpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn');
  const acc = (await readAccounts()).find(a => a.email === p.e);
  if (!acc || !acc.active) throw new HttpError(401, 'Tài khoản không tồn tại hoặc đã bị khoá');
  if (!platformAllows(acc.platform, app)) throw new HttpError(403, 'Tài khoản không được phép dùng trên nền tảng này');
  if (!can(acc, need)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
  return { ...acc, app };
}

/** Chức năng Sản phẩm/BOM/Lệnh SX từ BOM: chỉ trên máy tính; perm (tuỳ chọn) là quyền chức năng cần có. */
export async function requirePC(req, perm) {
  const u = await requireUser(req);
  if (u.app !== 'pc') throw new HttpError(403, 'Chức năng Sản phẩm / BOM / Tạo lệnh sản xuất chỉ dùng trên máy tính');
  if (perm && !hasPerm(u, perm)) throw new HttpError(403, 'Tài khoản chưa được cấp quyền: ' + PERMS[perm]);
  return u;
}

/* ---------------- Nhật ký ---------------- */
export async function log(user, action, target, detail) {
  try {
    await ensureSheets();
    await append(S.nk, [[nowVN(), user ? user.email : '', user ? user.app || '' : '', action, target || '',
      typeof detail === 'string' ? detail : JSON.stringify(detail || '')]]);
  } catch (e) { console.error('log fail', e); }
}
