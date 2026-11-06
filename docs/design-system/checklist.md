# Checklist cho PR giao diện

Copy khối này vào mô tả PR và tick. Mục nào không áp dụng thì ghi "n/a" kèm lý do ngắn. Chi tiết từng mục: [tokens.md](tokens.md), [components.md](components.md), [list-page.md](list-page.md).

```md
### Giao diện
**Token và CSS**
- [ ] Mọi màu/bóng/khoảng cách/bo góc dùng `var(--…)`; không hex thô mới (màu mới = token ở CẢ dark và light)
- [ ] Không Tailwind/`@apply`, không `style={{…}}` cho màu hoặc khoảng cách; CSS mới nằm trong `styles/components/*.css` và đã `@import` ở `styles/components.css`
- [ ] Không `transition: all` (liệt kê thuộc tính), không 3D (`perspective`, `translateZ`, `rotateX/Y`), không `background-attachment: fixed`
- [ ] Không `backdrop-filter` ngoài `.app-header` / `.auth-card`; overlay chỉ dùng `--overlay-bg`
- [ ] Mọi cỡ chữ >= 12px
- [ ] Hover thẻ/dòng chỉ đổi nền/viền/bóng, không `transform`
- [ ] `pnpm --filter @kiot/web test` xanh (có `design-constraints`); `lint`, `typecheck` xanh

**Component**
- [ ] Dùng component có sẵn (Button, Badge/StatusBadge, Field, Dialog/ConfirmDialog, Sheet, DataTable…), không dựng lại bằng thẻ thô
- [ ] Trạng thái hiển thị bằng `StatusBadge` / `Badge` (biến thể đúng nghĩa); KHÔNG viết `<span className="badge …">`
- [ ] Nút: một nút chính (`default`) mỗi vùng; nút trong `<form>` không submit đặt `type="button"`; nút đang chạy bị `disabled` + `.spinner`
- [ ] Xóa/hủy/khóa/đặt lại đi qua `ConfirmDialog` (không `window.confirm`, không tự dựng `AlertDialog` rồi đóng trước khi biết kết quả)
- [ ] Thông báo sau thao tác dùng `toast` (Sonner); lỗi tải dữ liệu dùng `.alert .alert-error` (kèm "Thử lại" nếu có thể)

**Trợ năng**
- [ ] Nút chỉ có icon có `aria-label` tiếng Việt (và `title` nếu cần); icon trang trí có `aria-hidden="true"`
- [ ] Mọi ô nhập có nhãn (`Field`/`Label htmlFor`, hoặc `aria-label` với ô trong toolbar/dòng); lỗi nối bằng `aria-invalid` + `aria-describedby="<id>-error"`; `Field` hiện lỗi bằng `role="alert"`
- [ ] Focus nhìn thấy được (không `outline: none` mà thiếu thay thế); thao tác được hoàn toàn bằng bàn phím: Tab, Enter/Space, Esc đóng hộp thoại; thứ tự Tab hợp lý
- [ ] Hộp thoại/ngăn kéo có tiêu đề (`DialogTitle`/`SheetTitle`); bảng có tiêu đề cột; cột đang sắp xếp có `aria-sort`
- [ ] Số kết quả/trạng thái động nằm trong vùng `aria-live="polite"` hoặc `role="status"`
- [ ] Không dùng màu làm tín hiệu duy nhất (kèm chữ/icon); tương phản chữ đủ ở cả hai theme
- [ ] Không emoji (kể cả trong chú thích/chuỗi) — dùng Lucide
- [ ] `id` của ô nhập có tiền tố riêng theo màn hình (vd. `uf-username`, `pf-code`) vì Next.js giữ trang trước trong DOM

**Responsive và theme**
- [ ] Đã xem ở 375px, 768px, >= 1280px: không cuộn ngang cả trang; bảng cuộn ngang TRONG khung của nó
- [ ] Ô bấm >= 44px trên cảm ứng (dùng `.btn`, `.form-input`… đã có media query; tự dựng phần tử bấm thì thêm `@media (pointer: coarse)`)
- [ ] Đã xem ở dark VÀ light (nút đổi theme trên thanh trên); không có chữ "chìm" hoặc nền trắng cứng ở dark
- [ ] Đã thử tắt animation (`prefers-reduced-motion`) — không mất chức năng

**Nội dung**
- [ ] Mọi chữ hiển thị là tiếng Việt có dấu: nhãn, placeholder, trạng thái rỗng, lỗi, `aria-label`, `title`
- [ ] Tiền/số lượng đi qua `formatMoney` / `formatDecimal`, cột số canh phải (`.num`); ngày giờ qua `formatDate` / `formatDateTime`
- [ ] Nút/menu/cột nhạy cảm ẩn theo `can(me, '<mã quyền>')` (không theo vai trò); cột giá vốn chỉ khi có `product.cost.view`; dữ liệu có phạm vi `own` đã được server lọc

**Trang danh sách** (bỏ qua nếu không phải trang danh sách)
- [ ] Theo [list-page.md](list-page.md): `PageHeader` → `TableToolbar` → `DataTable` → `Pagination`
- [ ] `useTablePrefs('<tableKey>', columns)` với `tableKey` đúng quy tắc; mọi cột có `meta.label`; cột định danh (mã/tên) `locked`
- [ ] KHÔNG `PAGE_SIZE`/`limit: 20` cứng: `limit` = `list.pageSize` (từ `useTablePrefs`); `Pagination` truyền `pageSize` + `onPageSizeChange` để hiện "Số dòng/trang"
- [ ] `<DataTable prefs={prefs} />` và `<ColumnPicker prefs={prefs} />`; không còn `useColumnVisibility` / `resizable` / `columnLabels` / `hiddenColumns` cũ
- [ ] Đổi bộ lọc / tìm kiếm / sắp xếp / cỡ trang đều về trang 1 (dùng `useListState`)
- [ ] Cột sắp xếp: `meta.sort: 'server'` chỉ cho cột server hỗ trợ (`docs/api/endpoints.md`), cột còn lại `'page'` kèm `sortHint`
- [ ] Đủ ba trạng thái: skeleton khi tải, `emptyText` rõ ràng khi rỗng, `.alert-error` khi lỗi
- [ ] Xuất Excel dùng đúng bộ lọc + sắp xếp đang hiển thị; tùy chọn cột xuất đã lọc theo quyền
- [ ] Truy vấn dữ liệu theo chi nhánh có `branchId` trong query key (tồn, giá vốn, công nợ…)
```
