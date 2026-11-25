export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

/** Bọc handler: bắt lỗi, trả JSON thống nhất, chặn cache. */
export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) res.status(status).json({ ok: false, error: e.message || 'Lỗi máy chủ', ...(e.extra || {}) });
    }
  };
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export function needMethod(req, ...m) {
  if (!m.includes(req.method)) throw new HttpError(405, 'Phương thức không hỗ trợ');
}

/** Thời gian giờ Việt Nam dạng dd/MM/yyyy HH:mm:ss */
export function nowVN() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
