# Yêu cầu BE: nhập Excel theo 2 chế độ (đè / thêm) và nguyên tắc không xóa

Từ: FE (`apps/web`). Liên quan: `docs/api/endpoints.md` mục 9, `POST /imports/:type`.
FE đã làm xong hộp thoại nhập (Kiểm tra file → Nhập dữ liệu). Chế độ "Import thêm" đang bị khóa ở FE vì API chưa hỗ trợ. Tài liệu này liệt kê việc BE cần làm để FE mở khóa.

## 1. Thêm tham số chế độ cho `POST /imports/:type`

Query mới: `mode=overwrite|add`. **Mặc định `overwrite`** (giữ đúng hành vi hiện tại, không phá client cũ).

- `overwrite` (Import đè): cùng khóa (mã, không phân biệt hoa thường) thì ghi giá trị trong file lên bản cũ. Ô trống hoặc mã không có trong file thì giữ nguyên. Đây là hành vi hiện nay.
- `add` (Import thêm): cùng khóa thì **cộng thêm số lượng**, các thông tin khác giữ nguyên bản cũ. Mã chưa có thì tạo mới.
- Giá trị `mode` lạ thì trả `400 VALIDATION_ERROR`. Loại dữ liệu chưa hỗ trợ `add` thì trả `400` với code riêng (đề xuất `IMPORT_MODE_NOT_SUPPORTED`), tuyệt đối không âm thầm chạy như `overwrite`.
- `ImportJobDto` thêm field `mode` để màn hình xem lại (`GET /imports/:id`) biết lần nhập đó chạy kiểu nào.
- Giữ nguyên: `dryRun` mặc định `true`, tất cả hoặc không gì cả, tối đa 500 lỗi đầu, giới hạn 10 MB.

## 2. Ý nghĩa "Import thêm" theo từng loại (cần BE chốt)

| Loại | `overwrite` | `add` — đề xuất |
| ---- | ----------- | --------------- |
| `products` | như hiện nay | Cộng cột `Tồn kho` vào tồn của chi nhánh `branchId`. Các cột khác (tên, nhóm, giá bán…) của mã đã có giữ nguyên. Mã mới thì tạo đủ thông tin. |
| `price-books` | như hiện nay | Giá không phải số lượng, không có phép "cộng". Đề xuất: chỉ điền ô giá **chưa có**, không đè ô đã có. Nếu BE thấy không hợp lý thì không hỗ trợ `add` cho loại này. |
| `customers`, `suppliers` | thêm mới, xem mục 3 | Đề xuất: chỉ tạo mã chưa có, bỏ qua mã đã có. Không cộng công nợ (số dư đầu kỳ không mở cho giao diện, giữ nguyên như mục 9). |

**Phần chạm kho (`products` + `add`) là nghiệp vụ tiền/kho, cần chốt trước khi code:**
- Tồn phải đi qua `InventoryService.applyMovements` (nhiều dòng, khóa theo thứ tự cố định), ghi sổ cái `stock_movements` trong cùng transaction. Không `UPDATE` thẳng `stocks`.
- Cần một chứng từ gốc cho các dòng cộng tồn. Câu hỏi cho BE: dùng loại chứng từ nào (phiếu nhập/điều chỉnh tồn)? Mã chứng từ cấp bằng `nextDocumentCode`.
- Giá vốn của số lượng cộng thêm: lấy từ cột `Giá vốn` trong file, hay bắt buộc có cột này, hay mặc định giá vốn hiện tại? Hiện `Tồn kho` và `Giá vốn` đang bị bỏ qua, nên cần quy tắc rõ.
- Số lượng âm trong file `add`: cho phép (trừ tồn) hay từ chối? Tồn không được âm.
- Ghi nhật ký qua `AuditService.record(tx, …)`, cùng transaction.
- Có test kiểm tra ngược (gỡ bản sửa thì test phải thất bại) và thử trên PostgreSQL thật nhiều kết nối cho phần khóa dòng.

## 3. Mở thêm loại dữ liệu cho `/imports/:type`

Hiện `customers`, `suppliers` trả `IMPORT_TYPE_NOT_SUPPORTED`. FE cần khi màn hình Khách hàng, Nhà cung cấp có API:
- Khóa là `Mã`; có cột `Đang hoạt động` (`1`/`0`) để ngừng hoạt động qua file.
- Loại trừ đối tác nội bộ (`linked_branch_id IS NOT NULL`): file không được tạo/sửa các đối tác này.
- Hạn mức, công nợ theo chi nhánh: nếu có cột thì bắt buộc `branchId`, như `products`.

Các bảng khác (đơn hàng, chứng từ…) là chứng từ, **không nhập hàng loạt đè được**; nếu cần nhập thì BE đề xuất riêng. FE chưa gắn.

## 4. File mẫu

`GET /imports/:type/template` phải trả đúng file nhập được (tiêu đề cột khớp bộ đọc), có sheet hướng dẫn ngắn nói rõ khóa và ý nghĩa ô trống. Nếu cột `Tồn kho` có nghĩa khác nhau giữa hai chế độ thì nói rõ trong sheet hướng dẫn. FE đang gọi endpoint này khi người dùng bấm "Tải file mẫu".

## 5. Không xóa, chỉ ngừng hoạt động / hủy

- Rà soát: **không có endpoint `DELETE` nghiệp vụ nào** (khách, NCC, hàng hóa, chứng từ). Nếu có thì bỏ hoặc trả `405`.
- Import không bao giờ xóa bản ghi không có trong file (đã đúng hiện nay, ghi vào test cho chắc).
- Cần đủ đường "ngừng" để FE làm nút thay cho xóa:
  - Hàng hóa: `PATCH /products/:id` với `isActive=false` (đã có).
  - Khách hàng, NCC: `isActive=false` khi sửa. Chưa có API nên cần khi làm phân hệ.
  - Đơn hàng, chứng từ: hủy bằng đổi trạng thái + nhật ký (quy tắc 4 trong CLAUDE.md). Cần endpoint hủy tương ứng.
- Bản ghi đã ngừng hoạt động vẫn nhập được qua file; nhập lại với `Đang kinh doanh = 1` thì kích hoạt lại.

## 6. Cập nhật tài liệu và kiểm thử

- `docs/api/endpoints.md` mục 9 + `docs/api/README.md` "Nhật ký thay đổi": thêm `mode`, mã lỗi mới, ý nghĩa `add` từng loại. Chạy `pnpm --filter @kiot/api openapi:export` rồi báo FE sinh lại kiểu (`pnpm api:types`).
- Test: `overwrite` chạy lại cùng file cho `updated = 0`; `add` chạy hai lần thì cộng hai lần (không idempotent, FE đã bắt người dùng kiểm tra trước); `dryRun` không ghi gì; có dòng lỗi thì không ghi gì; mã khác hoa/thường vẫn khớp; không xóa mã vắng trong file.

## 7. FE sẽ làm khi BE xong

- Đặt `addModeSupported: true` cho loại tương ứng trong `apps/web/src/lib/imports.ts` và truyền `mode` trong `runImport` (`lib/queries/imports.ts`).
- Hiện cảnh báo riêng khi chọn `add` ("chạy lại sẽ cộng thêm lần nữa").
- Gắn nút nhập cho Khách hàng, Nhà cung cấp khi màn hình có API.
