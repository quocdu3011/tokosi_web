# Token

Nguồn: `apps/web/src/styles/tokens.css`. Khối `:root` là **dark (mặc định)**; khối `:root[data-theme='light'], [data-theme='light']` ghi đè cho light. Selector thứ hai cho phép "ép sáng" cục bộ một khung (thẻ đăng nhập, 404) bằng `data-theme="light"` trên chính phần tử đó.

Quy tắc chung:

- Trong CSS luôn viết `var(--tên)`. Không chép giá trị hex/px của token vào nơi khác.
- Token **không** khai báo lại ở khối light thì thừa hưởng giá trị dark — chỉ để cho token không phụ thuộc theme (`--space-*`, `--radius-*`, `--ease-out`, `--primary-text`, `--shadow-rgb`…).
- Thêm token màu/bóng mới → khai báo ở **cả hai** khối; token thuộc danh sách bắt buộc trong [README.md](README.md) được test kiểm tra đủ cặp.
- Màu trong suốt: dựng từ kênh RGB, không đổi sang hex mới. `background: rgba(var(--primary-rgb), 0.14);`

## Nền và bề mặt

| Token                        | Dark → Light (gần đúng)     | Dùng khi                                                                                                   |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--bg`                       | `#090d16` → `#f8fafc`       | Nền trang (dưới ảnh nền; chỉ `base.css` dùng). Không dùng trực tiếp trong component.                       |
| `--panel`                    | `#111827` → `#ffffff`       | Bề mặt chính: thẻ, bảng, hộp thoại, ngăn kéo, popover, thanh bên.                                          |
| `--panel-2`                  | `#1e293b` → `#f1f5f9`       | Bề mặt lồng trong panel: ô nhập, tiêu đề bảng, hàng hover, khối phụ (`.branch-card`, `.secret-box`).       |
| `--panel-3`                  | `#334155` → `#e2e8f0`       | Lớp thứ ba: hover của `--panel-2`, skeleton, thanh cuộn, vạch tay nắm.                                     |
| `--border`                   | `#26334d` → `#e2e8f0`       | Viền thẻ/ô nhập/bảng, đường phân cách chính.                                                               |
| `--border-subtle`            | trắng 6% → `#f1f5f9`        | Viền rất nhẹ (dự phòng, hiện chưa có chỗ dùng).                                                            |
| `--border-focus`             | `#3b82f6` → `#2563eb`       | Viền ô nhập khi focus, outline phần tử bấm được.                                                           |
| `--surface-hover`            | trắng 4% → xám đậm 4%       | Nền hover của phần tử trong suốt (nút ghost, mục menu, dòng liên kết).                                     |
| `--row-divider`              | trắng 5% → xám đậm 6%       | Kẻ ngang/dọc giữa các dòng, cột của bảng.                                                                  |
| `--overlay-bg`               | đen 60% → đen 45%           | Nền mờ sau hộp thoại/ngăn kéo. **Màu đặc, không `backdrop-filter`.**                                       |
| `--glass-bg`, `--glass-border` | panel 75% / trắng 8%      | Chỉ cho `.app-header` (nơi duy nhất được `backdrop-filter`).                                               |
| `--bg-image`                 | `/bg-dark.jpg` → `/bg-light.jpg` | Ảnh nền, vẽ một lần ở `body::before`.                                                                 |

Chữ nằm **trực tiếp trên ảnh nền** (ngoài mọi panel: tiêu đề trang, mô tả trang, số kết quả, thanh phân trang) dùng `--canvas-text` / `--canvas-border`, không dùng `--text`.

## Thương hiệu và màu nhấn

| Token                                             | Dùng khi                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--primary` (+ `--primary-rgb`)                   | Màu thương hiệu xanh dương: mục menu đang chọn, tích checkbox, liên kết, viền thẻ khi hover.                   |
| `--primary-gradient`, `--primary-hover`           | Nền nút chính (`.btn-primary`) và trạng thái hover. Không dùng cho vùng lớn.                                   |
| `--primary-text`                                  | Chữ trên nền primary (trắng).                                                                                  |
| `--primary-shadow`, `--primary-shadow-hover`      | Bóng của nút chính.                                                                                            |
| `--amber`                                         | Cảnh báo, cột đang sắp xếp, ô đã sửa chưa lưu, thanh lưu thay đổi.                                             |
| `--green`                                         | Thành công, đang hoạt động.                                                                                    |
| `--red`                                           | Lỗi, nguy hiểm, giá trị thấp (`.stock-low`), viền ô `aria-invalid`.                                            |
| `--blue`                                          | Thông tin (huy hiệu `info`), tay nắm kéo cột khi hover.                                                        |
| `--purple`                                        | Dự phòng, hiện chưa có chỗ dùng (vai trò Quản lý dùng bộ `--role-quan-ly-*`).                                  |
| `--amber-contrast-text`, `--green-contrast-text`  | Chữ đặt **trên nền đặc** màu amber/green (dự phòng, hiện chưa có chỗ dùng).                                    |
| `--accent-blue-12`, `--accent-blue-18`            | Nền xanh nhạt: mục menu active, tab active, thẻ radio được chọn, nháy dòng vừa cập nhật.                       |

Quy tắc: màu nhấn truyền **ý nghĩa** (xanh = tốt, vàng = chú ý, đỏ = hỏng/nguy hiểm, xanh dương = thông tin) — không dùng chỉ để trang trí, và **không dùng màu làm tín hiệu duy nhất** (luôn kèm chữ hoặc biểu tượng).

Kênh RGB để tạo bóng/glow/nền trong suốt: `--primary-rgb`, `--glow-green-rgb`, `--glow-red-rgb`, `--glow-amber-rgb`, `--shadow-rgb`.

## Văn bản

| Token              | Dark → Light            | Dùng khi                                                           |
| ------------------ | ----------------------- | ------------------------------------------------------------------ |
| `--text`           | `#f8fafc` → `#0f172a`   | Chữ chính, nội dung ô bảng, tiêu đề.                               |
| `--text-secondary` | `#cbd5e1` → `#334155`   | Nhãn trường, tiêu đề cột, mục menu chưa chọn.                      |
| `--muted`          | `#94a3b8` → `#64748b`   | Mô tả phụ, placeholder, gợi ý (`.field-hint`), icon phụ, `.muted`. |
| `--canvas-text`    | trắng → đen             | Chữ trực tiếp trên ảnh nền (xem trên).                             |

Cỡ chữ: thân `14px` (`body`), bảng `13px`, tiêu đề cột `12px` hoa, nhãn phụ `12–12.5px`. **Không dưới 12px.** Tiêu đề: `h1` 24px, `h2` 19px, `h3` 15px (đã có trong `base.css`, đừng đặt lại cỡ chữ cục bộ nếu không cần).

## Trạng thái

| Nhóm token                                                | Dùng ở                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `--alert-{warning,error,success}-{bg,border}`             | Hộp `.alert-warning`, `.alert-error`, `.alert-success`; nền ô lỗi (`cell-edit`).        |
| `--toast-{success,error}-{bg,fg,border}`                  | Toast Sonner (map trong `components/ui/sonner.tsx`).                                    |
| `--status-{active,locked,pending,inactive}-bg`            | Nền viên thuốc `.status-*` và lựa chọn trạng thái (`.product-status`).                  |
| `--role-<slug>-{bg,fg,border}`                            | Huy hiệu vai trò (`RoleBadge`); mỗi vai trò một bộ ba token + một lớp `.role-<slug>`.   |

Huy hiệu trạng thái nghiệp vụ **không** dùng riêng `--status-*`; dùng `Badge`/`StatusBadge` với biến thể `success | warning | destructive | info | secondary` (xem [components.md](components.md)). Thêm vai trò mới → thêm đủ bộ ba token ở cả hai theme + lớp `.role-<slug>` ở `badge.css` + khai báo trong `components/common/role-badge.tsx`.

## Khoảng cách (lưới 4/8)

| Token         | Giá trị | Dùng cho                                              |
| ------------- | ------- | ----------------------------------------------------- |
| `--space-xs`  | 2px     | Khe cực nhỏ (giữa các nút icon trong ô thao tác).     |
| `--space-sm`  | 4px     | Khe trong huy hiệu, nhóm nhỏ.                         |
| `--space-md`  | 8px     | **Khe mặc định** giữa các phần tử cùng hàng (toolbar, nhóm nút). |
| `--space-lg`  | 12px    | Khe trong khối (trường biểu mẫu trong ngăn xếp), padding khối phụ. |
| `--space-xl`  | 16px    | Khe giữa các khối trong thẻ/ngăn kéo; padding nội dung trang (mobile). |
| `--space-2xl` | 24px    | **Khe giữa các phần của trang** (`.page`), padding hộp thoại, nội dung trang (desktop). |
| `--space-3xl` | 32px    | Khoảng thở lớn giữa các cụm.                          |

Dùng token thay vì số px trần trong CSS mới. (Một số file cũ như `product-workspace.css` còn px trần; đừng bắt chước.)

## Bo góc

`--radius-xs` 6px (menu item, skeleton) · `--radius-sm` 8px (**nút, ô nhập**, alert) · `--radius-md` 10px (popover, thẻ con) · `--radius-lg` 12px (**thẻ, bảng**) · `--radius-xl` 14px (**hộp thoại**, empty-state) · `--radius-2xl` 20px (thẻ đăng nhập) · `--radius-pill` (huy hiệu, spinner, nút tròn).

Phần tử lồng nhau: bo góc của phần tử trong ≤ bo góc của phần tử ngoài.

## Font

| Token            | Phông                | Dùng cho                                                      |
| ---------------- | -------------------- | ------------------------------------------------------------- |
| `--font-display` | Be Vietnam Pro       | Tiêu đề (`h1–h4`, `.modal-title`, `.card-title`), nút chính.  |
| `--font-body`    | Inter                | Mặc định cho thân trang, nút, ô nhập, bảng.                   |
| `--font-data`    | Roboto               | **Số liệu**: tiền, số lượng, mã, ngày giờ.                    |

Số liệu dùng lớp tiện ích `.tabular` (phông dữ liệu + `tabular-nums`, trong `base.css`) hoặc `.num` (canh phải, trong `screens.css`) — xem [components.md](components.md) mục lớp tiện ích. Phông được nạp bằng `next/font` ở `app/layout.tsx` và gán vào các biến `--font-be-vietnam/inter/roboto`.

## Bóng

| Token                                  | Dùng cho                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| `--card-shadow`                        | Thẻ, bảng (`.data-table-frame`), thẻ KPI, thẻ đăng nhập.           |
| `--shadow-modal`                       | Hộp thoại, ngăn kéo, popover/select/menu.                           |
| `--shadow-toast`                       | Toast.                                                              |
| `--shadow-focus-blue`                  | **Vòng focus toàn cục** (`:focus-visible` trong `base.css`).        |
| `--shadow-focus-input`                 | Focus của ô nhập/select.                                            |
| `--shadow-brand`                       | Ô logo.                                                             |

Không tự chế `box-shadow` mới trong component; nếu thật sự cần thì thêm token.

## Chuyển động

- Một đường cong chung: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` cho thứ **xuất hiện/di chuyển** (popover 160ms, hộp thoại 200ms, ngăn kéo 240ms). Đổi màu/viền dùng `150ms ease`; hover dòng bảng `100ms`.
- `transition` chỉ liệt kê thuộc tính cụ thể (`transition: background-color 150ms ease, color 150ms ease`). **Cấm `transition: all`.**
- Chỉ biến đổi 2D (`translateY`, `translateX`, `rotate`); hover nút được nhích `translateY(-1px)`, **hover thẻ không dùng transform**.
- `prefers-reduced-motion: reduce` đã được xử lý toàn cục ở `base.css` (rút animation/transition về ~0): đừng thêm animation mà thiếu hiệu ứng này, đừng gắn logic phụ thuộc vào việc animation kết thúc.

## Bố cục

`--sidebar-w: 240px` (thu gọn còn 56px ở ≥1024px) · `--header-h: 56px`. Điểm ngắt đang dùng: `1024px` (hiện thanh bên), `768px` (đệm nội dung 24px), `760px` (ô bấm 44px, ô nhập 16px, lưới 12 cột → 1 cột), `640px` (biểu mẫu 2 cột, hộp thoại xếp ngang).
