// /api/accounts – quản lý tài khoản & xem nhật ký (chỉ quản trị, chỉ trên máy tính).
//   GET                    danh sách tài khoản + danh sách Nguoi_Dung (gợi ý)
//   GET ?a=log             200 dòng nhật ký gần nhất
//   POST {a:'save', email, name, role, platform, active, password?}
import { handler, body, needMethod, HttpError, nowVN } from './_lib/http.js';
import { batchGet, q } from './_lib/google.js';
import {
  S, requireUser, readAccounts, saveAccount, hashPw, validPw, publicUser, toObjects, log, ROLES, PLATFORMS
} from './_lib/store.js';

export default handler(async (req) => {
  const u = await requireUser(req, 'admin');
  if (u.app !== 'pc') throw new HttpError(403, 'Quản lý tài khoản chỉ thực hiện trên máy tính');

  if (req.method === 'GET') {
    if (req.query.a === 'log') {
      const [v] = await batchGet([q(S.nk)]);
      return { ok: true, list: toObjects(v).reverse().slice(0, 300).map(({ _r, ...x }) => x) };
    }
    const [nd] = await batchGet([q(S.nd)]);
    return {
      ok: true, roles: ROLES, platforms: PLATFORMS,
      list: (await readAccounts(true)).map(publicUser),
      nguoiDung: toObjects(nd).map(o => ({ email: String(o.Ma_NV || '').trim(), name: o.Ho_Ten }))
    };
  }

  needMethod(req, 'POST');
  const b = body(req);
  if (b.a !== 'save') throw new HttpError(400, 'Thao tác không hợp lệ');

  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (!ROLES[b.role]) throw new HttpError(400, 'Vai trò không hợp lệ');
  if (!PLATFORMS[b.platform]) throw new HttpError(400, 'Nền tảng không hợp lệ');

  const list = await readAccounts(true);
  const old = list.find(a => a.email === email);
  const active = b.active !== false;
  if (!old) validPw(b.password);
  else if (b.password) validPw(b.password);

  // Không cho phép làm mất quản trị viên cuối cùng
  const adminsAfter = list.filter(a => a.role === 'admin' && a.active && a.email !== email).length + (b.role === 'admin' && active ? 1 : 0);
  if (!adminsAfter) throw new HttpError(400, 'Phải còn ít nhất 1 quản trị viên đang hoạt động');
  if (email === u.email && (!active || b.role !== 'admin' || b.platform === 'mobile'))
    throw new HttpError(400, 'Không thể tự khoá, tự hạ quyền hoặc tự chặn truy cập máy tính của chính mình');

  const acc = {
    ...(old || {}), email, name: String(b.name || '').trim() || email, role: b.role, platform: b.platform, active,
    hash: b.password ? hashPw(b.password) : old.hash, created: old?.created || nowVN(), note: String(b.note || old?.note || '').slice(0, 200)
  };
  await saveAccount(acc);
  await log(u, old ? 'SUA_TAI_KHOAN' : 'TAO_TAI_KHOAN', email,
    { role: acc.role, platform: acc.platform, active, doiMatKhau: !!b.password });
  return { ok: true, user: publicUser(acc) };
});
