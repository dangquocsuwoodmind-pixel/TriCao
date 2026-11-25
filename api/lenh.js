// /api/lenh – Tạo lệnh sản xuất + phiếu sản xuất từ BOM (chỉ trên máy tính).
//   GET                                   danh sách đề xuất lệnh, số lệnh gợi ý, BOM hiện hành để chọn
//   POST {a:'preview', header, items}     xem trước phiếu sẽ tạo (quyền lsx_tao)
//   POST {a:'create', header, items}      xác nhận → gửi đề xuất chờ phê duyệt (quyền lsx_tao)
//   POST {a:'view', id}                   xem lại đề xuất (tính lại từ BOM, báo nếu BOM đã đổi)
//   POST {a:'approve', id, note}          phê duyệt → ghi LSX + Phieu_San_Xuat + Chi_Tiet_PSX + LSX_BOM (quyền lsx_duyet, khác người tạo)
//   POST {a:'reject', id, note}           từ chối (quyền lsx_duyet)
//   POST {a:'cancel', id}                 người tạo / quản trị huỷ đề xuất đang chờ
// items: [{ma: Ma_BOM, sl: số bộ sản phẩm}]
import { handler, body, needMethod, HttpError, nowVN } from './_lib/http.js';
import { requirePC, hasPerm, log, norm, S } from './_lib/store.js';
import { append } from './_lib/google.js';
import {
  loadDB, cleanHeader, cleanItems, buildPlan, suggestSoLSX, assertSoLSXFree, writeLSX,
  setDraftStatus, claimDraft, newDraftId, TT_DE, todayVN
} from './_lib/bom.js';

const pubDraft = d => ({ ...d, _r: undefined, ttTen: TT_DE[d.tt] || d.tt });
const hashesOf = d => Object.fromEntries((d.noiDung.items || []).map(it => [norm(it.ma), it.hash]));

export default handler(async (req) => {
  if (req.method === 'GET') {
    const u = await requirePC(req);
    const DB = await loadDB();
    const choices = DB.products.filter(p => !/NGỪNG/i.test(p.trangThai)).map(p => {
      const v = DB.currentOf(p.maSP);
      return v ? { maSP: p.maSP, tenSP: p.tenSP, quyCach: p.quyCach, ma: v.ma, pb: v.pb, soCT: v.soCT } : null;
    }).filter(Boolean);
    return {
      ok: true, me: u.email, today: todayVN(), suggest: suggestSoLSX(DB), choices,
      list: DB.drafts.slice().reverse().slice(0, 300).map(pubDraft)
    };
  }

  needMethod(req, 'POST');
  const b = body(req);

  if (b.a === 'preview' || b.a === 'create') {
    const u = await requirePC(req, 'lsx_tao');
    const header = cleanHeader(b.header);
    const items = cleanItems(b.items);
    const DB = await loadDB();
    const plan = buildPlan(DB, header, items, 'create');
    try { assertSoLSXFree(DB, header.soLSX); } catch (e) { plan.errors.unshift(e.message); }
    if (b.a === 'preview') return { ok: true, plan };
    if (plan.errors.length) throw new HttpError(400, 'Chưa thể gửi đề xuất:\n- ' + plan.errors.join('\n- '), { plan });
    const id = newDraftId();
    const t = plan.totals;
    const tomTat = `${t.sp} sản phẩm, ${t.psx} phiếu, ${t.dong} dòng chi tiết, ${t.chiTiet} chi tiết: ` +
      plan.items.map(i => `${i.maSP}×${i.sl}`).join(', ');
    const noiDung = { header, items: plan.items.map(i => ({ maSP: i.maSP, ma: i.ma, sl: i.sl, hash: i.hash })) };
    await append(S.de, [[id, header.soLSX, header.tenLSX, tomTat.slice(0, 500), JSON.stringify(noiDung), u.email, nowVN(), 'CHO_DUYET', '', '', '']]);
    await log(u, 'DE_XUAT_LSX_BOM', header.soLSX, { id, tomTat });
    return { ok: true, id, tomTat };
  }

  const u = await requirePC(req);
  const DB = await loadDB();
  const d = DB.drafts.find(x => x.id === b.id);
  if (!d) throw new HttpError(404, 'Không tìm thấy đề xuất ' + b.id);
  const note = String(b.note || '').trim().slice(0, 500);
  const items = (d.noiDung.items || []).map(i => ({ ma: i.ma, sl: i.sl }));
  const header = d.noiDung.header || {};

  if (b.a === 'view') {
    const plan = buildPlan(DB, header, items, 'approve', hashesOf(d));
    if (d.tt === 'CHO_DUYET') { try { assertSoLSXFree(DB, header.soLSX, d.id); } catch (e) { plan.errors.unshift(e.message); } }
    return { ok: true, draft: pubDraft(d), plan };
  }

  if (b.a === 'cancel') {
    if (d.nguoiTao !== u.email && u.role !== 'admin') throw new HttpError(403, 'Chỉ người tạo hoặc quản trị mới huỷ được');
    if (d.tt !== 'CHO_DUYET') throw new HttpError(409, 'Đề xuất không còn ở trạng thái chờ duyệt');
    await setDraftStatus(d._r, 'DA_HUY', u.email, note || 'Người tạo huỷ');
    await log(u, 'HUY_DE_XUAT_LSX', d.soLSX, { id: d.id });
    return { ok: true };
  }

  if (b.a === 'approve' || b.a === 'reject') {
    if (!hasPerm(u, 'lsx_duyet')) throw new HttpError(403, 'Tài khoản chưa được cấp quyền phê duyệt lệnh SX từ BOM');
    if (d.tt !== 'CHO_DUYET') throw new HttpError(409, 'Đề xuất không còn ở trạng thái chờ duyệt');
    if (d.nguoiTao === u.email) throw new HttpError(403, 'Người tạo lệnh không được tự phê duyệt – cần tài khoản duyệt khác');
    if (b.a === 'reject') {
      if (!note) throw new HttpError(400, 'Vui lòng ghi lý do từ chối');
      await setDraftStatus(d._r, 'TU_CHOI', u.email, note);
      await log(u, 'TU_CHOI_LSX_BOM', d.soLSX, { id: d.id, note });
      return { ok: true };
    }
    await claimDraft(d._r, u.email);
    let result;
    try {
      const DB2 = await loadDB();               // đọc lại sau khi giữ khoá
      const plan = buildPlan(DB2, header, items, 'approve', hashesOf(d));
      assertSoLSXFree(DB2, header.soLSX, d.id);
      if (plan.errors.length) throw new HttpError(409, 'Không thể phê duyệt:\n- ' + plan.errors.join('\n- '));
      result = await writeLSX(plan, d.id);
    } catch (e) {
      await setDraftStatus(d._r, 'CHO_DUYET', '', 'Lần duyệt trước lỗi: ' + String(e.message).slice(0, 300));
      throw e;
    }
    await setDraftStatus(d._r, 'DA_DUYET', u.email, note);
    await log(u, 'DUYET_LSX_BOM', d.soLSX, { id: d.id, result, note });
    return { ok: true, result };
  }

  throw new HttpError(400, 'Thao tác không hợp lệ');
});
