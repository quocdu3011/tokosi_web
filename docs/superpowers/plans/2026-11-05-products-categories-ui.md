# Giao diện Hàng hóa & Nhóm hàng — kế hoạch triển khai

> **For agentic workers:** thực hiện từng task theo thứ tự, đánh dấu `- [ ]`. Spec: `docs/superpowers/specs/2026-11-05-products-categories-ui-design.md`.

**Goal:** Thêm UI cho thêm/sửa/ngừng kinh doanh hàng hóa (gồm Combo), ảnh, tồn theo chi nhánh, thẻ kho và quản lý nhóm hàng.

**Architecture:** Mỗi API một hook TanStack Query trong `lib/queries/*`; logic không phụ thuộc React ở `lib/*.ts` (có test Vitest); màn hình ở `app/(app)/products/*`. Ngăn kéo chi tiết dùng `Sheet` + Radix Tabs; biểu mẫu dùng react-hook-form + zod như `user-form-dialog.tsx`.

**Tech Stack:** Next.js 16, React 19, TanStack Query 5, react-hook-form, zod 4, Radix UI, CSS thuần (không Tailwind), Vitest.

## Global Constraints

- Chỉ sửa `apps/web` (và `docs/`), CSS thuần theo token, **không** `transition: all`, không backdrop-filter, chữ ≥ 12px.
- Văn bản hiển thị tiếng Việt; tiền/số lượng là chuỗi thập phân; thời gian hiển thị `Asia/Ho_Chi_Minh`.
- Ẩn/khóa theo `can(me, '<mã quyền>')`, không theo vai trò. Giá vốn chỉ khi có `product.cost.view`.
- **Không có nút xóa** hàng hóa hoặc nhóm hàng; chỉ "Ngừng kinh doanh / Kích hoạt lại". Ảnh được xóa (có xác nhận).
- Id phần tử form có tiền tố riêng (vd `pf-`) để không trùng id giữa các trang.
- Mỗi task kết thúc bằng `pnpm --filter @kiot/web typecheck && pnpm --filter @kiot/web lint && pnpm --filter @kiot/web test` xanh rồi commit (Conventional Commits, kèm dòng `Co-Authored-By`).

---

### Task 1: Nền tảng — client, kiểu, hàm thuần

**Files:**
- Modify: `apps/web/src/lib/api/client.ts` (thêm `delete`), `apps/web/src/lib/api/client.test.ts`
- Modify: `apps/web/src/lib/api/types.ts` (kiểu mới)
- Create: `apps/web/src/lib/product-components.ts` + `.test.ts`, `apps/web/src/lib/product-images.ts` + `.test.ts`, `apps/web/src/lib/stock-card.ts` + `.test.ts`
- Delete: `apps/web/src/lib/price-grid.ts`, `price-grid.test.ts` (mã chết sau khi bỏ giá bán)

**Interfaces — Produces:**
```ts
// product-components.ts
export interface ComponentRow { code: string; qty: number }
export function parseComponents(text: string): ComponentRow[];            // "DAO01/2,KEO03/1" → rows; "" → []
export function serializeComponents(rows: ComponentRow[]): string;        // rows → "DAO01/2,KEO03/1"
export function componentsProblem(rows: ComponentRow[]): string | null;   // null = hợp lệ
// product-images.ts
export const MAX_IMAGES_PER_PRODUCT = 10; export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function validateImageFiles(existingCount: number, files: { name: string; size: number; type: string }[]): string | null;
// stock-card.ts
export const STOCK_REF_LABELS: Record<string, string>;
export function stockRefLabel(refType: string): string;                    // lạ → trả nguyên refType
export function defaultStockRange(now?: Date): { from: string; to: string }; // 30 ngày gần nhất, YYYY-MM-DD giờ VN
// types.ts
export type Category = Schemas['CategoryNodeDto']; export type ProductBranch = Schemas['ProductBranchDto'];
export type ProductImage = Schemas['ProductImageDto']; export type ProductLookup = Schemas['ProductLookupDto'];
export type CreateProductInput = Schemas['CreateProductDto']; export type UpdateProductInput = Schemas['UpdateProductDto'];
export type ProductBranchSettings = Schemas['SetProductBranchSettingsDto'];
export type StockCard = Omit<Schemas['StockCardDto'], 'movements'> & { movements: StockCardMovement[] };
export type StockCardMovement = Omit<Schemas['StockCardMovementDto'], 'unitCost'> & { unitCost?: string }; // openapi khai sai kiểu unitCost
```

- [ ] **Step 1:** Viết test thất bại cho 3 module thuần: parse/serialize khứ hồi, bỏ khoảng trắng, từ chối `qty` không nguyên dương/trùng mã/rỗng; `validateImageFiles` (quá 10 ảnh tính cả ảnh có sẵn, > 5 MB, sai `type`); `stockRefLabel` các `refType` trong spec API + giá trị lạ; `defaultStockRange` với `now` cố định.
- [ ] **Step 2:** Chạy `pnpm --filter @kiot/web test` → FAIL (module chưa có).
- [ ] **Step 3:** Cài đặt 3 module + `delete: <T>(path, opts) => request<T>(path, {...opts, method:'DELETE'})` trong `createApiClient` + test `delete` (204 → `undefined`) + thêm kiểu vào `types.ts`; xóa `price-grid*`.
- [ ] **Step 4:** Chạy test, typecheck, lint → PASS.
- [ ] **Step 5:** Commit `feat(web): nền tảng cho giao diện hàng hóa (hàm thuần, kiểu, client.delete)`.

### Task 2: Truy vấn dữ liệu

**Files:** Modify `lib/queries/products.ts`; Create `lib/queries/categories.ts`, `lib/queries/product-images.ts`.

**Interfaces — Produces:**
```ts
useProduct(id: string | null)                      // GET /products/:id, khóa gồm branchId
useCreateProduct() / useUpdateProduct()            // POST /products ; PATCH /products/:id  { id, patch: UpdateProductInput }
useProductBranches(id: string | null)              // GET /products/:id/branches
useSaveProductBranch()                             // PUT /products/:id/branches/:branchId  { id, branchId, settings }
useStockCard(id: string | null, range: {from: string; to: string}, enabled: boolean)
useProductLookup(q: string)                        // GET /products/lookup?q= (bật khi q ≥ 1 ký tự)
useCreateCategory() / useUpdateCategory()          // POST /categories ; PATCH /categories/:id  { id, patch }
useUploadImages() / useReorderImages() / useDeleteImage()
```
Mọi mutation làm mới `productKeys.all` (và `productKeys.categories` với nhóm hàng). Ảnh dùng `FormData` field `files` lặp lại.

- [ ] **Step 1:** Cài đặt các hook theo mẫu `useCreateUser`/`useBulkAdjust` cũ (`useMutation` + `invalidateQueries`).
- [ ] **Step 2:** typecheck + lint + test xanh; commit `feat(web): hook truy vấn hàng hóa, ảnh, nhóm hàng`.

### Task 3: Màn Nhóm hàng

**Files:** Create `app/(app)/products/categories/page.tsx`, `categories-screen.tsx`, `category-form-dialog.tsx`; Modify `lib/navigation.ts` (mục "Nhóm hàng", `/products/categories`, `product.view`, `ready: true`); Modify `styles/components/screens.css` (lớp `.tree`).

- [ ] **Step 1:** `categories-screen.tsx`: cây lồng nhau từ `useCategories()`, mỗi nút hiện tên + `productCount`; có `product.edit` thì có nút "Thêm nhóm con", "Đổi tên / chuyển nhóm" (không có nút xóa).
- [ ] **Step 2:** `category-form-dialog.tsx`: ô tên (1–100 ký tự), ô chọn nhóm cha. Danh sách cha loại trừ chính nó, mọi nhóm con của nó, và các nhóm ở cấp 3 (tối đa 3 cấp; nếu nhóm đang sửa có con thì độ sâu tối đa còn lại giảm tương ứng). Lỗi `DUPLICATE_NAME` gắn vào ô tên.
- [ ] **Step 3:** typecheck, lint, test; chạy thử trên trình duyệt nếu có API; commit `feat(web): màn quản lý nhóm hàng`.

### Task 4: Ngăn kéo hàng hóa — Thông tin và Ảnh

**Files:** Create `products/product-drawer.tsx`, `product-info-form.tsx`, `component-editor.tsx`, `image-manager.tsx`, `confirm-dialog.tsx` (dùng `AlertDialog`); Modify `products/products-screen.tsx`, `styles/components/screens.css`.

**Interfaces:** `ProductDrawer({ productId: string | null /* null = tạo mới */, open, onClose })`; `ConfirmDialog({ title, description, confirmLabel, destructive?, onConfirm, onClose })`.

- [ ] **Step 1:** `products-screen.tsx`: nút "Thêm hàng hóa" (`product.edit`), bấm dòng mở ngăn kéo, cột "Thao tác" với "Ngừng kinh doanh / Kích hoạt lại" qua `ConfirmDialog` → `useUpdateProduct({ patch: { isActive } })`.
- [ ] **Step 2:** `product-info-form.tsx`: zod schema (mã `^[A-Za-z0-9._-]{1,30}$`, tên bắt buộc, nhóm tùy chọn, loại hàng, mô tả); `component-editor` chỉ khi Combo, dùng `useProductLookup` để chọn hàng (loại combo ra khỏi gợi ý), `serializeComponents` khi gửi; chỉ gửi trường thay đổi khi sửa; khóa mọi ô trừ mô tả khi thiếu `product.edit`; `applyServerErrors` cho `code`, `name`, `categoryId`, `components`.
- [ ] **Step 3:** `image-manager.tsx`: `<input type="file" multiple accept="image/jpeg,image/png,image/webp">`, `validateImageFiles` trước khi gửi, lưới ảnh với nút Lên/Xuống/"Đặt làm ảnh đại diện" (gọi `useReorderImages` với đủ id), xóa qua `ConfirmDialog`. Cần `product.edit` hoặc `product.content.edit`.
- [ ] **Step 4:** Tạo mới: lưu hàng rồi tải ảnh đã chọn; ảnh lỗi thì giữ hàng, mở ngăn kéo ở tab Ảnh kèm toast.
- [ ] **Step 5:** typecheck, lint, test; commit `feat(web): thêm/sửa hàng hóa, combo, ảnh và ngừng kinh doanh`.

### Task 5: Tab Theo chi nhánh và Thẻ kho

**Files:** Create `products/product-branches-tab.tsx`, `products/stock-card-tab.tsx`; Modify `product-drawer.tsx`.

- [ ] **Step 1:** `product-branches-tab.tsx`: bảng từ `useProductBranches` (tồn, đã đặt, khả dụng, giá vốn nếu có field); với `product.edit` mỗi dòng có ô tồn tối thiểu/tối đa/vị trí + nút Lưu (`useSaveProductBranch`; chuỗi rỗng → `null`; kiểm tra min ≤ max trước khi gửi). Combo: ẩn phần sửa, ghi chú "Combo tính từ hàng thành phần".
- [ ] **Step 2:** `stock-card-tab.tsx` (chỉ hàng hóa): hai ô ngày (mặc định `defaultStockRange()`), hiện tồn đầu, bảng biến động (thời gian VN, `stockRefLabel`, mã chứng từ, +/- số lượng, tồn sau, giá vốn nếu có), tồn cuối.
- [ ] **Step 3:** Chuyển chi nhánh làm việc (theo `useBranchStore`) thì đóng ngăn kéo.
- [ ] **Step 4:** typecheck, lint, test; commit `feat(web): tồn theo chi nhánh và thẻ kho trong ngăn kéo hàng hóa`.

### Task 6: Kiểm tra cuối

- [ ] Chạy `pnpm --filter @kiot/web typecheck lint test build`.
- [ ] Nếu API chạy được cục bộ: thử tạo hàng + ảnh, sửa, ngừng/kích hoạt, tạo combo, thẻ kho, nhóm hàng trên trình duyệt; nếu không, ghi rõ "chưa thử với API thật" khi báo kết quả.
- [ ] Rà soát: không còn nút xóa hàng/nhóm; các ô bị khóa đúng theo quyền; chữ ≥ 12px.
