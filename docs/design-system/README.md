# Design system Tokosi (apps/web)

Tài liệu chuẩn cho giao diện quản trị `apps/web`. **Từ nay đây là nguồn duy nhất**: các chú thích `MASTER mục x.y` trong mã trỏ tới một file ngoài repo (không còn truy cập được) — coi là di sản, đừng thêm chú thích mới kiểu đó, hãy trỏ tới file trong thư mục này.

Khi tài liệu và mã khác nhau: **mã là sự thật**, sửa tài liệu trong cùng PR.

## Nguyên tắc

1. **CSS thuần theo token. KHÔNG Tailwind, KHÔNG shadcn/cva.** Lớp CSS nằm ở `apps/web/src/styles/`; component React (`components/ui/*`) chỉ ánh xạ prop sang tên lớp (`btn btn-primary`, `badge badge-success`…) bằng `cn()` (`lib/utils.ts`, chỉ là `clsx`). Dùng Radix cho hành vi (Dialog, Select, Tabs, Dropdown…) và Sonner cho toast.
2. **Dark Obsidian là mặc định**, Light là phương án thứ hai. Mọi màu/bóng/viền đi qua token `var(--…)`; mọi giao diện mới phải đẹp ở cả hai theme (`data-theme` trên `<html>`, do `next-themes` đặt).
3. **Thương hiệu "Tokosi"**: chữ tiêu đề Be Vietnam Pro, nội dung Inter, số liệu Roboto (`--font-display/body/data`).
4. **Tiếng Việt có dấu** cho mọi chữ hiển thị (nhãn, lỗi, `aria-label`, placeholder). Ngày giờ hiển thị theo `Asia/Ho_Chi_Minh` qua `lib/format.ts`.
5. **Tiền/số lượng là chuỗi thập phân**: hiển thị bằng `formatMoney` / `formatDecimal`, không đổi sang `number` để cộng (xem `apps/web/README.md`).
6. **Ẩn/hiện theo quyền, không theo vai trò**: `can(me, 'mã.quyền')` (`lib/permissions.ts`).
7. **Không dùng emoji làm icon**: dùng SVG Lucide (`lucide-react`) và gắn `aria-hidden="true"` nếu chỉ để trang trí.
8. **Tiêu đề cột của mọi bảng luôn căn giữa**: áp dụng cho `DataTable`, bảng tĩnh, bảng gọn, bảng phân quyền và cả cột số/thao tác. Nhãn sắp xếp phải nằm giữa cột, biểu tượng có khoảng trống đối xứng để không làm lệch nhãn. Nội dung ô dữ liệu căn theo loại dữ liệu; tiền/số lượng vẫn căn phải.

## Ràng buộc cứng (có test)

`apps/web/src/styles/design-constraints.test.ts` quét **mọi** `.css`, `.ts`, `.tsx` dưới `apps/web/src` (trừ `*.test.ts`) và làm CI thất bại nếu vi phạm. Chạy riêng: `pnpm --filter @kiot/web exec vitest run design-constraints` (hoặc cả bộ: `pnpm --filter @kiot/web test`).

| #   | Ràng buộc                                                                                                              | Phạm vi quét        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Không `transform-style: preserve-3d`                                                                                   | CSS                 |
| 2   | Không `perspective`                                                                                                    | CSS                 |
| 3   | Không biến đổi 3D (`translateZ`, `rotateX`, `rotateY`, `translate3d`) — `translateY/translate/rotate` 2D thì được     | CSS                 |
| 4   | Không `background-attachment: fixed` (ảnh nền đã vẽ một lần ở `body::before`)                                          | CSS                 |
| 5   | Không `transition: all` — liệt kê từng thuộc tính (`transition: background-color 150ms ease, color 150ms ease`)        | CSS                 |
| 6   | `backdrop-filter` **chỉ** ở selector đúng `.app-header` và `.auth-card`; không bao giờ ở overlay/modal/popover         | CSS                 |
| 7   | Không `font-size` dưới **12px** (khai báo bằng `px`; đừng lách bằng `rem`/`em`)                                         | CSS                 |
| 8   | Không màu thô `#ff0000`, `#00ff00`, `#0000ff`                                                                          | CSS + TS/TSX        |
| 9   | Các token bắt buộc phải có ở **cả** khối dark (`:root`) và khối light (`:root[data-theme='light']`), xem danh sách dưới | `tokens.css`        |
| 10  | Không chuỗi `tailwind`, `@apply`, `tw-animate` (không phân biệt hoa/thường, **kể cả trong chú thích**)                  | CSS + TS/TSX        |
| 11  | Không ký tự emoji/biểu tượng (`\p{Extended_Pictographic}`) trong `.ts/.tsx`, **kể cả trong chú thích và chuỗi**         | TS/TSX              |

Token bắt buộc đủ cặp sáng/tối (ràng buộc 9): `--bg --panel --panel-2 --panel-3 --border --primary --text --text-secondary --muted --amber --green --red --overlay-bg --alert-error-bg --toast-success-bg --bg-image`. Test cắt `tokens.css` tại đúng chuỗi `:root[data-theme='light']` (nháy đơn) — giữ nguyên cách viết đó.

Các quy ước khác không có test nhưng bắt buộc (xem [checklist.md](checklist.md)): hover thẻ không dùng `transform`; overlay chỉ là màu đặc `--overlay-bg`; ô bấm tối thiểu 44px trên cảm ứng; ô nhập 16px trên cảm ứng (chống iOS tự phóng to); tôn trọng `prefers-reduced-motion` (đã có ở `base.css`).

## Cấu trúc `apps/web/src/styles/`

```
app/globals.css            @import theo thứ tự: tokens → base → components → layout
styles/tokens.css          biến CSS: dark (:root) + light (:root[data-theme='light'])
styles/base.css            reset, typography, nền, :focus-visible, .tabular, .sr-only
styles/components.css      DANH SÁCH @import các file trong components/
styles/components/*.css    button, badge, form, popover, card, table, modal, screens,
                           product-workspace, purchasing
styles/layout.css          khung ứng dụng, thanh bên, .page/.page-header, .toolbar, .alert,
                           .empty-state, .spinner, xác thực/404
```

## Thêm component / CSS mới

1. **Cần một component React mới?** Đặt ở `components/ui/` (nguyên tố dùng khắp nơi, ánh xạ prop → lớp) hoặc `components/common/` (ghép từ nguyên tố, có nghiệp vụ nhẹ) hoặc `components/data-table/` (bảng/toolbar/phân trang). Dùng `cn()` để ghép lớp; không viết `style={{…}}` cho màu/khoảng cách.
2. **Cần lớp CSS mới?**
   - Thêm vào file sẵn có nếu cùng họ (nút → `button.css`, bảng → `table.css`…).
   - Họ mới → tạo `styles/components/<ten>.css` và **thêm `@import './components/<ten>.css';` vào `styles/components.css`** (đây là cách duy nhất để CSS được nạp).
   - CSS riêng của một màn hình nghiệp vụ: đặt tiền tố theo màn hình (`.purchase-…`, `.product-…`) để không đụng lớp dùng chung.
3. **Chỉ dùng token**: màu `var(--panel)`, khoảng cách `var(--space-lg)`, bo góc `var(--radius-md)`… Cần màu/bóng mới → thêm token ở **cả hai** theme trong `tokens.css` (xem [tokens.md](tokens.md)). Màu trong suốt dựng từ kênh RGB: `rgba(var(--primary-rgb), 0.14)`.
4. Trạng thái `hover/focus/disabled/active` đầy đủ; `transition` chỉ liệt kê thuộc tính; ngắt đoạn responsive bằng `@media (max-width: 760px)` / `(pointer: coarse)` như các file hiện có.
5. Chạy `pnpm --filter @kiot/web test` (có `design-constraints`), `lint`, `typecheck` trước khi mở PR; đi qua [checklist.md](checklist.md).

## Mục lục

| File                                 | Nội dung                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [tokens.md](tokens.md)               | Nhóm token (nền, thương hiệu, chữ, trạng thái, khoảng cách, bo góc, font, bóng, chuyển động), cách dùng |
| [list-page.md](list-page.md)         | **Mẫu trang danh sách chuẩn** (rút từ trang Hàng hóa) + danh sách màn còn lệch                       |
| [components.md](components.md)       | Button, Badge/StatusBadge, Form/Field, Dialog, Sheet, Toast, bảng tĩnh, trạng thái trống, lớp tiện ích |
| [checklist.md](checklist.md)         | Danh sách tick cho mọi PR giao diện                                                                  |

## Quy tắc trang danh sách

**Mọi trang danh sách mới (và khi sửa lớn trang cũ) PHẢI theo [list-page.md](list-page.md):** `PageHeader` → `TableToolbar` → `DataTable` (có `prefs` từ `useTablePrefs`) → `Pagination` có chọn cỡ trang; bộ lọc/sắp xếp/trang gói trong `useListState`; không hard-code `PAGE_SIZE`/`limit: 20`; trạng thái bằng `StatusBadge`, không viết `<span className="badge …">`.

## Ánh xạ chú thích "MASTER" cũ

Suy ra từ chú thích trong mã, để tra khi gặp:

| Chú thích trong mã            | Nay xem                                       |
| ----------------------------- | --------------------------------------------- |
| MASTER 4, 4.2, 4.4b           | [tokens.md](tokens.md) (token, font, bóng)    |
| 5.1 nút · 5.2 thẻ             | [components.md](components.md) mục Button, Card |
| 5.3, 5.6 huy hiệu, vai trò    | [components.md](components.md) mục Badge      |
| 5.4, 5.12 biểu mẫu            | [components.md](components.md) mục Form       |
| 5.5 bảng, ô bấm 44px          | [list-page.md](list-page.md), [components.md](components.md) |
| 5.7 hộp thoại · 5.8 toast     | [components.md](components.md)                |
| 5.9, 5.10, 5.14 khung, xác thực, lưới | `styles/layout.css`                   |
| 5.16 nháy dòng vừa cập nhật   | `.row-highlight-update` trong `table.css`     |
| 6.2, 7.1, 7.2, 10             | Bảng "Ràng buộc cứng" ở trên                  |
