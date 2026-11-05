# Kế hoạch: Áp dụng Design System "TKS Dashboard" cho `apps/web`

## Context

Nguồn: `D:\Web TKS Dashboard\design-system\tks-dashboard\` (`MASTER.md` + `pages/*.md`) và token thật ở `D:\Web TKS Dashboard\server\public\shared\shared.css`.
Hiện `apps/web` là Next.js 16 + Tailwind v4 + shadcn/ui, bảng màu neutral mặc định, tên "Kiot bán sỉ", theme theo hệ thống.
Mục tiêu: giao diện toàn bộ web khớp design system (Obsidian dark mặc định + Light, Be Vietnam Pro / Inter / Roboto, token màu/bo góc/bóng, component theo MASTER §5, ràng buộc hiệu năng §7), đổi tên hiển thị thành **Tokosi**.

**Quyết định đã chốt với người dùng**

- Viết lại bằng **CSS thuần** theo MASTER (bỏ Tailwind, tailwind-merge, class-variance-authority, tw-animate-css, `@tailwindcss/turbopack`).
- **Giữ Radix + Sonner** (chỉ lo hành vi/ARIA/focus), tạo kiểu bằng CSS thuần theo `data-state`/`data-slot`.
- CSS **toàn cục tách lớp**: `tokens / base / components / layout`, tên lớp đúng MASTER (`.btn-primary`, `.card`, `.data-table`, `.modal-box`…).
- Phạm vi: **toàn bộ trang web**. Theme: **dark mặc định**, có nút chuyển Light. Thương hiệu: **Tokosi**.
- Dùng **ảnh nền + Logo.jpg** từ thư mục design system (dùng bản `shared/images/bg-dark.jpg`, `bg-light.jpg`, `Logo.jpg`, không dùng `.jfif`).
- **Chỉ đổi giao diện, không đổi logic.** Chỉ sửa `apps/web` (+ `pnpm-lock.yaml` do gỡ phụ thuộc). Không động `apps/api`, `docs/api/` (memory: FE-only).

**Ngoài phạm vi** (ghi nhận, có thể làm sau): hiệu ứng `motion.js` (§6 chữ rơi, KPI lật), starfield canvas trang 404, trang đặc thù chưa có ở web (Vòng đời, Nhân sự, Vị trí hàng), bất kỳ field/endpoint mới.

## Hiện trạng cần biết (đã khảo sát)

- 35 file `.tsx` / 197 chỗ `className` đều là tiện ích Tailwind. `cn()` ở `src/lib/utils.ts` (clsx + tailwind-merge).
- `globals.css` khai báo biến shadcn (oklch) + `@theme inline`. `next.config.ts` có luật turbopack `@tailwindcss/turbopack`. Không có `postcss.config`.
- `app-providers.tsx`: `ThemeProvider attribute="class" defaultTheme="system"`; layout dùng `next/font` Inter.
- Màn hình thật: `settings/users/*`, `settings/roles/*`, trang chủ, đăng nhập, đổi mật khẩu. Phần còn lại là `ComingSoon`/`PlaceholderPage`.
- Điểm đụng độ tên biến: shadcn `--muted` là _nền_, DS `--muted` là _màu chữ_; `--radius-*`, `--border`, `--primary` cũng trùng tên. Vì vậy chuyển hẳn từng lớp, không trộn.
- Quy tắc DS cần giữ: cấm `preserve-3d`/`perspective`/`translateZ`/`transition: all`/`background-attachment: fixed`/`backdrop-filter` trên overlay toàn màn hình (§7.1); chữ ≥ 12px; ô bấm ≥ 40px (44px mobile); `cursor: pointer`; `:focus-visible` rõ; `prefers-reduced-motion`; không emoji (dùng Lucide SVG – đã có).

## Kiến trúc & quyết định kỹ thuật

- Thư mục mới `apps/web/src/styles/`: `tokens.css` (MASTER §4: màu dark + `:root[data-theme="light"]`, spacing, radius `xs…2xl`, bóng, alert/toast/status/role token lấy từ `shared.css`), `base.css` (reset, body, `body::before` nền ảnh, typography, reduced-motion, scrollbar), `components/*.css` (button, badge, form, card, table, modal, sheet, menu, toast, nav…), `layout.css` (app shell, auth, grid 12 cột, subnav). `app/globals.css` chỉ `@import` các file này.
- Theme: `next-themes` đổi sang `attribute="data-theme"`, `defaultTheme="dark"`, `enableSystem={false}`, vẫn `disableTransitionOnChange`. Gắn `color-scheme` theo theme.
- Phông: `next/font/google` — Be Vietnam Pro (500–800), Inter (400–700), Roboto (400–700), subset `latin` + `vietnamese`, gán `--font-display/-body/-data`.
- `cn()` còn lại chỉ là `clsx` (không merge Tailwind). Biến thể `cva` đổi sang map class thủ công (`variant` → `btn-primary|btn-secondary|btn-ghost|btn-danger`).
- Animation Radix/Sonner: viết `@keyframes` + selector `[data-state="open"]` (chỉ `opacity` + `translateY`, ≤ 300ms, `var(--ease-out)`), thay cho `tw-animate-css`.
- Auth card/404 dùng "buộc sáng" bằng `data-theme="light"` trên wrapper (MASTER §5.10), không chép ~25 biến.
- Header sticky giữ `backdrop-filter` nhẹ được (không phải overlay toàn màn hình); `.modal-overlay` / sheet backdrop **không** blur.
- Role badge: map `Role` của `@kiot/shared` sang token `--role-*`; vai trò không có token tương ứng dùng `khach` (trung tính). Kiểm tra danh sách vai trò khi làm T12.

## Danh sách task

Sao chép nội dung này thành `tasks/plan.md` và `tasks/todo.md` ở task 0 (thư mục `tasks/` chưa tồn tại, không có kế hoạch cũ nào bị ghi đè).

### Phase 1: Nền tảng

- [ ] **T0 – Lưu kế hoạch** (XS). Tạo `tasks/plan.md` (tài liệu này) và `tasks/todo.md` (checklist). _Verify:_ hai file tồn tại.

- [ ] **T1 – Tài sản, phông, theme provider, thương hiệu** (M)
  - Sao chép `Logo.jpg`, `shared/images/bg-dark.jpg`, `bg-light.jpg` vào `apps/web/public/` (kiểm tra dung lượng; nếu quá lớn, nén lại). Tạo favicon từ logo nếu phù hợp.
  - `app/layout.tsx`: 3 phông, `lang="vi"`, metadata `Tokosi – Quản lý bán hàng sỉ`, template `%s · Tokosi`.
  - `app-providers.tsx`: cấu hình `next-themes` như trên.
  - AC: web chạy, `<html data-theme="dark">` mặc định, 3 biến phông có mặt; chưa cần đẹp.
  - Files: `public/*`, `app/layout.tsx`, `components/providers/app-providers.tsx`, `components/layout/theme-toggle.tsx` (đổi sang `setTheme('light'|'dark')`).

- [ ] **T2 – Token + base CSS** (M). Tạo `styles/tokens.css`, `styles/base.css`, nối vào `globals.css` (giữ tạm dòng Tailwind để các màn chưa chuyển vẫn biên dịch được).
  - AC: mọi token MASTER §4.1–4.5 + `--overlay-bg`, `--surface-hover`, `--row-divider`, `--alert-*`, `--toast-*`, `--status-*`, `--role-*` có ở cả dark và light; `body::before` vẽ ảnh nền một lần (không `background-attachment: fixed`); khối `prefers-reduced-motion`; `:focus-visible` dùng `--shadow-focus-blue`.
  - _Verify:_ `pnpm --filter @kiot/web typecheck lint build`; xem trang đăng nhập đổi nền/phông.

### Phase 2: Bộ component `ui/*` (CSS thuần)

- [ ] **T3 – Button + Badge** (S–M). `components.css/button.css`, `badge.css`; viết lại `ui/button.tsx`, `ui/badge.tsx` (giữ API `variant`/`size`/`asChild`, thêm `loading` nếu cần). Chuẩn MASTER §5.1/§5.3/§5.6, lún nút `translateY`, ô bấm ≥ 40px.
- [ ] **T4 – Form controls** (M). `form.css`; viết lại `ui/input.tsx`, `ui/label.tsx`, `ui/checkbox.tsx`, `ui/select.tsx` (Radix), `common/field.tsx`. Chuẩn §5.4/§5.12, trạng thái `aria-invalid`, disabled, focus ring.
- [ ] **T5 – Card, bảng, phân trang** (M). `card.css`, `table.css`; viết lại `ui/card.tsx`, `ui/skeleton.tsx`, `ui/separator.tsx`, `ui/table.tsx`, `data-table/data-table.tsx`, `data-table/pagination.tsx`. Bảng: header sticky, hover chỉ đổi nền, cột số canh phải `--font-data` tabular (§5.5), skeleton, ô thao tác ≥ 40px.
- [ ] **T6 – Dialog + AlertDialog (Modal chuẩn §5.7)** (M). `modal.css`; viết lại `ui/dialog.tsx`, `ui/alert-dialog.tsx`. Overlay chỉ `background: var(--overlay-bg)`, **không blur**; animation `data-state`; responsive mobile; nút đóng ≥ 44px.
- [ ] **T7 – Sheet, Dropdown, Toast** (M). `sheet.css`, `menu.css`, `toast.css`; viết lại `ui/sheet.tsx`, `ui/dropdown-menu.tsx`, `ui/sonner.tsx` (toast theo §5.8 qua `toastOptions.classNames` + token `--toast-*`).

**Checkpoint A (sau T3–T7):** typecheck/lint/build xanh; duyệt nhanh các thành phần trong trình duyệt (dark + light); báo người dùng xem trước khi chuyển sang khung/trang.

### Phase 3: Khung ứng dụng và xác thực

- [ ] **T8 – AppShell + Brand + Sidebar** (M). `layout.css`, `nav.css`; viết lại `layout/app-shell.tsx`, `layout/sidebar-nav.tsx` (nhóm accordion `nav-group-*`, mục active, chevron, ngăn kéo mobile), `Brand` dùng `Logo.jpg` + chữ "Tokosi". Header: nút menu ≥ 44px.
- [ ] **T9 – Thanh trên** (S–M). Viết lại `layout/branch-switcher.tsx`, `layout/theme-toggle.tsx`, `layout/user-menu.tsx`, `layout/auth-gate.tsx` (nếu có lớp), `common/full-page-loader.tsx` (spinner CSS tĩnh §7.2).
- [ ] **T10 – Đăng nhập, đổi mật khẩu, 404** (M). Viết lại `(auth)/layout.tsx`, `login/login-form.tsx`, `change-password/change-password-form.tsx`, `not-found.tsx` theo `.auth-card` (§5.10, `--radius-2xl`, buộc sáng bằng `data-theme="light"`), hộp lỗi dùng `--alert-error-bg/border`, blob glow nền dùng `--ambient-1/2`, nút chuyển theme nổi. 404 không starfield canvas.

**Checkpoint B (sau T8–T10):** đăng nhập → vào khung → chuyển chi nhánh/theme/menu mobile hoạt động; chụp ảnh ở 375/768/1024/1440.

### Phase 4: Các màn hình

- [ ] **T11 – Trang chung** (S). `common/coming-soon.tsx` (PageHeader, trang "đang xây dựng"), `common/placeholder-page.tsx`, `common/require-permission.tsx`, `(app)/page.tsx`. `h1` duy nhất, tiêu đề `--font-display`.
- [ ] **T12 – Người dùng** (M). `settings/users/users-screen.tsx`, `user-form-dialog.tsx`, `temporary-password-dialog.tsx` + role badge/status pill (§5.6), thanh lọc, nút thao tác ≥ 40px, bảng sticky + hover.
- [ ] **T13 – Vai trò & quyền** (M). `settings/roles/roles-screen.tsx` (24 chỗ className): ma trận quyền, checkbox, nhóm quyền, khung cuộn.

**Checkpoint C (sau T11–T13):** mọi màn hình đã chuyển; `grep` không còn tiện ích Tailwind trong `src/` (trừ `@import` ở `globals.css`).

### Phase 5: Dọn dẹp và khóa chất lượng

- [ ] **T14 – Gỡ Tailwind** (S–M). Xóa `@import 'tailwindcss'`, `tw-animate-css`, khối shadcn trong `globals.css`; xóa luật turbopack trong `next.config.ts`; gỡ `tailwindcss`, `@tailwindcss/turbopack`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css` khỏi `apps/web/package.json`; `lib/utils.ts` chỉ `clsx`; `pnpm install` cập nhật lockfile.
- [ ] **T15 – Khóa ràng buộc §7.1 bằng test** (S). Thêm test Vitest quét `src/**/*.css` và `*.tsx`: cấm `preserve-3d`, `perspective`, `translateZ`, `background-attachment: fixed`, `transition: all`, `backdrop-filter` trong `.modal-overlay`/sheet backdrop; cấm emoji trong JSX (nếu khả thi); cấm màu `#ff0000/#00ff00/#0000ff`.
- [ ] **T16 – Nghiệm thu cuối (Pre-Delivery Checklist §11)** (M). Chạy `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; duyệt thủ công đủ màn hình × dark/light × 375/768/1024/1440; kiểm tra tương phản AA, tab bàn phím, reduced-motion, không tràn ngang.

**Checkpoint cuối:** tất cả tiêu chí đạt, trình người dùng duyệt trước khi commit.

## Rủi ro và cách giảm

| Rủi ro                                                                                                       | Mức        | Cách giảm                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Trạng thái pha trộn (một phần Tailwind, một phần CSS thuần) làm giao diện xấu tạm thời giữa T2–T13           | Trung bình | Làm trên một nhánh, đóng gói theo thứ tự trên, duyệt thị giác ở Checkpoint A/B/C; mỗi task vẫn qua typecheck/lint/build |
| Trùng tên biến (`--muted`, `--border`, `--radius-*`) giữa shadcn và DS                                       | Trung bình | T2 xóa dần biến shadcn khi component tương ứng chuyển xong; T14 xóa hẳn                                                 |
| Radix portal (Dialog/Select/Dropdown) không nằm trong cây DOM của trang → CSS phải toàn cục và thừa kế theme | Thấp       | Token đặt ở `:root`, không phụ thuộc cha; kiểm tra thủ công mỗi portal ở cả hai theme                                   |
| Mất tính năng của tiện ích Tailwind (`has-[>svg]`, `group`, responsive prefix)                               | Thấp       | Viết lại bằng `:has()`, container/media query trong CSS thuần                                                           |
| Ảnh nền nặng làm chậm LCP                                                                                    | Thấp       | Kiểm tra dung lượng ở T1, nén nếu > ~500KB; ảnh vẽ một lần ở `body::before`                                             |
| Tương phản chữ trên ảnh nền                                                                                  | Thấp       | Nội dung nằm trên `--panel`; chữ trực tiếp trên nền dùng `--canvas-text` như DS; kiểm tra ở T16                         |

## Cách kiểm chứng toàn bộ

1. `pnpm --filter @kiot/web typecheck`, `lint`, `test`, `build` (và `pnpm lint/typecheck/test/build` ở gốc).
2. `pnpm dev`, mở web bằng Browser pane: đăng nhập (tài khoản dev từ seed), duyệt Người dùng, Vai trò, các trang `ComingSoon`; chuyển Dark/Light; thu nhỏ 375px kiểm tra ngăn kéo menu; dùng bàn phím Tab qua form/modal.
3. `grep` không còn `tailwind`, `cva(`, `twMerge` trong `apps/web`; test T15 xanh.
4. So sánh thị giác với `design-system` (token, bo góc, bóng, phông) qua ảnh chụp ở 4 độ rộng.

## Câu hỏi còn mở (không chặn việc bắt đầu)

- Có muốn thêm hiệu ứng `motion.js` (§6) và starfield 404 ở một lượt sau không?
- Danh sách vai trò trong `@kiot/shared` có tên khác DS (vd. `manager`, `accountant`…) — sẽ map màu ở T12 và báo lại nếu có vai trò không khớp.
