// /api/auth?a=me|login|logout|setup|password
import crypto from 'node:crypto';
import { handler, body, needMethod, HttpError, nowVN, sleep } from './_lib/http.js';
import {
  appOf, readAccounts, requireUser, saveAccount, checkPw, hashPw, validPw, platformAllows,
  setSessionCookie, clearSessionCookie, publicUser, log, ROLES, PLATFORMS
} from './_lib/store.js';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default handler(async (req, res) => {
  const a = req.query.a;

  if (a === 'me') {
    const app = appOf(req);
    try {
      const u = await requireUser(req);
      return { ok: true, user: publicUser(u), roles: ROLES, platforms: PLATFORMS };
    } catch (e) {
      if (e.status !== 401) throw e;
      const list = await readAccounts();
      return { ok: false, needSetup: !list.some(x => x.role === 'admin' && x.active), app };
    }
  }

  needMethod(req, 'POST');
  const b = body(req);

  if (a === 'login') {
    const app = appOf(req);
    const email = String(b.email || '').trim().toLowerCase();
    const acc = (await readAccounts(true)).find(x => x.email === email);
    if (!acc || !acc.active || !checkPw(b.password || '', acc.hash)) {
      await sleep(600);
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khoá');
    }
    if (!platformAllows(acc.platform, app))
      throw new HttpError(403, acc.platform === 'mobile'
        ? 'Tài khoản này chỉ được dùng trên ứng dụng điện thoại'
        : 'Tài khoản này chỉ được dùng trên máy tính');
    setSessionCookie(res, app, acc);
    await log({ ...acc, app }, 'DANG_NHAP', '', '');
    return { ok: true, user: publicUser(acc) };
  }

  if (a === 'logout') {
    const app = appOf(req);
    clearSessionCookie(res, app);
    return { ok: true };
  }

  if (a === 'setup') {
    // Tạo tài khoản quản trị đầu tiên – chỉ khi chưa có admin, cần SETUP_KEY.
    const app = appOf(req);
    const key = process.env.SETUP_KEY;
    if (!key) throw new HttpError(403, 'Máy chủ chưa cấu hình SETUP_KEY');
    const list = await readAccounts(true);
    if (list.some(x => x.role === 'admin' && x.active)) throw new HttpError(403, 'Đã có quản trị viên – không thể khởi tạo lại');
    if (!safeEq(b.key || '', key)) { await sleep(800); throw new HttpError(403, 'Mã khởi tạo không đúng'); }
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
    validPw(b.password);
    const old = list.find(x => x.email === email);
    const acc = { ...(old || {}), email, name: String(b.name || '').trim() || email, role: 'admin', platform: 'ca_hai', hash: hashPw(b.password), active: true, created: old?.created || nowVN(), note: 'Khởi tạo' };
    await saveAccount(acc);
    setSessionCookie(res, app, acc);
    await log({ ...acc, app }, 'KHOI_TAO_ADMIN', email, '');
    return { ok: true, user: publicUser(acc) };
  }

  if (a === 'password') {
    const u = await requireUser(req);
    if (!checkPw(b.old || '', u.hash)) { await sleep(600); throw new HttpError(400, 'Mật khẩu hiện tại không đúng'); }
    validPw(b.password);
    await saveAccount({ ...u, hash: hashPw(b.password) });
    await log(u, 'DOI_MAT_KHAU', u.email, '');
    return { ok: true };
  }

  throw new HttpError(404, 'Không có thao tác ' + a);
});
