# Component

Mọi component ở `apps/web/src/components/`. Nguyên tố (`ui/`) chỉ ánh xạ prop → lớp CSS trong `src/styles/components/`; tên lớp dưới đây là tên thật. Token xem [tokens.md](tokens.md), mẫu trang danh sách xem [list-page.md](list-page.md).

## Button

`components/ui/button.tsx` → `styles/components/button.css`.

| `variant`     | Lớp           | Dùng khi                                                                                          |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `default`     | `btn-primary` | **Hành động chính** của vùng (Thêm…, Lưu, Xác nhận). Tối đa MỘT mỗi vùng (header trang / hộp thoại). |
| `outline`     | `btn-secondary` | Nút phụ có viền: Hủy, Nhập Excel, Xuất Excel, Cột, Bộ lọc, Đóng.                                |
| `secondary`   | `btn-secondary` | Giống `outline` (alias). Dùng `outline` cho nhất quán.                                          |
| `ghost`       | `btn-ghost`   | Nút ít nhấn mạnh, nút icon trong ô thao tác của bảng.                                             |
| `destructive` | `btn-danger`  | Xóa/hủy/khóa. Thường chỉ xuất hiện trong `ConfirmDialog`.                                         |
| `link`        | `btn-link`    | Liên kết chữ gạch chân trong đoạn văn (cao 0). Mở chi tiết từ ô bảng xem [list-page.md](list-page.md). |

| `size`    | Kích thước                       |
| --------- | -------------------------------- |
| `default` | cao 40px                         |
| `sm`      | cao 36px, chữ 13px (trong toolbar, ô bảng, phân trang) |
| `lg`      | cao 44px                         |
| `icon`    | vuông 40px (chỉ icon)            |

Trên cảm ứng hoặc <= 760px mọi nút tự cao tối thiểu 44px.

```tsx
import { Plus, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

<Button onClick={() => setDrawer({ kind: 'create' })}>
  <Plus aria-hidden="true" /> Thêm hàng hóa
</Button>

<Button variant="outline" size="sm" onClick={reset}>Mặc định</Button>

{/* Nút chỉ có icon: BẮT BUỘC aria-label (và title nếu muốn tooltip) */}
<Button variant="ghost" size="icon" aria-label={`Sửa ${u.username}`} title="Sửa" onClick={…}>
  <Pencil />
</Button>

{/* Nút gửi biểu mẫu đang chạy: khóa + spinner (chống bấm đúp) */}
<Button type="submit" disabled={isSubmitting}>
  {isSubmitting && <span className="spinner" aria-hidden="true" />}
  Lưu
</Button>

{/* Liên kết Next trông như nút */}
<Link href="/products" className={buttonVariants({ variant: 'outline' })}>Về danh sách</Link>
```

Quy tắc: `<button>` trong `<form>` mà không phải nút gửi thì đặt `type="button"` (mặc định là `submit`). Icon con tự co về 16px theo CSS — không đặt `width/height`. Nút bị `disabled` mờ 50%, không nhích khi hover.

## Badge, StatusBadge và vai trò

`components/ui/badge.tsx` → `styles/components/badge.css`.

| `Badge variant`         | Lớp CSS          | Nghĩa                                              |
| ----------------------- | ---------------- | -------------------------------------------------- |
| `success`               | `badge-success`  | Tốt: đang hoạt động, hoàn thành, đã đủ             |
| `warning`               | `badge-warning`  | Cần chú ý: chờ xử lý, một phần, sắp hết            |
| `destructive`           | `badge-danger`   | Hỏng/chặn: đã hủy, bị khóa, ngừng kinh doanh, lỗi  |
| `info` (= `default`)    | `badge-info`     | Thông tin/phân loại: đã xác nhận, Combo, mặc định  |
| `secondary` (= `outline`) | `badge-neutral` | Trung tính: phiếu tạm, chưa có, ngừng giao dịch    |

**Cấm viết `<span className="badge badge-…">` thô** (hiện còn ở `suppliers-screen.tsx` và `PurchaseStatus` trong `purchase-ui.tsx` — cần chuyển). Lý do: mất kiểm soát ánh xạ trạng thái → màu, mỗi màn một kiểu. Trạng thái nghiệp vụ dùng **`StatusBadge`**; nhãn phân loại không phải trạng thái (Combo, chi nhánh mặc định) dùng `Badge` với biến thể đúng nghĩa.

**`StatusBadge`** (`components/common/status-badge.tsx`) nhận `tone` theo NGHĨA (khớp `.badge-success|warning|danger|info|neutral`), không theo tên biến thể của `Badge`:

| `tone`    | Nghĩa                                          | = `Badge variant` |
| --------- | ---------------------------------------------- | ----------------- |
| `success` | Hoàn tất / đang hoạt động                      | `success`         |
| `warning` | Cần chú ý / chờ xử lý                          | `warning`         |
| `danger`  | Hủy / lỗi / ngừng / bị khóa                    | `destructive`     |
| `info`    | Đã xác nhận / đang xử lý                       | `info`            |
| `neutral` | Nháp / không xác định (mặc định)               | `secondary`       |

```tsx
import { ACTIVE_STATUS_TONES, DOCUMENT_STATUS_TONES, StatusBadge, statusTone } from '@/components/common/status-badge';

<StatusBadge tone="success">Hoàn thành</StatusBadge>

{/* Danh mục hoạt động / ngừng: hàng hóa, nhà cung cấp, tài khoản… */}
<StatusBadge tone={ACTIVE_STATUS_TONES[item.isActive ? 'active' : 'inactive']}>
  {item.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
</StatusBadge>

{/* Chứng từ: draft | confirmed | completed | cancelled; mã lạ → neutral */}
<StatusBadge tone={statusTone(doc.status)}>{PURCHASE_STATUS[doc.status]}</StatusBadge>
```

`ACTIVE_STATUS_TONES` = `{ active: 'success', inactive: 'danger' }`; `DOCUMENT_STATUS_TONES` = `{ draft: 'neutral', confirmed: 'info', completed: 'success', cancelled: 'danger' }`; `statusTone(code, table = DOCUMENT_STATUS_TONES)` tra bảng, mã lạ trả `neutral`. Trạng thái mới của một nghiệp vụ: thêm bảng sắc thái cạnh nơi định nghĩa mã trạng thái (hoặc vào `status-badge.tsx` nếu dùng chung) rồi truyền vào `statusTone(code, TABLE)` — không rải `tone=` theo từng màn.

Bảng ánh xạ trạng thái nghiệp vụ → sắc thái:

| Nghiệp vụ          | Giá trị                      | Nhãn hiển thị         | `tone`        |
| ------------------ | ---------------------------- | --------------------- | ------------- |
| Hàng hóa, NCC, tài khoản | đang hoạt động         | Đang kinh doanh / Đang giao dịch / Hoạt động | `success` |
| Hàng hóa, NCC, tài khoản | ngừng / khóa           | Ngừng kinh doanh / Ngưng giao dịch / Đã khóa | `danger`  |
| Người dùng         | `mustChangePassword`         | Chờ đổi mật khẩu      | `warning`     |
| Phiếu mua hàng     | `draft`                      | Phiếu tạm             | `neutral`     |
| Phiếu mua hàng     | `confirmed`                  | Đã xác nhận NCC       | `info`        |
| Phiếu mua hàng     | `completed`                  | Hoàn thành            | `success`     |
| Phiếu mua hàng     | `cancelled`                  | Đã hủy                | `danger`      |
| Tình trạng nhập (đề xuất; hiện là chữ thường) | `none` / `partial` / `full` | Chưa nhập / Nhập một phần / Đã nhập đủ | `neutral` / `warning` / `success` |
| Loại hàng (không phải trạng thái) | `combo`        | Combo (`<Badge variant="info">`) | —  |

Ngoại lệ có chủ đích: `suppliers-screen.tsx` hiện NCC "Ngưng giao dịch" màu xám (`neutral`), không theo `ACTIVE_STATUS_TONES` (`danger`), vì ngừng giao dịch không phải lỗi/khóa. Màn mới có trạng thái tương tự thì chọn tone theo nghĩa nghiệp vụ.

Vai trò **không** dùng `Badge`: dùng `RoleBadge` (`components/common/role-badge.tsx`, lớp `.role-badge` + `.role-<slug>`, token `--role-*`). Nhãn "Chờ cấp quyền" cho vai trò `pending`.

Nhãn ngắn (<= 3 từ), tiếng Việt, không viết hoa toàn bộ. Huy hiệu 12px, không cắt ngắn bằng CSS.

## Form và Field

`components/common/field.tsx`, `ui/input.tsx`, `ui/select.tsx`, `ui/checkbox.tsx`, `ui/label.tsx` → `form.css`, `screens.css`.

`Field` = nhãn + điều khiển + (lỗi | gợi ý). **`Field` không tự gắn ARIA vào điều khiển**: bạn phải đặt `id` trùng, `aria-invalid` và `aria-describedby="<id>-error"`.

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyServerErrors } from '@/lib/forms';

const schema = z.object({
  code: z.string().trim().min(1, 'Nhập mã hàng').max(30, 'Mã hàng tối đa 30 ký tự'),
  type: z.enum(['goods', 'combo']),
});
type Values = z.infer<typeof schema>;

const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } =
  useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '', type: 'goods' } });

const onSubmit = handleSubmit(async (v) => {
  try {
    await save.mutateAsync(v);
    toast.success('Đã lưu thay đổi');
    onClose();
  } catch (e) {
    applyServerErrors(e, setError, ['code', 'type']); // gắn lỗi server vào ô, còn lại → toast
  }
});

<form onSubmit={onSubmit} className="form-grid" noValidate>
  <Field id="pf-code" label="Mã hàng" error={errors.code?.message} hint="Chữ, số và - _ .">
    <Input
      id="pf-code"
      aria-invalid={!!errors.code}
      aria-describedby={errors.code ? 'pf-code-error' : undefined}
      {...register('code')}
    />
  </Field>
  <Field id="pf-type" label="Loại hàng">
    <Controller control={control} name="type" render={({ field }) => (
      <Select value={field.value} onValueChange={field.onChange}>
        <SelectTrigger id="pf-type"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="goods">Hàng hóa</SelectItem>
          <SelectItem value="combo">Combo</SelectItem>
        </SelectContent>
      </Select>
    )} />
  </Field>
  <div className="form-actions span-2">
    <Button type="button" variant="outline" onClick={onClose}>Hủy</Button>
    <Button type="submit" disabled={isSubmitting}>
      {isSubmitting && <span className="spinner" aria-hidden="true" />}Lưu
    </Button>
  </div>
</form>
```

Bố cục biểu mẫu (`screens.css`):

| Lớp                       | Việc                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `.form-grid`              | Lưới 1 cột, 2 cột từ 640px; `.span-2` cho ô chiếm cả hàng                 |
| `.fieldset` + `<legend>`  | Nhóm ô (vd. chọn nhiều chi nhánh), `.check-group` + `.check-row` cho checkbox |
| `.stack-sm` / `.stack-md` | Ngăn xếp dọc, khe 8px / 12px                                              |
| `.align-end`              | Căn ô xuống đáy hàng lưới                                                 |
| `.form-actions`           | Hàng nút cuối biểu mẫu (canh phải) trong Sheet/trang; trong Dialog dùng `DialogFooter` |

Quy tắc: nhãn luôn hiện (không thay nhãn bằng placeholder); thông điệp lỗi nói cách sửa ("Nhập mã hàng", không "Không hợp lệ"); ô trong toolbar/dòng không có `Field` thì dùng `aria-label`; số tiền/số lượng nhập bằng `inputMode="decimal"` và giữ chuỗi; trên cảm ứng ô nhập tự 16px (đừng ép nhỏ hơn). `Select` đặt `aria-invalid` được trên `SelectTrigger`. Kiểm tra form lớn bằng zod + react-hook-form, quy tắc phải khớp server (server vẫn kiểm tra lại).

## Dialog, ConfirmDialog, Sheet

| Cần                                              | Dùng                                              |
| ------------------------------------------------ | ------------------------------------------------- |
| Biểu mẫu ngắn (<= ~8 ô), thông báo một lần       | `Dialog` + `DialogContent`                        |
| Xác nhận thao tác khó hoàn tác                   | `ConfirmDialog` (`components/common/confirm-dialog.tsx`) |
| Xem/sửa chi tiết một bản ghi, nhiều tab, nhiều ô  | `Sheet` bên phải (`side="right"`)                 |
| Menu điều hướng trên điện thoại                  | `Sheet` bên trái (đã có trong `AppShell`)         |

**Dialog** (`ui/dialog.tsx`): `DialogContent` rộng 480px; thêm `modal-form` (640px, biểu mẫu), `modal-lg` (720px). Luôn có `DialogTitle`; có `DialogDescription` hoặc đặt `aria-describedby={undefined}`. Nút đóng "X" tự có (`showCloseButton={false}` khi đang chạy). Nền mờ là màu đặc, **không blur**. Mẫu mount-khi-mở: render `{editing && <XDialog … onClose={() => setEditing(null)} />}` với `<Dialog open onOpenChange={(o) => !o && onClose()}>` bên trong.

**ConfirmDialog**: `onConfirm` trả Promise; lỗi → toast + **giữ hộp mở** để thử lại; thành công → tự đóng; đang chạy khóa nút và không đóng được. Đừng tự dựng `AlertDialog` + `AlertDialogAction` (Radix đóng hộp ngay khi bấm, trước khi biết kết quả — `users-screen.tsx` đang làm vậy, cần chuyển).

```tsx
{toggle && (
  <ConfirmDialog
    title={toggle.isActive ? 'Ngưng giao dịch?' : 'Mở lại giao dịch?'}
    description={<>Nhà cung cấp <b>{toggle.name}</b> sẽ …</>}
    confirmLabel="Xác nhận"
    destructive={toggle.isActive}
    onClose={() => setToggle(null)}
    onConfirm={() => save.mutateAsync({ id: toggle.id, input: { isActive: !toggle.isActive } })}
  />
)}
```

**Sheet** (`ui/sheet.tsx`): `SheetContent` mặc định là ngăn kéo hẹp `min(80%, 280px)` cho menu. Chi tiết bản ghi phải truyền lớp chiều rộng: `sheet-wide` (`min(100%, 760px)`, dùng chung), `product-workspace` (49vw), `purchase-workspace` (64vw). `SheetTitle` là bắt buộc (trợ năng). Cấu trúc chi tiết với tab xem [list-page.md](list-page.md) mục "Chi tiết". Dữ liệu theo chi nhánh → đóng Sheet khi đổi chi nhánh.

## Tabs

`ui/tabs.tsx` (Radix; phím mũi tên đúng chuẩn): `Tabs value onValueChange` → `TabsList aria-label="…"` → `TabsTrigger value` (icon `aria-hidden` + chữ) → `TabsContent value`. Lớp `tabs-list`, `tabs-trigger` (cao 44px, gạch chân khi `data-state='active'`). Tab chỉ hiện khi có quyền/điều kiện (`{debt && <TabsTrigger …/>}`); chỉ tải dữ liệu của tab khi tab đang mở (`enabled: tab === 'ledger'`).

## Toast

`sonner`, cấu hình ở `components/ui/sonner.tsx`, **đã gắn một lần** trong `AppProviders` (góc trên phải) — đừng mount `<Toaster>` thêm. Màu theo `--toast-*`.

```tsx
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';

toast.success('Đã lưu thay đổi');            // sau mutation thành công
toast.error(errorMessage(error));            // mutation thất bại không gắn được vào ô
```

Quy tắc: một thao tác một toast; câu ngắn tiếng Việt, thì quá khứ ("Đã đặt lại mật khẩu"); không emoji; lỗi **tải danh sách** dùng `.alert-error` trong trang chứ không toast; lỗi validate từng ô gắn vào ô (`applyServerErrors`), không toast; thao tác kết thúc ở màn khác (đóng hộp thoại) vẫn toast để người dùng biết đã xong.

## Hộp cảnh báo và trạng thái lỗi

`layout.css`: `.alert` + `.alert-error | .alert-warning | .alert-success`; luôn có `role="alert"` cho lỗi.

```tsx
<p className="alert alert-error" role="alert">{errorMessage(error)}</p>
```

Lỗi tải dữ liệu có thể thử lại: `QueryError` (`components/purchasing/query-feedback.tsx`, kèm nút "Thử lại" gọi `refetch`) — dùng được cho mọi danh sách.

## Trạng thái trống và đang tải

| Tình huống                              | Cách làm                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Bảng không có dòng                      | `DataTable emptyText="Không có hàng hóa phù hợp"` — nói rõ cái gì trống; nếu do bộ lọc, gợi ý nới lọc |
| Cả trang/phân hệ chưa làm / không quyền | `.empty-state` (icon 40px + `h2` + `p`): `ComingSoon`, `Forbidden` (`RequirePermission`)       |
| Đang tải bảng                           | `DataTable isLoading` → 5 dòng `Skeleton className="skeleton-line"` (không spinner toàn trang)  |
| Đang tải khối lớn (chi tiết)            | `<Skeleton className="skeleton-block" />` (cao 384px)                                          |
| Nút đang chạy                           | `.spinner` trong nút + `disabled`                                                              |
| Cổng đăng nhập / chuyển trang           | `FullPageLoader` (`role="status"`)                                                             |

`.empty-state` cho khu vực trống kèm lời mời hành động ("Chưa có nhà cung cấp. Bấm Thêm nhà cung cấp để bắt đầu") — một câu, có động từ.

## Bảng tĩnh và khi nào KHÔNG dùng `DataTable`

Dùng **`DataTable`** (`components/data-table/data-table.tsx`) cho mọi danh sách bản ghi từ API: có phân trang, sắp xếp, ẩn/hiện cột, đổi độ rộng/thứ tự cột, mở chi tiết.

Dùng **bảng tĩnh** (không prefs, không phân trang) cho dữ liệu nhỏ, có sẵn trong bộ nhớ, nằm trong chi tiết/biểu mẫu:

| Trường hợp                                   | Ví dụ                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| Dòng hàng của một chứng từ (<= vài chục dòng)| `purchase-detail.tsx`, thẻ kho `stock-card-tab.tsx`        |
| Ô nhập liệu trong dòng                       | `purchase-lines.tsx`, `component-editor.tsx` (`.mini-table`) |
| Cấu trúc đặc biệt (cột dính, hàng nhóm)       | Ma trận phân quyền `roles-screen.tsx` (`.matrix`)          |

Cách dựng — ưu tiên `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` của `components/ui/table.tsx` (tự có khung cuộn `.data-table-scroll` + tiêu đề dính), bọc ngoài bằng `<div className="data-table-frame">`. Nếu viết `<table>` thô thì bọc trong `.data-table-frame` **và** `.data-table-scroll` (khung ngoài `overflow: hidden`, thiếu lớp cuộn thì bảng rộng bị cắt trên màn hẹp; `purchase-detail.tsx` thiếu lớp này nên `purchasing.css` phải bù `.purchase-workspace .data-table-frame { overflow-x: auto }` — đừng bắt chước):

```tsx
<div className="data-table-frame">
  <div className="data-table-scroll">
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Hàng hóa</th>
          <th scope="col" className="col-numeric">Số lượng</th>
          <th scope="col" className="col-numeric">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.productId}>
            <td><span className="cell-title">{r.code}</span> <span className="cell-sub">{r.name}</span></td>
            <td className="col-numeric">{formatDecimal(r.qty)}</td>
            <td className="col-numeric">{formatMoney(r.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

Bảng nào cũng phải có **tiêu đề cột căn giữa**, gồm bảng tĩnh, bảng gọn và ma trận phân quyền. Quy tắc dùng chung nằm trong `styles/components/table.css`; không đặt căn trái/phải cho tiêu đề ở từng màn. Căn lề của nội dung ô dữ liệu độc lập với tiêu đề.

Bẫy:
- Cột số trong bảng thô: đặt `className="col-numeric"` lên `th`/`td` (phông số + tabular; chỉ `td` căn phải, `th` vẫn căn giữa). Trong `DataTable` thì dùng `<span className="num">` bên trong ô dữ liệu; tiêu đề dùng chuỗi tiếng Việt.
- **Không** đặt `.num` thẳng lên `<td>`/`<th>` của `.data-table` — `.num` là `display: block` và làm vỡ ô. Trong `.mini-table` thì `td.num`/`th.num` đã được xử lý riêng.
- Bảng thô chưa có kẻ cột, đổi độ rộng, sắp xếp — nếu cần các thứ đó, đó là dấu hiệu nên dùng `DataTable`.
- Danh sách có thể lớn/lọc/xuất file thì KHÔNG làm bảng thô.

## Thẻ, KPI, Separator

`ui/card.tsx` → `card.css`: `Card`, `CardHeader` (`CardTitle`, `CardDescription`, `CardAction`), `CardContent`, `CardFooter`. Hover thẻ chỉ đổi viền. Khối chỉ số: `.kpi-grid` + `.kpi-card` (`.kpi-label`, `.kpi-value`). `ui/separator.tsx` cho đường kẻ. Khối phụ trong thẻ/ngăn kéo: `.branch-card`, `.stat-row` (`dt` nhãn, `dd` giá trị).

## Select, menu, popover

`Select` (`ui/select.tsx`) cho lựa chọn một giá trị trong biểu mẫu. **Bộ lọc trên toolbar dùng `FilterSelect`** (`components/data-table/table-toolbar.tsx`: `label` → `aria-label`, `value`/`onChange`, `options: {value, label}[]`; chuỗi rỗng `''` = "mọi", đặt `{ value: '', label: 'Mọi trạng thái' }` làm mục đầu) — nó đã gắn `className="toolbar-select"` (rộng 176px); đừng dựng lại `Select` thô trong toolbar. `DropdownMenu` (`ui/dropdown-menu.tsx`) cho menu thao tác; mục nguy hiểm dùng `<DropdownMenuItem variant="destructive">` (lớp `menu-item-danger`). Popover có bóng `--shadow-modal`, **không** `backdrop-filter`.

## Lớp tiện ích có sẵn

| Lớp                              | Nguồn          | Việc                                                              |
| -------------------------------- | -------------- | ----------------------------------------------------------------- |
| `.tabular`                       | `base.css`     | Phông số liệu + chữ số đều (mã, ngày giờ, số kết quả)             |
| `.num`                           | `screens.css`  | Số canh phải (đặt trên `<span>` trong ô; xem bẫy ở trên)          |
| `.muted`                         | `screens.css`  | Chữ phụ `--muted`                                                 |
| `.sr-only`                       | `base.css`     | Chỉ cho trình đọc màn hình (tiêu đề cột "Thao tác")               |
| `.cell-stack` `.cell-title` `.cell-sub` | `screens.css` | Ô hai dòng: tên đậm + dòng phụ nhỏ                           |
| `.cell-badges`                   | `screens.css`  | Hàng huy hiệu, tự xuống dòng                                      |
| `.cell-actions`                  | `screens.css`  | Hàng nút thao tác canh phải trong ô                               |
| `.link-button`                   | `screens.css`  | Nút trông như liên kết (mã hàng mở chi tiết)                      |
| `.stock-low`                     | `screens.css`  | Chữ đỏ cho giá trị thấp                                           |
| `.page`, `.page-header`          | `layout.css`   | Khung trang (khe 24px) và đầu trang — dùng qua `PageHeader`       |
| `.toolbar`, `.toolbar-end`, `.toolbar-count` | `layout.css`, `table.css` | Thanh công cụ trên bảng                        |
| `.grid` + `.col-3/4/6/8/12`      | `layout.css`   | Lưới 12 cột (về 6 cột <= 1180px, 12 cột <= 760px)                  |

Chữ trong ô bảng: `.cell-title` cho tên/giá trị chính, `.cell-sub` cho chữ phụ; tránh `<b>` và `<br/>` rải rác.
