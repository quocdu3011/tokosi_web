# Giao diện Hàng hóa & Nhóm hàng (A+B) — thiết kế

Ngày: 2026-11-05 · Phạm vi: `apps/web` (chỉ FE; API đã có, xem `docs/api/endpoints.md` mục 2).
Đã duyệt trong hội thoại. Các mảng sau (C+D đăng nhập Google/cài đặt, E nhập "thêm") có spec riêng.

## Mục tiêu

Làm hết phần API Hàng hóa/Nhóm hàng đã có mà UI chưa có: thêm/sửa hàng (gồm Combo), ngừng kinh doanh, ảnh, tồn tối thiểu/tối đa/vị trí theo chi nhánh, xem tồn từng chi nhánh, thẻ kho, quản lý cây nhóm hàng.

## Ràng buộc nghiệp vụ

- **Không xóa:** hàng hóa chỉ "Ngừng kinh doanh / Kích hoạt lại" (`PATCH isActive`). Nhóm hàng: **không có nút xóa** trên UI (dù API có xóa mềm). Ảnh: giữ nút xóa kèm xác nhận (ảnh là nội dung đính kèm).
- Quyền: ẩn/khóa theo `can(me, …)`, không theo vai trò. `product.edit` sửa mọi trường; chỉ có `product.content.edit` thì chỉ sửa mô tả + ảnh (khóa ô khác). Giá vốn, giá nhập cuối chỉ hiện khi có `product.cost.view` (field vắng mặt).
- Dữ liệu theo chi nhánh (tồn, giá vốn, min/max, vị trí): khóa truy vấn gồm chi nhánh làm việc.
- Combo: không có tồn/thẻ kho riêng → khóa tab "Theo chi nhánh" (phần sửa) và ẩn tab "Thẻ kho". Combo không lồng combo.
- Mã hàng: ô sửa được; API từ chối nếu hàng đã có giao dịch (`INVALID_STATE`) → hiện đúng thông báo của API.
- Mọi lỗi API hiện qua `errorMessage`; `VALIDATION_ERROR.details[].field` gắn vào ô tương ứng.

## Thành phần

### Dữ liệu (`lib/queries/*`, `lib/*.ts` thuần)
- `lib/queries/products.ts` mở rộng: `useProduct(id)`, `useCreateProduct`, `useUpdateProduct`, `useProductBranches(id)`, `useSaveProductBranch`, `useStockCard(id, range)`, `useProductLookup(q)`. Mọi mutation làm mới `productKeys`.
- `lib/queries/product-images.ts`: `useUploadImages`, `useReorderImages`, `useDeleteImage`.
- `lib/queries/categories.ts`: `useCreateCategory`, `useUpdateCategory` (đã có `useCategories` trong products.ts, chuyển sang đây giữ nguyên export).
- `lib/product-components.ts` (thuần, có test): `parseComponents("DAO01/2,KEO03/1")` ↔ `serializeComponents(rows)`, kiểm tra trùng mã, số lượng nguyên dương, ít nhất 1 dòng.
- `lib/product-images.ts` (thuần, có test): `validateImageFiles(existingCount, files)` — tối đa 10 ảnh/hàng, mỗi lần ≤ 10 file, mỗi ảnh ≤ 5 MB, JPEG/PNG/WebP (theo `type` ở trình duyệt; server kiểm tra lại theo nội dung).
- `lib/stock-card.ts` (thuần, có test): nhãn tiếng Việt cho `refType`, mặc định khoảng ngày.
- `lib/api/client.ts`: đã hỗ trợ `FormData`; cần thêm `put`/`patch`/`delete` nếu thiếu `delete` (hiện có `put`, `patch`; thêm `delete`).

### Giao diện
- `/products`: thêm nút **Thêm hàng hóa** (cần `product.edit`); bấm dòng mở **ngăn kéo chi tiết** (Sheet bên phải, rộng); cột hành động có "Ngừng kinh doanh / Kích hoạt lại" (hộp xác nhận).
- `product-drawer.tsx` gồm 4 tab (Radix Tabs): `Thông tin`, `Ảnh`, `Theo chi nhánh`, `Thẻ kho`. Chế độ tạo mới chỉ có tab Thông tin + chọn ảnh ở cuối form.
- Tạo hàng 2 bước: `POST /products` rồi `POST …/images`; ảnh lỗi thì hàng vẫn được tạo, mở ngăn kéo ở tab Ảnh kèm thông báo.
- `component-editor.tsx`: bảng hàng thành phần (ô tìm bằng lookup, số lượng nguyên dương, xóa dòng).
- `image-manager.tsx`: lưới ảnh, tải nhiều file, nút lên/xuống, "Đặt làm ảnh đại diện" (= đưa lên đầu), xóa có xác nhận. Không thêm thư viện kéo-thả.
- `/products/categories` (mục menu "Nhóm hàng", quyền `product.view`; nút sửa cần `product.edit`): cây tối đa 3 cấp + `productCount`; thêm nhóm con, đổi tên, chuyển nhóm cha (ô chọn loại trừ chính nó và nhóm con của nó, không vượt 3 cấp).

### Xử lý lỗi và trạng thái
- Đang tải: skeleton; lỗi tải: `alert-error`; rỗng: câu thông báo tiếng Việt.
- Lỗi lưu giữ nguyên dữ liệu đã nhập; ghi đè khi `409 VERSION_CONFLICT` không áp dụng (API sản phẩm không dùng `updatedAt`).
- Chuyển chi nhánh làm việc đóng ngăn kéo (dữ liệu theo chi nhánh đã đổi).

### Kiểm thử
- Vitest cho 3 module thuần ở trên và cho `client.ts` (`delete`). Chạy `pnpm --filter @kiot/web typecheck lint test` sau mỗi nhóm việc.
- Nếu chạy được API cục bộ (Docker): kiểm tra thủ công luồng tạo hàng + ảnh, sửa, ngừng kinh doanh, combo, thẻ kho, nhóm hàng; nếu không, ghi rõ chưa thử với API thật.

## Ngoài phạm vi
Đăng nhập Google, màn `pending`, `/settings/auth` (C+D); chế độ nhập "thêm" và `GET /imports/:id` (E); khách hàng, nhà cung cấp, đơn hàng, sổ quỹ, báo cáo, chuyển kho (chưa có API trong OpenAPI).
