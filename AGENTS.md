# AGENTS.md – Hướng dẫn cho AI Agents

> Tài liệu hướng dẫn chính và toàn diện nhất của dự án nằm tại [`CLAUDE.md`](CLAUDE.md).
> Mọi agent khi bắt đầu làm việc trong dự án Tokosi **bắt buộc đọc `CLAUDE.md`** và `CURRENT.md`.

---

## 1. Hướng dẫn nghiệp vụ chung & Backend

- Đọc chi tiết tại [`CLAUDE.md`](CLAUDE.md).
- Tài liệu thiết kế hệ thống: [`docs/TAI_LIEU_THIET_KE.md`](docs/TAI_LIEU_THIET_KE.md).
- Hợp đồng API: [`docs/api/`](docs/api/README.md) và `docs/api/endpoints.md`.
- Quản trị CSDL và migration: [`docs/db/`](docs/db/README.md).

---

## 2. Nguyên tắc xây dựng Frontend (`apps/web`) tuân thủ Design System

Tài liệu chuẩn hóa giao diện: [`docs/design-system/README.md`](docs/design-system/README.md).

### Công nghệ & CSS
- **Next.js 16 (App Router) + React 19 + CSS thuần theo token (TUYỆT ĐỐI KHÔNG Tailwind, KHÔNG shadcn/cva).**
- Lớp CSS nằm tại `apps/web/src/styles/`. Component tại `components/ui/*` chỉ ánh xạ prop sang tên lớp bằng `cn()` (`lib/utils.ts`).
- Dùng Radix UI cho hành vi tương tác; Sonner cho toast notification (`toast`).
- Icon: **Chỉ dùng SVG Lucide (`lucide-react`)** với `aria-hidden="true"`. **Tuyệt đối không dùng emoji làm icon**.
- Thêm CSS mới: tạo file `styles/components/<ten>.css` và **bắt buộc thêm `@import './components/<ten>.css';` vào `styles/components.css`**.

### Token & Theme
- **Dark Obsidian là giao diện mặc định**, Light là thứ hai (`data-theme="light"` trên `<html>`).
- Mọi màu sắc, nền, viền, bóng, khoảng cách, bo góc đều qua token CSS `var(--...)`.
- Khai báo token mới đủ cặp ở `:root` (dark) và `:root[data-theme='light']` (light) trong `styles/tokens.css`.
- Màu trong suốt dựng từ RGB: `rgba(var(--primary-rgb), 0.14)`. Không dùng inline style `style={{...}}` cho màu/khoảng cách.

### Ràng buộc kỹ thuật cứng (Automated Test: `design-constraints.test.ts`)
- Không `transform-style: preserve-3d`, không `perspective`, không biến đổi 3D (`translateZ`, `rotateX`, `rotateY`, `translate3d`). Chỉ dùng 2D (`translate`, `translateY`, `rotate`).
- Không `background-attachment: fixed`.
- Không `transition: all` (phải liệt kê từng thuộc tính cụ thể).
- `backdrop-filter` **chỉ** được phép ở `.app-header` và `.auth-card`; không dùng cho modal, drawer hay overlay.
- Không `font-size` dưới `12px`.
- Không dùng mã màu hex thô (cấm `#ff0000`, `#00ff00`, `#0000ff`).
- Không chuỗi `tailwind`, `@apply`, `tw-animate` (kể cả trong chú thích).
- Không ký tự emoji trong mã nguồn (`.ts`, `.tsx`, kể cả trong chuỗi và chú thích).

### Trang danh sách chuẩn (List Page Pattern - BẮT BUỘC)
- Theo đúng [`docs/design-system/list-page.md`](docs/design-system/list-page.md): `PageHeader` → `TableToolbar` → `DataTable` (gắn `prefs` từ `useTablePrefs`) → `Pagination`.
- Dùng `useTablePrefs('<tableKey>', columns)` để lưu cột và cỡ trang theo tài khoản người dùng (`/me/table-prefs`). Cột mã/tên đặt `locked: true`.
- **Không hard-code `PAGE_SIZE` hay `limit: 20`**: lấy `limit = list.pageSize`.
- Sử dụng `useListState` quản lý lọc/tìm kiếm/sắp xếp/trang (tự reset về trang 1).
- Xử lý đủ 3 trạng thái: Skeleton khi tải, Empty State (`emptyText`), và `.alert .alert-error` khi lỗi (kèm nút Thử lại).
- **Tiêu đề cột của mọi bảng luôn căn giữa** (kể cả cột số, cột thao tác, bảng phân quyền); ô dữ liệu số/tiền căn phải (`.num`).
- Xuất Excel: áp dụng đúng bộ lọc đang chọn và lọc danh sách cột theo quyền hạn.

### Quy chuẩn Component & Nghiệp vụ
- Dùng component có sẵn (`Button`, `Field`, `Dialog`, `ConfirmDialog`, `Sheet`, `DataTable`...).
- Trạng thái bắt buộc dùng `StatusBadge` / `Badge`; **không viết** `<span className="badge …">`.
- Thao tác xóa/hủy/khóa bắt buộc qua `ConfirmDialog`, không dùng `window.confirm`.
- Ẩn/hiện tính năng/cột/nút theo quyền qua `can(me, '<mã.quyền>')` (`lib/permissions.ts`), **không kiểm tra theo vai trò (`user.role`)**. Cột giá vốn yêu cầu quyền `product.cost.view`.
- Tiền/số lượng là chuỗi thập phân: dùng `formatMoney` / `formatDecimal` (`lib/format.ts`), không chuyển sang `number` để tính toán.
- Ngày giờ hiển thị theo múi giờ `Asia/Ho_Chi_Minh` (`formatDate`, `formatDateTime`).
- Query TanStack Query theo chi nhánh phải chứa `branchId` trong query key.

### Trợ năng (a11y) & UX
- Toàn bộ văn bản hiển thị là **tiếng Việt có dấu**.
- Nút chỉ icon có `aria-label` tiếng Việt; icon trang trí gắn `aria-hidden="true"`.
- Input `id` có tiền tố theo màn hình (vd `uf-username`, `pf-code`).
- Ô bấm tối thiểu 44px trên thiết bị cảm ứng (`@media (pointer: coarse)`).
- Tôn trọng `prefers-reduced-motion` và không gây cuộn ngang cả trang.

