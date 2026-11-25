// GET /api/data – toàn bộ dữ liệu báo cáo (đọc qua service account, sheet không cần chia sẻ công khai).
import { handler } from './_lib/http.js';
import { batchGet, q } from './_lib/google.js';
import { S, requireUser, publicUser, ensureSheets } from './_lib/store.js';
import { FIELDS } from './_lib/lsx.js';

const KEYS = ['lsx', 'psx', 'ct', 'gsl', 'cd', 'nd', 'yc'];
let cache = { at: 0, v: null };

export default handler(async (req) => {
  const u = await requireUser(req);
  // Lưu đệm 15 giây để tránh vượt hạn mức đọc của Google (60 lượt/phút/tài khoản dịch vụ).
  if (!cache.v || Date.now() - cache.at > 15_000 || req.query.fresh === '1') {
    await ensureSheets();
    const vals = await batchGet(KEYS.map(k => q(S[k])));
    const v = {}; KEYS.forEach((k, i) => { v[k] = vals[i]; });
    cache = { at: Date.now(), v };
  }
  const fields = Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, { key: d.key, ten: d.ten, fields: d.fields }]));
  return { ok: true, at: cache.at, user: publicUser(u), data: cache.v, fields };
});
