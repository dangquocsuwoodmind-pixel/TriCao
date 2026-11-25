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

## Sản phẩm, BOM & tạo lệnh sản xuất từ BOM (chỉ máy tính)

Hai tab mới trên trang máy tính: **Sản phẩm & BOM** và **Tạo lệnh SX từ BOM**. API `/api/bom`, `/api/lenh` từ chối mọi lời gọi từ ứng dụng điện thoại.

### Quyền chức năng (gán từng tài khoản ở tab Tài khoản, quản trị có tất cả)

| Quyền | Cho phép |
|---|---|
| `bom_up` | Upload BOM Excel, tạo sản phẩm |
| `bom_sua` | Sửa BOM, sửa thông tin sản phẩm |
| `bom_duyet` | Duyệt / từ chối BOM |
| `lsx_tao` | Tạo lệnh SX từ BOM (xem trước → gửi duyệt) |
| `lsx_duyet` | Phê duyệt / từ chối lệnh SX từ BOM |

Người upload/sửa BOM và người tạo lệnh **không được tự duyệt**. Quyền lưu ở cột `Quyen` của `_Tai_Khoan` (tự thêm khi chạy lần đầu).

### BOM

1. **Upload**: chọn file `.xlsx` có sheet `QUY TRINH SAN XUAT` (mẫu BOM_V04xx). File được đọc ngay trên trình duyệt; cột được nhận theo tiêu đề
   (Mã SP, Mã cụm, Mã phụ kiện, Tên chi tiết, Qui cách thành phẩm Dài/Rộng/dày/SLCT, Vật liệu, các cột công đoạn + ghi chú).
   Ô công đoạn ghi số thứ tự; `1-3` = làm ở bước 1 và 3 (kể cả khi Excel tự đổi thành ngày). Dòng có Mã phụ kiện là chi tiết, dòng chỉ có Mã cụm là tiêu đề cụm.
2. Mỗi lần upload tạo **phiên bản** `MãSP-PBnn` ở trạng thái **Chờ duyệt**. Khi duyệt, bản đó thành **hiện hành**, bản đã duyệt trước chuyển "Đã thay thế".
3. **Sửa**: chỉ sửa phiên bản mới nhất. Nếu phiên bản đã nằm trong lệnh sản xuất (đã tạo hoặc đang chờ duyệt) → hệ thống **tự sao chép thành phiên bản cao hơn** rồi sửa trên bản mới;
   nếu chưa dùng → sửa tại chỗ. Cả hai trường hợp đều quay về **Chờ duyệt**.

### Lệnh sản xuất từ BOM

1. Nhập số LSX (gợi ý `MOyymmNN-HT`), tên, ngày cấp, người cấp, hạn; chọn sản phẩm (BOM hiện hành) + số bộ → **Xem trước**.
2. Phiếu gộp các chi tiết cùng **tên + vật liệu + độ dày + quy trình công đoạn**; mỗi sản phẩm là 1 dòng (`Nhãn = MãSP - Tên chi tiết`, `Tổng SL = SLCT × số bộ`).
   Vật liệu phiếu = `VẬT LIỆU <dày>mm`; công đoạn lặp được đánh số (`CẮT VÁN 2`); tối đa 11 công đoạn (CD1–CD11).
3. **Xác nhận & gửi duyệt** → lưu ở `_LSX_De_Xuat`. Người có quyền `lsx_duyet` (khác người tạo) xem lại bản tính lại từ BOM và **phê duyệt** →
   ghi `LSX`, `Phieu_San_Xuat`, `Chi_Tiet_PSX`, `LSX_BOM` trong **một lần ghi nguyên tử**. Nếu BOM bị đổi sau khi đề xuất (so dấu vân tay nội dung) thì không cho duyệt.

| Sheet mới | Nội dung |
|---|---|
| `San_Pham` | Mã, tên, quy cách, trạng thái sản phẩm |
| `BOM_Phien_Ban` | Phiên bản BOM, trạng thái, người gửi/duyệt, dấu vân tay nội dung |
| `BOM_Chi_Tiet` | Dòng BOM của từng phiên bản (quy trình dạng `A > B > C`) |
| `_LSX_De_Xuat` | Đề xuất lệnh chờ phê duyệt |
| `LSX_BOM` | Lệnh nào dùng phiên bản BOM nào (để khoá sửa) |

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
  _lib/bom.js      Sản phẩm, phiên bản BOM, gộp phiếu, ghi lệnh từ BOM
  auth.js data.js requests.js accounts.js bom.js lenh.js
public/
  index.html pc.js     Trang máy tính
  bom.js xlsx-lite.js  Tab Sản phẩm & BOM, Tạo lệnh SX từ BOM; đọc file Excel trên trình duyệt
  m/                   Ứng dụng điện thoại (PWA: manifest, service worker, icon)
  shared/core.js       Hàm dùng chung, tính tiến độ
```

## Giới hạn cần biết

- Google Sheets API: **60 lượt đọc/phút** cho mỗi service account. API có lưu đệm 15 giây và tự thử lại khi vượt; nếu nhiều người dùng cùng lúc, có thể xin tăng hạn mức trong Google Cloud Console (APIs & Services → Google Sheets API → Quotas).
- Tách thiết bị dựa trên User-Agent: người cố tình giả User-Agent vẫn chỉ dùng được đúng quyền của tài khoản mình.
