// Kết nối Google Sheets API bằng service account (không cần thư viện ngoài).
import crypto from 'node:crypto';
import { HttpError } from './http.js';

export const SHEET_ID = process.env.SHEET_ID || '1FbqrHF-1mH2bcGf4zDJEKH4Eo--1OANcuGGiGM8jvz4';
const API = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID;

let sa = null;
let tok = { v: null, exp: 0 };

/** Đọc thông tin service account từ biến môi trường (JSON thô hoặc base64). */
function creds() {
  if (sa) return sa;
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new HttpError(500, 'Máy chủ chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  sa = JSON.parse(raw);
  return sa;
}

async function token() {
  if (tok.v && Date.now() < tok.exp - 60_000) return tok.v;
  const c = creds();
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const aud = c.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud, iat: now, exp: now + 3600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), c.private_key).toString('base64url');
  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await r.json();
  if (!j.access_token) throw new HttpError(502, 'Không lấy được token Google: ' + (j.error_description || j.error));
  tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tok.v;
}

async function call(path, opt = {}, attempt = 0) {
  const r = await fetch(API + path, {
    ...opt,
    headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' }
  });
  const j = await r.json().catch(() => ({}));
  // Hạn mức Google: 60 lượt đọc + 60 lượt ghi / phút / service account → tự chờ rồi thử lại (tối đa ~45 giây)
  if ((r.status === 429 || r.status === 503) && attempt < 4) {
    await new Promise(ok => setTimeout(ok, [3000, 6000, 12000, 24000][attempt] + Math.random() * 1000));
    return call(path, opt, attempt + 1);
  }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
    throw new HttpError(r.status === 429 ? 429 : 502, 'Google Sheets: ' + msg);
  }
  return j;
}

/** Tên sheet trong ký hiệu A1 */
export const q = name => "'" + String(name).replace(/'/g, "''") + "'";

/** Đọc nhiều vùng một lần (1 lượt gọi API). Trả về mảng values[][] tương ứng. */
export async function batchGet(ranges, render = 'FORMATTED_VALUE') {
  const qs = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const j = await call('/values:batchGet?' + qs + '&valueRenderOption=' + render);
  return j.valueRanges.map(v => v.values || []);
}

export function updateValues(range, values, input = 'RAW') {
  return call('/values/' + encodeURIComponent(range) + '?valueInputOption=' + input,
    { method: 'PUT', body: JSON.stringify({ values }) });
}

export function append(sheet, rows, input = 'RAW') {
  return call('/values/' + encodeURIComponent(q(sheet) + '!A1') + ':append?valueInputOption=' + input + '&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values: rows }) });
}

/** batchUpdate cấu trúc – toàn bộ requests được Google áp dụng nguyên tử (hoặc tất cả, hoặc không). */
export function batchUpdate(requests) {
  return call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
}

let metaCache = null;
/** { tenSheet: sheetId } */
export async function sheetMap(force = false) {
  if (metaCache && !force) return metaCache;
  const j = await call('?fields=sheets.properties(sheetId,title)');
  metaCache = {};
  j.sheets.forEach(s => { metaCache[s.properties.title] = s.properties.sheetId; });
  return metaCache;
}
