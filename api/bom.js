// /api/bom – Sản phẩm & phiên bản BOM (chỉ trên máy tính).
//   GET                          sản phẩm, phiên bản, nơi đang dùng, danh mục công đoạn
//   GET ?a=lines&ma=MA_BOM       các dòng của 1 phiên bản
//   POST {a:'upload', maSP, tenSP, quyCach, nguon, ghiChu, lines, dryRun}   (quyền bom_up)  → phiên bản mới, chờ duyệt
//   POST {a:'edit', ma, lines, ghiChu, dryRun}                              (quyền bom_sua) → sửa tại chỗ, hoặc
//        tự sao chép thành phiên bản cao hơn nếu phiên bản đã nằm trong lệnh sản xuất. Luôn quay về chờ duyệt.
//   POST {a:'approve'|'reject', ma, note}                                  (quyền bom_duyet, khác người gửi)
//   POST {a:'cancel', ma}                                                  người gửi / quản trị huỷ bản chờ duyệt / bị từ chối
//   POST {a:'product', maSP, tenSP, quyCach, ghiChu, trangThai}             (quyền bom_sua; tạo mới cần bom_up)
//   POST {a:'import', dryRun}            (quản trị) tổng hợp ngược sản phẩm/BOM/liên kết từ các lệnh đã có
// Biến thể (bienThe, vd. màu 6626/6628): mỗi biến thể có BOM hiện hành riêng, song song.
import { handler, body, needMethod, HttpError, nowVN } from './_lib/http.js';
import { requirePC, hasPerm, log, norm, PERMS } from './_lib/store.js';
import {
  loadDB, cleanLines, hashLines, writeNewVersion, overwriteVersion, updateVersions, saveProduct, maBOM, cleanBT,
  planImport, writeImport, BUOC_CHUAN, TT_BOM, MAX_CD
} from './_lib/bom.js';

const pubVersion = (DB, v) => ({ ...v, _r: undefined, ttTen: TT_BOM[v.tt] || v.tt, dungTrong: DB.usage[norm(v.ma)] || [] });
const fail = (errors, warnings) => new HttpError(400, 'BOM có lỗi:\n- ' + errors.slice(0, 25).join('\n- ') + (errors.length > 25 ? `\n… và ${errors.length - 25} lỗi khác` : ''), { errors, warnings });

export default handler(async (req) => {
  if (req.method === 'GET') {
    const u = await requirePC(req);
    const DB = await loadDB();
    if (req.query.a === 'lines') {
      const v = DB.vByMa[norm(req.query.ma)];
      if (!v) throw new HttpError(404, 'Không tìm thấy phiên bản ' + req.query.ma);
      return { ok: true, version: pubVersion(DB, v), lines: DB.linesOf(v.ma) };
    }
    const steps = [...new Set([...BUOC_CHUAN, ...Object.values(DB.idx)])];
    return {
      ok: true, me: u.email, perms: PERMS, maxCD: MAX_CD, steps, ttBom: TT_BOM,
      products: DB.products.map(p => ({ ...p, _r: undefined })),
      versions: DB.versions.map(v => pubVersion(DB, v))
    };
  }

  needMethod(req, 'POST');
  const b = body(req);
  const t = nowVN();

  /* ---------- Upload BOM (phiên bản mới) ---------- */
  if (b.a === 'upload') {
    const u = await requirePC(req, 'bom_up');
    const maSP = String(b.maSP || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._\-/]{0,39}$/.test(maSP)) throw new HttpError(400, 'Mã sản phẩm chỉ gồm chữ, số, dấu - . _ / (tối đa 40 ký tự)');
    const DB = await loadDB();
    const { lines, errors, warnings } = cleanLines(b.lines, DB.idx);
    const prod = DB.products.find(p => norm(p.maSP) === maSP);
    const bt = cleanBT(b.bienThe);
    const vers = DB.versionsOf(maSP);
    const pending = DB.versionsOf(maSP, bt).find(v => v.tt === 'CHO_DUYET');
    const pb = (vers.reduce((a, v) => Math.max(a, v.pb), 0)) + 1;
    if (pending) errors.unshift(`Sản phẩm ${maSP}${bt ? ' (biến thể ' + bt + ')' : ''} đang có phiên bản ${pending.ma} chờ duyệt – hãy duyệt/từ chối/huỷ hoặc sửa phiên bản đó`);
    const tenSP = String(b.tenSP || (prod && prod.tenSP) || '').trim().slice(0, 200);
    if (!tenSP) errors.unshift('Vui lòng nhập tên sản phẩm');
    const variants = [...new Set(vers.filter(v => v.tt !== 'DA_HUY').map(v => v.bt))];
    if (b.dryRun) return { ok: true, lines, errors, warnings, isNew: !prod, ma: maBOM(maSP, pb), pb, bt, variants, product: prod || null };
    if (errors.length) throw fail(errors, warnings);
    const ver = {
      ma: maBOM(maSP, pb), maSP, pb, bt, tt: 'CHO_DUYET', nguon: String(b.nguon || 'Upload Excel').slice(0, 200), tuPB: '',
      soCT: lines.filter(l => l.loai === 'CT').length, ghiChu: String(b.ghiChu || '').slice(0, 500),
      nguoiTao: u.email, tgTao: t, nguoiGui: u.email, tgGui: t, hash: hashLines(lines)
    };
    const product = prod || { maSP, tenSP, quyCach: String(b.quyCach || '').slice(0, 200), ghiChu: '', nguoiTao: u.email, ngayTao: t };
    await writeNewVersion(DB, { product, newProduct: !prod, ver, lines });
    await log(u, 'UPLOAD_BOM', ver.ma, { nguon: ver.nguon, soCT: ver.soCT, sanPhamMoi: !prod });
    return { ok: true, ma: ver.ma, warnings };
  }

  /* ---------- Sửa BOM ---------- */
  if (b.a === 'edit') {
    const u = await requirePC(req, 'bom_sua');
    const DB = await loadDB();
    const v = DB.vByMa[norm(b.ma)];
    if (!v) throw new HttpError(404, 'Không tìm thấy phiên bản ' + b.ma);
    if (v.tt === 'DA_HUY') throw new HttpError(409, 'Phiên bản đã huỷ');
    // Đổi tên biến thể = sao chép thành biến thể mới (vd. tạo màu mới từ BOM màu cũ)
    const newBT = b.bienThe == null ? v.bt : cleanBT(b.bienThe);
    const variantCopy = norm(newBT) !== norm(v.bt);
    const latest = DB.latestOf(v.maSP, v.bt);
    if (!variantCopy && (!latest || latest.ma !== v.ma))
      throw new HttpError(409, `Chỉ sửa được phiên bản mới nhất của biến thể (${latest ? latest.ma : '—'}); muốn dùng bản cũ hãy đổi tên biến thể để sao chép`);
    const { lines, errors, warnings } = cleanLines(b.lines, DB.idx);
    if (variantCopy && DB.versionsOf(v.maSP, newBT).some(x => x.tt === 'CHO_DUYET'))
      errors.unshift(`Biến thể ${newBT || '(mặc định)'} đang có phiên bản chờ duyệt`);
    if (variantCopy && DB.versionsOf(v.maSP, newBT).some(x => x.tt !== 'DA_HUY'))
      warnings.unshift(`Biến thể ${newBT || '(mặc định)'} đã có – bản mới sẽ thay thế bản hiện hành của biến thể đó khi được duyệt`);
    const used = variantCopy ? ['(sao chép sang biến thể mới)'] : (DB.usage[norm(v.ma)] || []);
    const h = hashLines(lines);
    const ghiChu = b.ghiChu == null ? v.ghiChu : String(b.ghiChu).slice(0, 500);
    // Không có gì đổi (bỏ qua ghi chú công đoạn thì so nội dung + ghi chú từng dòng)
    const sameContent = h === v.hash && JSON.stringify(lines.map(l => [l.maCum, l.maPK, l.maPL, l.ghiChu])) ===
      JSON.stringify(DB.linesOf(v.ma).map(l => [l.maCum, l.maPK, l.maPL, l.ghiChu]));
    if (sameContent && ghiChu === v.ghiChu && !variantCopy) errors.unshift('Nội dung BOM không thay đổi');
    const newPB = DB.versionsOf(v.maSP).reduce((a, x) => Math.max(a, x.pb), 0) + 1;
    const mode = used.length ? 'new' : 'inplace';
    if (b.dryRun) return { ok: true, mode, usedIn: used, newMa: mode === 'new' ? maBOM(v.maSP, newPB) : v.ma, lines, errors, warnings };
    if (errors.length) throw fail(errors, warnings);
    const soCT = lines.filter(l => l.loai === 'CT').length;
    if (mode === 'new') {
      const ver = {
        ma: maBOM(v.maSP, newPB), maSP: v.maSP, pb: newPB, bt: newBT, tt: 'CHO_DUYET', tuPB: v.ma, soCT, ghiChu,
        nguon: variantCopy ? `Sao chép từ ${v.ma} sang biến thể ${newBT || '(mặc định)'}` : 'Sao chép từ ' + v.ma + ' để sửa',
        nguoiTao: u.email, tgTao: t, nguoiGui: u.email, tgGui: t, hash: h
      };
      await writeNewVersion(DB, { product: null, newProduct: false, ver, lines });
      await log(u, 'SUA_BOM_PHIEN_BAN_MOI', ver.ma, { tu: v.ma, dungTrong: used, soCT });
      return { ok: true, ma: ver.ma, mode, usedIn: used, warnings };
    }
    const ver = { ...v, tt: 'CHO_DUYET', soCT, ghiChu, nguoiGui: u.email, tgGui: t, nguoiDuyet: '', tgDuyet: '', ghiChuDuyet: '', hash: h };
    await overwriteVersion(DB, ver, lines);
    await log(u, 'SUA_BOM', ver.ma, { trangThaiCu: v.tt, soCT });
    return { ok: true, ma: ver.ma, mode, warnings };
  }

  /* ---------- Duyệt / từ chối / huỷ ---------- */
  if (b.a === 'approve' || b.a === 'reject' || b.a === 'cancel') {
    const u = await requirePC(req, b.a === 'cancel' ? null : 'bom_duyet');
    const DB = await loadDB();
    const v = DB.vByMa[norm(b.ma)];
    if (!v) throw new HttpError(404, 'Không tìm thấy phiên bản ' + b.ma);
    const note = String(b.note || '').trim().slice(0, 500);

    if (b.a === 'cancel') {
      if (v.nguoiGui !== u.email && u.role !== 'admin') throw new HttpError(403, 'Chỉ người gửi hoặc quản trị mới huỷ được');
      if (!['CHO_DUYET', 'TU_CHOI'].includes(v.tt)) throw new HttpError(409, 'Chỉ huỷ được phiên bản đang chờ duyệt hoặc bị từ chối');
      if ((DB.usage[norm(v.ma)] || []).length) throw new HttpError(409, 'Phiên bản đang được dùng trong lệnh sản xuất');
      await updateVersions([{ ...v, tt: 'DA_HUY', nguoiDuyet: u.email, tgDuyet: t, ghiChuDuyet: note || 'Người gửi huỷ' }]);
      await log(u, 'HUY_BOM', v.ma, note);
      return { ok: true };
    }

    if (v.tt !== 'CHO_DUYET') throw new HttpError(409, 'Phiên bản không ở trạng thái chờ duyệt');
    if (v.nguoiGui === u.email) throw new HttpError(403, 'Người upload/sửa BOM không được tự duyệt – cần tài khoản duyệt khác');
    if (b.hash && b.hash !== v.hash) throw new HttpError(409, 'BOM vừa được sửa sau khi bạn mở – hãy tải lại và xem lại trước khi duyệt');
    if (b.a === 'reject') {
      if (!note) throw new HttpError(400, 'Vui lòng ghi lý do từ chối');
      await updateVersions([{ ...v, tt: 'TU_CHOI', nguoiDuyet: u.email, tgDuyet: t, ghiChuDuyet: note }]);
      await log(u, 'TU_CHOI_BOM', v.ma, note);
      return { ok: true };
    }
    if (hashLines(DB.linesOf(v.ma)) !== v.hash) throw new HttpError(409, 'Dữ liệu dòng BOM trên sheet không khớp với phiên bản – kiểm tra lại sheet BOM_Chi_Tiet');
    // Phiên bản mới được duyệt thành hiện hành; các bản đã duyệt cũ hơn chuyển sang "Đã thay thế"
    const older = DB.versionsOf(v.maSP, v.bt).filter(x => x.ma !== v.ma && x.tt === 'DA_DUYET' && x.pb < v.pb)
      .map(x => ({ ...x, tt: 'THAY_THE', ghiChuDuyet: (x.ghiChuDuyet ? x.ghiChuDuyet + ' | ' : '') + 'Thay thế bởi ' + v.ma + ' lúc ' + t }));
    await updateVersions([{ ...v, tt: 'DA_DUYET', nguoiDuyet: u.email, tgDuyet: t, ghiChuDuyet: note }, ...older]);
    await log(u, 'DUYET_BOM', v.ma, { note, thayThe: older.map(x => x.ma) });
    return { ok: true, thayThe: older.map(x => x.ma) };
  }

  /* ---------- Tổng hợp ngược từ các lệnh đã có (quản trị) ---------- */
  if (b.a === 'import') {
    const u = await requirePC(req);
    if (u.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị mới chạy được tổng hợp BOM từ lệnh cũ');
    const DB = await loadDB();
    const plan = await planImport(DB, u.email);
    const sum = {
      products: plan.products.map(p => p.maSP), skipped: plan.skipped, warnings: plan.warnings,
      versions: plan.versions.map(v => ({ ma: v.ma, maSP: v.maSP, bt: v.bt, tt: v.tt, soCT: v.soCT, lsx: v.lsx, thieuKT: v.thieuKT })),
      links: plan.links, totalLines: plan.versions.reduce((a, v) => a + v.lines.length, 0)
    };
    if (b.dryRun) return { ok: true, ...sum };
    if (!plan.links.length) throw new HttpError(409, 'Không có lệnh nào cần tổng hợp');
    await writeImport(plan);
    await log(u, 'TONG_HOP_BOM_TU_LENH', '', { sanPham: sum.products.length, phienBan: sum.versions.length, lienKet: sum.links.length });
    return { ok: true, ...sum };
  }

  /* ---------- Thông tin sản phẩm ---------- */
  if (b.a === 'product') {
    const u = await requirePC(req);
    const DB0 = await loadDB();
    const maSP = String(b.maSP || '').trim().toUpperCase();
    const old = DB0.products.find(p => norm(p.maSP) === maSP);
    const need = old ? 'bom_sua' : 'bom_up';
    if (!hasPerm(u, need)) throw new HttpError(403, 'Tài khoản chưa được cấp quyền: ' + PERMS[need]);
    if (!/^[A-Z0-9][A-Z0-9._\-/]{0,39}$/.test(maSP)) throw new HttpError(400, 'Mã sản phẩm không hợp lệ');
    const tenSP = String(b.tenSP || '').trim().slice(0, 200);
    if (!tenSP) throw new HttpError(400, 'Vui lòng nhập tên sản phẩm');
    const trangThai = b.trangThai === 'Ngừng' ? 'Ngừng' : 'Đang dùng';
    const p = { ...(old || { nguoiTao: u.email, ngayTao: t }), maSP, tenSP, quyCach: String(b.quyCach || '').slice(0, 200), ghiChu: String(b.ghiChu || '').slice(0, 500), trangThai };
    await saveProduct(p, !old);
    await log(u, old ? 'SUA_SAN_PHAM' : 'TAO_SAN_PHAM', maSP, { tenSP, quyCach: p.quyCach, trangThai });
    return { ok: true };
  }

  throw new HttpError(400, 'Thao tác không hợp lệ');
});
