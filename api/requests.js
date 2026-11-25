// /api/requests – đề xuất & duyệt sửa/xoá lệnh sản xuất (xác nhận 2 bước).
//   GET                         danh sách yêu cầu
//   POST {a:'create', ...}      người đề xuất tạo yêu cầu (vai trò >= de_xuat)
//   POST {a:'cancel', id}       người đề xuất (hoặc admin) huỷ yêu cầu đang chờ
//   POST {a:'approve', id, confirm, note}   người duyệt (khác người đề xuất) xác nhận → thực thi
//   POST {a:'reject', id, note} người duyệt từ chối
//   POST {a:'restore', id}      admin khôi phục dữ liệu của yêu cầu xoá đã duyệt
import crypto from 'node:crypto';
import { handler, body, needMethod, HttpError, nowVN, sleep } from './_lib/http.js';
import { batchGet, updateValues, append, q } from './_lib/google.js';
import { S, requireUser, ensureSheets, toObjects, can, log, norm } from './_lib/store.js';
import { deletePlan, execDelete, prepareEdit, execEdit, execRestore, newId, FIELDS } from './_lib/lsx.js';

const LOAI = { SUA: 'Sửa lệnh', XOA_LSX: 'Xoá lệnh', XOA_PSX: 'Xoá phiếu' };
const LOCK_MS = 120_000;

async function readRequests() {
  await ensureSheets();
  const [v] = await batchGet([q(S.yc)]);
  return toObjects(v).map(o => {
    let nd = {}; try { nd = JSON.parse(o.Noi_Dung || '{}'); } catch { /* bỏ qua */ }
    let st = o.Trang_Thai;
    // Khoá xử lý bị treo quá 2 phút (vd. máy chủ lỗi giữa chừng) → coi như vẫn chờ duyệt
    const lock = String(o.Ghi_Chu_Duyet || '').match(/^LOCK:(\d+):/);
    if (st === 'DANG_XU_LY' && lock && Date.now() - +lock[1] > LOCK_MS) st = 'CHO_DUYET';
    return {
      _r: o._r, id: o.ID, loai: o.Loai, loaiTen: LOAI[o.Loai] || o.Loai, doiTuong: o.Doi_Tuong, soLSX: o.So_LSX,
      tomTat: o.Tom_Tat, noiDung: nd, lyDo: o.Ly_Do, nguoiDeXuat: o.Nguoi_De_Xuat, tgDeXuat: o.Thoi_Gian_De_Xuat,
      trangThai: st, nguoiDuyet: st === 'CHO_DUYET' ? '' : o.Nguoi_Duyet, tgDuyet: st === 'CHO_DUYET' ? '' : o.Thoi_Gian_Duyet,
      ghiChuDuyet: /^LOCK:/.test(o.Ghi_Chu_Duyet || '') ? '' : o.Ghi_Chu_Duyet
    };
  }).filter(r => r.id);
}

const setStatus = (r, st, who, note) =>
  updateValues(q(S.yc) + `!J${r}:M${r}`, [[st, who || '', who ? nowVN() : '', note || '']]);

/** Giành quyền xử lý 1 yêu cầu: ghi khoá, chờ, đọc lại – tránh 2 người duyệt cùng lúc thực thi 2 lần. */
async function claim(r, who) {
  const tag = 'LOCK:' + Date.now() + ':' + crypto.randomBytes(6).toString('hex');
  await updateValues(q(S.yc) + `!J${r}:M${r}`, [['DANG_XU_LY', who, nowVN(), tag]]);
  await sleep(1500);
  const [v] = await batchGet([q(S.yc) + `!J${r}:M${r}`]);
  if (!v[0] || v[0][3] !== tag) throw new HttpError(409, 'Yêu cầu đang được người khác xử lý');
}

function summaryEdit(changes) {
  return changes.map(c => `${c.k} · ${FIELDS[c.s].fields[c.f][1]}: "${c.o}" → "${c.n}"`).join('; ');
}

export default handler(async (req) => {
  if (req.method === 'GET') {
    const u = await requireUser(req);
    const list = (await readRequests()).reverse().slice(0, 500).map(({ _r, ...x }) => x);
    return { ok: true, list, me: u.email };
  }
  needMethod(req, 'POST');
  const b = body(req);

  /* ---------- 1. Đề xuất ---------- */
  if (b.a === 'create') {
    const u = await requireUser(req, 'de_xuat');
    const lyDo = String(b.ly_do || '').trim().slice(0, 1000);
    const pending = await readRequests();
    let row;

    if (b.loai === 'SUA') {
      const soLSX = String(b.so_lsx || '').trim();
      const changes = await prepareEdit(soLSX, b.changes);
      row = { loai: 'SUA', doiTuong: soLSX, soLSX, tomTat: `${changes.length} thay đổi: ` + summaryEdit(changes).slice(0, 400), noiDung: { changes } };
    } else if (b.loai === 'XOA_LSX' || b.loai === 'XOA_PSX') {
      if (lyDo.length < 5) throw new HttpError(400, 'Vui lòng ghi rõ lý do xoá (ít nhất 5 ký tự)');
      const kind = b.loai === 'XOA_LSX' ? 'LSX' : 'PSX';
      const key = String(b.key || '').trim();
      const P = await deletePlan(kind, key);
      const withOutput = !!b.xoa_san_luong;
      if (P.count.gsl && !withOutput)
        throw new HttpError(409, `${kind === 'LSX' ? 'Lệnh' : 'Phiếu'} ${key} đã có ${P.count.gsl} lượt ghi sản lượng (${P.count.slTong} chi tiết). ` +
          'Hãy chọn "Xoá cả sản lượng đã ghi", hoặc đề xuất sửa trạng thái thành "Huỷ" thay vì xoá.', { count: P.count });
      const c = P.count;
      row = {
        loai: b.loai, doiTuong: key, soLSX: P.soLSX, noiDung: { count: c, xoaSanLuong: withOutput },
        tomTat: (kind === 'LSX' ? `Xoá lệnh ${key}: ` : `Xoá phiếu ${key}: `) +
          `${c.psx} phiếu, ${c.ct} dòng chi tiết` + (withOutput ? `, ${c.gsl} lượt ghi sản lượng` : '')
      };
    } else throw new HttpError(400, 'Loại yêu cầu không hợp lệ');

    if (pending.some(p => p.trangThai === 'CHO_DUYET' && p.loai === row.loai && norm(p.doiTuong) === norm(row.doiTuong) && p.loai !== 'SUA'))
      throw new HttpError(409, 'Đã có yêu cầu xoá đang chờ duyệt cho ' + row.doiTuong);

    const id = newId();
    // Cho phép sửa không cần duyệt nếu cấu hình SUA_CAN_DUYET=0 (mặc định: cần duyệt)
    const autoApply = row.loai === 'SUA' && process.env.SUA_CAN_DUYET === '0';
    await append(S.yc, [[id, row.loai, row.doiTuong, row.soLSX, row.tomTat, JSON.stringify(row.noiDung), lyDo, u.email, nowVN(),
      autoApply ? 'DANG_XU_LY' : 'CHO_DUYET', '', '', '']]);
    await log(u, 'DE_XUAT_' + row.loai, row.doiTuong, { id, tomTat: row.tomTat, lyDo });
    if (autoApply) {
      const r = (await readRequests()).find(x => x.id === id)._r;
      try { await execEdit(row.noiDung.changes); }
      catch (e) { await setStatus(r, 'TU_CHOI', u.email, 'Lỗi khi áp dụng: ' + e.message); throw e; }
      await setStatus(r, 'DA_DUYET', u.email, 'Tự động áp dụng (SUA_CAN_DUYET=0)');
      return { ok: true, id, applied: true };
    }
    return { ok: true, id, tomTat: row.tomTat };
  }

  /* ---------- Các thao tác trên yêu cầu có sẵn ---------- */
  await requireUser(req, 'de_xuat');
  const list = await readRequests();
  const r = list.find(x => x.id === b.id);
  if (!r) throw new HttpError(404, 'Không tìm thấy yêu cầu ' + b.id);
  const note = String(b.note || '').trim().slice(0, 500);

  if (b.a === 'cancel') {
    const u = await requireUser(req, 'de_xuat');
    if (r.nguoiDeXuat !== u.email && u.role !== 'admin') throw new HttpError(403, 'Chỉ người đề xuất hoặc quản trị mới huỷ được yêu cầu');
    if (r.trangThai !== 'CHO_DUYET') throw new HttpError(409, 'Yêu cầu không còn ở trạng thái chờ duyệt');
    await setStatus(r._r, 'DA_HUY', u.email, note || 'Người đề xuất huỷ');
    await log(u, 'HUY_YEU_CAU', r.id, r.tomTat);
    return { ok: true };
  }

  if (b.a === 'reject' || b.a === 'approve') {
    const u = await requireUser(req, 'duyet');
    if (r.trangThai !== 'CHO_DUYET') throw new HttpError(409, 'Yêu cầu không còn ở trạng thái chờ duyệt');
    if (r.nguoiDeXuat === u.email) throw new HttpError(403, 'Người đề xuất không được tự duyệt/từ chối yêu cầu của mình – cần tài khoản duyệt khác');

    if (b.a === 'reject') {
      if (!note) throw new HttpError(400, 'Vui lòng ghi lý do từ chối');
      await setStatus(r._r, 'TU_CHOI', u.email, note);
      await log(u, 'TU_CHOI', r.id, { tomTat: r.tomTat, note });
      return { ok: true };
    }

    // Bước 2: xác nhận xoá bằng cách gõ lại đúng mã lệnh/phiếu
    if (r.loai !== 'SUA' && norm(b.confirm) !== norm(r.doiTuong))
      throw new HttpError(400, `Để xác nhận xoá, hãy gõ chính xác mã "${r.doiTuong}"`);

    await claim(r._r, u.email);
    let result;
    try {
      if (r.loai === 'SUA') result = await execEdit(r.noiDung.changes || []);
      else result = await execDelete(r.id, r.loai === 'XOA_LSX' ? 'LSX' : 'PSX', r.doiTuong, !!r.noiDung.xoaSanLuong);
    } catch (e) {
      await setStatus(r._r, 'CHO_DUYET', '', 'Lần duyệt trước lỗi: ' + e.message.slice(0, 300));
      throw e;
    }
    await setStatus(r._r, 'DA_DUYET', u.email, note);
    await log(u, 'DUYET_' + r.loai, r.doiTuong, { id: r.id, result, note });
    return { ok: true, result };
  }

  if (b.a === 'restore') {
    const u = await requireUser(req, 'admin');
    if (!/^XOA_/.test(r.loai) || r.trangThai !== 'DA_DUYET') throw new HttpError(409, 'Chỉ khôi phục được yêu cầu xoá đã thực hiện');
    const result = await execRestore(r.id);
    // Giữ nguyên người duyệt gốc, chỉ đổi trạng thái và thêm ghi chú
    await updateValues(q(S.yc) + `!J${r._r}:M${r._r}`, [['DA_KHOI_PHUC', r.nguoiDuyet, r.tgDuyet,
      (r.ghiChuDuyet ? r.ghiChuDuyet + ' | ' : '') + 'Khôi phục bởi ' + u.email + ' lúc ' + nowVN()]]);
    await log(u, 'KHOI_PHUC', r.doiTuong, { id: r.id, result });
    return { ok: true, result };
  }

  throw new HttpError(400, 'Thao tác không hợp lệ');
});
