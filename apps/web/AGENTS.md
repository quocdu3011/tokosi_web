<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hướng dẫn AI Agent phát triển Frontend (`apps/web`)

> Nguồn chân lý duy nhất cho giao diện Tokosi: [`docs/design-system/README.md`](../../docs/design-system/README.md).
> Bắt buộc đọc: [tokens.md](../../docs/design-system/tokens.md), [components.md](../../docs/design-system/components.md), [list-page.md](../../docs/design-system/list-page.md), [checklist.md](../../docs/design-system/checklist.md).

## 1. Công nghệ & Phong cách CSS

- **CSS thuần theo token CSS:** TUYỆT ĐỐI KHÔNG Tailwind, KHÔNG shadcn/cva.
- Class CSS nằm tại `src/styles/`. Component tại `src/components/ui/*` ánh xạ prop sang class bằng `cn()` (`src/lib/utils.ts`).
- Không dùng `style={{...}}` cho màu hoặc khoảng cách.
- Radix UI cho hành vi tương tác; Sonner cho toast (`toast`).
- Icon: Chỉ dùng Lucide SVG (`lucide-react`) với `aria-hidden="true"`. **Tuyệt đối không dùng emoji làm icon**.
- CSS mới: tạo `src/styles/components/<ten>.css` và **bắt buộc thêm `@import './components/<ten>.css';` vào `src/styles/components.css`**.

## 2. Token & Theme

- **Dark Obsidian là theme mặc định**, Light là thứ hai (`data-theme="light"` trên `<html>`).
- Mọi giá trị màu sắc, viền, bóng, khoảng cách, bo góc dùng token `var(--...)`.
- Khai báo token mới đủ cặp ở `:root` (dark) và `:root[data-theme='light']` (light) trong `src/styles/tokens.css`.
- Màu trong suốt dựng từ RGB: `rgba(var(--primary-rgb), 0.14)`.

## 3. Ràng buộc cứng (Tự động kiểm tra bởi `design-constraints.test.ts`)

Lệnh kiểm tra: `pnpm --filter @kiot/web exec vitest run design-constraints`
- Không `transform-style: preserve-3d`.
- Không `perspective`.
- Không biến đổi 3D (`translateZ`, `rotateX`, `rotateY`, `translate3d`). Chỉ dùng biến đổi 2D.
- Không `background-attachment: fixed`.
- Không `transition: all` (phải liệt kê từng thuộc tính).
- `backdrop-filter` CHỈ ở `.app-header` và `.auth-card`; không dùng trên modal, drawer, overlay.
- Font size không dưới 12px.
- Không mã màu hex thô (cấm `#ff0000`, `#00ff00`, `#0000ff`).
- Không chuỗi `tailwind`, `@apply`, `tw-animate` (kể cả chú thích).
- Không emoji trong code (`.ts`, `.tsx`, kể cả comment và chuỗi).

## 4. Trang danh sách chuẩn (List Page Pattern)

- Theo mẫu [`docs/design-system/list-page.md`](../../docs/design-system/list-page.md): `PageHeader` → `TableToolbar` → `DataTable` → `Pagination`.
- Sử dụng hook `useTablePrefs('<tableKey>', columns)` để lưu cột và cỡ trang theo tài khoản (`/me/table-prefs`). Cột mã/tên đặt `locked: true`.
- Không hard-code `PAGE_SIZE` hay `limit: 20`; lấy `limit = list.pageSize`.
- Sử dụng `useListState` để quản lý bộ lọc, tìm kiếm, sắp xếp (tự reset về trang 1).
- Xử lý đủ: Skeleton khi tải, Empty State (`emptyText`), và `.alert .alert-error` khi lỗi (kèm nút Thử lại).
- **Tiêu đề cột của mọi bảng luôn căn giữa** (kể cả cột số, cột thao tác, bảng phân quyền); ô dữ liệu số/tiền căn phải (`.num`).

## 5. Component & Nghiệp vụ

- Sử dụng component có sẵn trong `src/components/ui/` và `src/components/common/`.
- Trạng thái bắt buộc dùng `StatusBadge` / `Badge`; không viết `<span className="badge ...">`.
- Xác nhận thao tác qua `ConfirmDialog`, không dùng `window.confirm`.
- Ẩn/hiện tính năng/nút/cột theo `can(me, '<mã.quyền>')` (`src/lib/permissions.ts`), không kiểm tra theo `user.role`. Cột giá vốn yêu cầu quyền `product.cost.view`.
- Tiền/số lượng là chuỗi: dùng `formatMoney` / `formatDecimal` (`src/lib/format.ts`), không ép sang kiểu `number`.
- Ngày giờ hiển thị theo `Asia/Ho_Chi_Minh` (`formatDate`, `formatDateTime`).
- Query TanStack Query theo chi nhánh phải chứa `branchId` trong query key.

## 6. Trợ năng & Đa thiết bị

- Toàn bộ chữ hiển thị là tiếng Việt có dấu.
- Nút chỉ icon có `aria-label` tiếng Việt.
- Input `id` có tiền tố theo màn hình (vd `uf-username`, `pf-code`).
- Vùng bấm >= 44px trên thiết bị cảm ứng (`@media (pointer: coarse)`).
- Không gây cuộn ngang cả trang (bảng cuộn ngang trong khung riêng).
