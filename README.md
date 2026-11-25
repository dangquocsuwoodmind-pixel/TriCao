# Trí Cao – Quản lý lệnh sản xuất

Web quản lý lệnh sản xuất Trí Cao, đọc/ghi trực tiếp Google Sheet **TriCaoMasterData** qua Google Sheets API (service account).
Một project Vercel phục vụ 2 giao diện tách biệt:

| Đường dẫn | Dành cho | Ghi chú |
|---|---|---|
| `/` | Máy tính | Báo cáo đầy đủ, sửa/xoá, duyệt, quản lý tài khoản, nhật ký |
| `/m/` | Điện thoại | Ứng dụng PWA – cài lên màn hình chính, xem lệnh/phiếu/sản lượng, đề xuất & duyệt |

## Tách máy tính / điện thoại

1. **Vercel redirect theo User-Agent** (`vercel.json`): điện thoại mở `/` bị chuyển sang `/m/`, máy tính mở `/m/` bị chuyển về `/`.
2. **Phiên đăng nhập gắn nền tảng**: cookie riêng `tc_pc` / `tc_m`, API kiểm tra header `X-TC-App` khớp thiết bị.
3. **Quyền nền tảng theo tài khoản**: `pc` (chỉ máy tính), `mobile` (chỉ điện thoại), `ca_hai`.
4. Quản lý tài khoản và nhật ký chỉ làm được trên máy tính.

## Phân quyền & xác nhận 2 bước

| Vai trò | Quyền |
|---|---|
| `xem` | Chỉ xem |
| `de_xuat` | + Tạo yêu cầu sửa / xoá, huỷ yêu cầu của mình |
| `duyet` | + Duyệt / từ chối yêu cầu **của người khác** |
| `admin` | + Quản lý tài khoản, xem nhật ký, khôi phục dữ liệu đã xoá |

Quy trình:
1. **Bước 1 – Người đề xuất** tạo yêu cầu (sửa: chỉ gửi các ô thay đổi kèm giá trị cũ; xoá: bắt buộc lý do).
2. **Bước 2 – Tài khoản duyệt khác** xác nhận. Người đề xuất **không thể tự duyệt** (kể cả admin). Xoá phải gõ lại đúng mã lệnh/phiếu.
3. Khi duyệt, hệ thống kiểm tra dữ liệu chưa bị ai sửa từ lúc đề xuất, kiểm tra lại đúng dòng trên sheet, rồi ghi **một lần nguyên tử** (batchUpdate).
4. Xoá lệnh = xoá dây chuyền: dòng LSX + các phiếu + chi tiết (+ lượt ghi sản lượng nếu chọn). Lệnh đã có sản lượng thì mặc định bị chặn – khuyến nghị đổi trạng thái thành "Huỷ".
5. Mọi dòng bị xoá được sao lưu vào `_Thung_Rac`; admin bấm **Khôi phục** để thêm lại.

Có thể cho phép sửa không cần duyệt bằng biến môi trường `SUA_CAN_DUYET=0` (xoá luôn cần duyệt).

## Sheet phụ (tự tạo, không đụng cấu trúc sheet gốc)

| Sheet | Nội dung |
|---|---|
| `_Tai_Khoan` (ẩn) | Tài khoản, vai trò, nền tảng, mật khẩu (băm scrypt) |
| `_Yeu_Cau` | Các yêu cầu sửa/xoá và kết quả duyệt |
| `_Thung_Rac` (ẩn) | Bản sao các dòng đã xoá |
| `_Nhat_Ky` | Nhật ký đăng nhập, đề xuất, duyệt, khôi phục, đổi tài khoản |

## Biến môi trường (Vercel → Settings → Environment Variables)

| Tên | Giá trị |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Nội dung file JSON service account (JSON thô hoặc base64). **Không commit file key vào git.** |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự để ký phiên đăng nhập |
| `SETUP_KEY` | Mã dùng 1 lần để tạo quản trị viên đầu tiên (có thể xoá sau khi khởi tạo) |
| `SHEET_ID` | (Tuỳ chọn) ID Google Sheet, mặc định TriCaoMasterData |
| `SUA_CAN_DUYET` | (Tuỳ chọn) `0` = sửa không cần duyệt |

Service account `vercel-sheets@woodmind-sheets.iam.gserviceaccount.com` phải được chia sẻ quyền **Người chỉnh sửa** trên file Google Sheet.
Sheet **không cần** chia sẻ công khai nữa (trang cũ đọc qua link công khai).

## Khởi tạo lần đầu

1. Mở trang máy tính → màn hình "Khởi tạo hệ thống" → nhập `SETUP_KEY`, họ tên, email, mật khẩu → thành quản trị viên.
2. Tab **Tài khoản** → thêm tài khoản cho từng người (nên dùng đúng email trong sheet `Nguoi_Dung`), chọn vai trò và nền tảng.
3. Cần ít nhất 2 người có quyền duyệt/quản trị để duyệt chéo được.

## Cài ứng dụng điện thoại

- **Android (Chrome)**: mở `https://<tên-miền>/m/` → menu ⋮ → *Cài đặt ứng dụng*, hoặc tab **Tôi** → *Cài ứng dụng*.
- **iPhone (Safari)**: mở `/m/` → nút Chia sẻ → *Thêm vào MH chính*.

## Cấu trúc

```
api/            Vercel Functions (Node, không phụ thuộc thư viện ngoài)
  _lib/google.js   Google Sheets API + JWT service account, tự thử lại khi vượt hạn mức
  _lib/store.js    Sheet phụ, tài khoản, phiên, phân quyền, nhật ký
  _lib/lsx.js      Sửa / xoá dây chuyền / khôi phục
  auth.js data.js requests.js accounts.js
public/
  index.html pc.js     Trang máy tính
  m/                   Ứng dụng điện thoại (PWA: manifest, service worker, icon)
  shared/core.js       Hàm dùng chung, tính tiến độ
```

## Giới hạn cần biết

- Google Sheets API: **60 lượt đọc/phút** cho mỗi service account. API có lưu đệm 15 giây và tự thử lại khi vượt; nếu nhiều người dùng cùng lúc, có thể xin tăng hạn mức trong Google Cloud Console (APIs & Services → Google Sheets API → Quotas).
- Tách thiết bị dựa trên User-Agent: người cố tình giả User-Agent vẫn chỉ dùng được đúng quyền của tài khoản mình.
