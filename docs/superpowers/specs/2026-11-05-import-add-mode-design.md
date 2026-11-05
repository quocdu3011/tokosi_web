# Import thêm (mode=add) cho nhập Excel hàng hóa (E) — thiết kế

Ngày: 2026-11-05 · Phạm vi: `apps/api` (BE) + `apps/web` (FE). Người dùng cho phép sửa BE cho tính năng này.

## Yêu cầu gốc

Hai chế độ nhập Excel (file phải đúng định dạng mẫu):
- **Import đè:** cùng khóa (mã) thì thông tin trong file đè lên bản cũ; không có trong file thì không đổi.
- **Import thêm:** cùng khóa thì cộng thêm số lượng; thông tin khác giữ nguyên bản cũ.

## Quyết định đã chốt với người dùng

- Số lượng cộng thêm lấy từ cột **`Tồn kho`** của chi nhánh `branchId` (bắt buộc).
- **Giá vốn:** đọc cột `Giá vốn` trong file làm giá nhập của lô cộng thêm → giá vốn bình quân gia quyền của chi nhánh được tính lại; thiếu cột/ô trống thì giữ giá vốn hiện tại.
- **Số âm = trừ tồn** (vẫn không cho tồn xuống dưới 0 → lỗi dòng). Ô trống hoặc `0` = không đổi tồn. Khi trừ, `Giá vốn` trong file bị bỏ qua (xuất theo giá vốn bình quân hiện tại).

## Quyết định thiết kế (mình chọn)

- Tham số `mode=overwrite|add` (mặc định `overwrite` = hành vi cũ, không phá client cũ); `mode` lạ → `400`.
- Hàng đã có ở chế độ `add`: **chỉ đổi tồn**, mọi thông tin khác (tên, nhóm, mô tả, trạng thái, ảnh, thành phần, tồn tối thiểu/tối đa, vị trí) giữ nguyên. Mã mới: tạo đầy đủ (cần `Tên hàng`). Combo không có tồn riêng nên combo có `Tồn kho` là lỗi.
- Tồn đổi **chỉ qua `InventoryService.applyMovements`** (khóa dòng theo thứ tự cố định), cùng transaction với phần ghi còn lại; sổ cái loại `adjustment`, chứng từ gốc `IMP-XXXXXXXX` (`refId` = id lần nhập, sinh trước khi chạy). Thẻ kho hiện đúng nhãn "Điều chỉnh tồn".
- Kiểm tra trừ quá tồn **trước khi ghi** để báo lỗi theo từng dòng (`Không đủ tồn để trừ…`); vẫn "tất cả hoặc không gì cả", `dryRun` mặc định `true`.
- Lưu `mode` trong `import_jobs` (migration `0020_che_do_nhap_excel`, mặc định `overwrite` cho dữ liệu cũ) và trả trong `ImportJobDto`.
- Không idempotent: chạy lại cùng file cộng thêm lần nữa → FE cảnh báo rõ và dẫn người dùng qua "Kiểm tra file" trước. (Không thêm chống trùng theo băm file để tránh mở rộng lược đồ; có thể bổ sung sau nếu cần.)
- Chế độ `overwrite` vẫn bỏ qua `Tồn kho`/`Giá vốn`; file mẫu có thêm hai cột này.

## Kiểm thử

`apps/api/src/modules/imports/imports-add.http.spec.ts` (8 ca): dryRun, tạo mới + cộng tồn + sổ cái, bình quân gia quyền, chạy lại cộng tiếp, trừ tồn và trừ quá tồn, ô trống/0, lỗi cấu trúc theo giai đoạn, `mode` của chế độ đè/`GET /imports/:id`. **Kiểm tra ngược** đã làm: gỡ bước cộng tồn → 5 ca thất bại; gỡ kiểm tra trừ quá tồn → ca trừ tồn thất bại. PGlite chỉ một kết nối nên **không tái hiện được bế tắc**: phần khóa nhiều dòng cần thử trên PostgreSQL thật nhiều kết nối trước khi lên production.

## Ngoài phạm vi

Nhập khách hàng/nhà cung cấp (API chưa có), đặt tồn về một giá trị tuyệt đối (kiểm kê), chống nhập trùng theo băm file.
