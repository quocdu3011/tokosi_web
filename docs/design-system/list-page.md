# Mẫu trang danh sách chuẩn

Rút từ trang **Hàng hóa**: `apps/web/src/app/(app)/products/products-screen.tsx` (danh sách) + `product-drawer.tsx` (chi tiết). **Mọi trang danh sách mới PHẢI theo mẫu này**; khi sửa lớn một trang cũ thì chuyển nó về mẫu (danh sách màn còn lệch ở cuối file).

> Chữ ký dưới đây theo hợp đồng giao diện đã chốt cho `useTablePrefs`, `DataTable`, `Pagination`, `TableToolbar`, `useListState`, `StatusBadge`. Nếu mã trong `components/data-table/`, `hooks/`, `components/common/status-badge.tsx` khác tài liệu thì **mã đúng** — sửa tài liệu trong cùng PR.

## 1. Giải phẫu

```
div.page                              khe 24px giữa các phần
├─ PageHeader                         title · description · actions   (components/common/coming-soon.tsx)
├─ TableToolbar  (div.toolbar)
│   ├─ TableSearch                    ô tìm có nút xóa, Esc để xóa
│   ├─ FilterSelect × N               mỗi bộ lọc một ô chọn, aria-label riêng
│   └─ ToolbarEnd (div.toolbar-end)   đẩy sang phải:
│        ├─ số kết quả                span.toolbar-count.tabular[aria-live=polite]
│        ├─ ColumnPicker              "Cột": ẩn/hiện + (thứ tự) theo prefs
│        ├─ ImportButton              chỉ khi can(me, 'import.run')
│        └─ ExportMenu                "Xuất Excel" chọn cột; khớp bộ lọc
├─ lỗi?  p.alert.alert-error[role=alert]   — thay cho bảng + phân trang khi tải lỗi
├─ DataTable                          .data-table-frame: tiêu đề dính, skeleton/rỗng/dòng
├─ Pagination                         "x–y / tổng dòng" · Số dòng/trang (15/50/100) · Trước/Sau
└─ (cuối .page) Sheet chi tiết · ImportDialog · ConfirmDialog   — mount có điều kiện
```

| Thành phần                                                    | Nguồn                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PageHeader`                                                  | `@/components/common/coming-soon` (hiện nằm chung file với `ComingSoon`) |
| `TableToolbar`, `ToolbarEnd`, `FilterSelect`, `TableSearch`, `ColumnPicker`, `ImportButton` | `@/components/data-table/table-toolbar` |
| `ExportMenu`                                                  | `@/components/data-table/export-menu` (cũng re-export từ `table-toolbar`) |
| `DataTable`, `AppColumnDef`, `SortState`                      | `@/components/data-table/data-table`                                    |
| `Pagination`                                                  | `@/components/data-table/pagination`                                    |
| `useTablePrefs`                                               | `@/hooks/use-table-prefs` (lưu theo tài khoản: `GET/PUT/DELETE /me/table-prefs`) |
| `useListState`                                                | `@/hooks/use-list-state`                                                |
| `StatusBadge`                                                 | `@/components/common/status-badge`                                      |
| `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE` (15/50/100, 15)      | `@kiot/shared`                                                          |
| `sortRows`, `decimalSortValue`                                | `@/lib/table-sort`                                                      |
| `exportFilename`, `saveBlob`                                  | `@/lib/table-export`                                                    |
| `formatMoney`, `formatDecimal`, `formatDateTime`              | `@/lib/format`                                                          |
| `can`                                                         | `@/lib/permissions`                                                     |

## 2. Quy tắc

### 2.1 `tableKey`

Mỗi bảng một khóa cố định, truyền cho `useTablePrefs(tableKey, columns)`; server lưu cột ẩn, thứ tự, độ rộng, số dòng/trang **theo từng tài khoản**.

- Khớp `^[a-z0-9][a-z0-9:_-]{0,63}$` (`TABLE_KEY_PATTERN` trong `@kiot/shared`); chữ thường, số, `-`, `:`, `_`.
- Đặt theo **tên danh sách**, số nhiều, kebab-case: `products`, `suppliers`, `purchase-orders`, `goods-receipts`, `purchase-returns`, `users`. Một màn dùng chung cho nhiều loại (vd. `PurchaseScreen kind=…`) thì khóa theo loại: `purchase-${kind}`.
- **Không** nhét chi nhánh, người dùng, ngôn ngữ vào khóa — prefs đã theo tài khoản, và bố cục cột không đổi theo chi nhánh.
- Hằng ở mức module: `const TABLE_KEY = 'products';`. Đổi khóa = mất tùy chỉnh đã lưu của mọi người, nên đừng đổi tùy tiện.
- Bảng phụ trong chi tiết (sổ công nợ, thẻ kho) có thể không dùng prefs; nếu dùng thì khóa riêng (`supplier-ledger`).

### 2.2 Khai báo cột

```tsx
const columns = useMemo<AppColumnDef<Product>[]>(() => [ … ], [canSeeCost]);
```

- `useMemo` theo các giá trị quyền/trạng thái cột phụ thuộc — **không tạo mảng cột mới mỗi lần render** (prefs và bảng tính lại liên tục).
- Mỗi cột có `id` ổn định (trùng khóa lưu trong prefs; đổi `id` = mất tùy chỉnh của cột) và `meta`:

| `meta`            | Ý nghĩa                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `label` (bắt buộc) | Tên cột trong hộp "Cột" và nhãn trợ năng của tay nắm kéo (viết hoa chữ đầu: `Giá vốn`)                     |
| `width`           | Độ rộng mặc định (px); thiếu = 160                                                                         |
| `hiddenByDefault` | Cột phụ: mặc định ẩn, người dùng bật ở "Cột" (vd. `createdAt`, `description`)                              |
| `locked`          | Không ẩn được, không kéo đổi chỗ (mã/tên định danh, cột Thao tác). Vị trí cố định theo khai báo.            |
| `sort`            | `'server'` \| `'page'` \| thiếu = không sắp xếp (xem 2.4)                                                   |
| `sortHint`        | Tooltip nút sắp xếp (cột `page` có sẵn "Sắp xếp trong trang đang xem")                                      |

- Tiêu đề cột là chuỗi tiếng Việt; cột số dùng `header: () => <span className="num">Tồn kho</span>` và ô `<span className="num">…</span>` để canh phải.
- Cột Thao tác (nút Sửa/…): `id: 'actions'`, `header: () => <span className="sr-only">Thao tác</span>`, `meta: { label: 'Thao tác', locked: true, width: 100 }`. Nút trong ô là `Button variant="ghost" size="icon"` có `aria-label` nêu rõ đối tượng.
- Ô mở chi tiết (thường là cột mã): `<button type="button" className="link-button tabular" aria-label={\`Xem hàng ${code}\`} onClick={…}>`. Ngoài ra `onRowClick` cho cả dòng (bấm vào nút/liên kết/ô nhập thì dòng không kích hoạt).

### 2.3 Cột `locked` và cột theo quyền

- `locked: true` cho cột định danh (Mã, Tên) và cột Thao tác: luôn hiện, giữ vị trí, không có trong hộp "Cột".
- **Cột nhạy cảm theo quyền thì không đưa vào mảng cột khi thiếu quyền** — không chỉ ẩn bằng CSS hay `hidden`. Trang mẫu: giá vốn chỉ khi `can(me, 'product.cost.view')` (server cũng bỏ hẳn field đó nếu thiếu quyền):

```tsx
const canSeeCost = can(me, 'product.cost.view');
const columns = useMemo<AppColumnDef<Product>[]>(() => {
  const cols: AppColumnDef<Product>[] = [ /* code, name … */ ];
  if (canSeeCost) cols.push({ id: 'costPrice', header: …, meta: { label: 'Giá vốn', sort: 'page', width: 140 }, cell: … });
  cols.push( /* onHand, status … */ );
  return cols;
}, [canSeeCost]);
```

- Tùy chọn **xuất Excel** cũng lọc theo quyền: `PRODUCT_EXPORT_COLUMNS.filter((c) => canSeeCost || !isProductCostColumn(c.id))`.
- Nút hành động (Thêm, Nhập, Sửa) ẩn theo `can(me, …)`, không theo vai trò: `actions={canEdit ? <Button>…</Button> : undefined}`.
- Cột/ô còn lại phụ thuộc phạm vi `own`: server đã lọc dữ liệu; giao diện không tự lọc lại.

### 2.4 Sắp xếp: server hay trong trang

| `meta.sort` | Ai sắp xếp                                      | Khi nào                                                                                              | Cách nối |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `'server'`  | **Server**, trên TOÀN BỘ kết quả                | Cột nằm trong danh sách `sort` mà API hỗ trợ (xem `docs/api/endpoints.md`, vd. Hàng hóa: `code`, `name`, `onHand`, `createdAt`) | Đẩy vào truy vấn: `sort: sort ? \`${sort.desc ? '-' : ''}${sort.id}\` : undefined` |
| `'page'`    | **Trình duyệt**, chỉ trên dòng của trang đang xem | API chưa hỗ trợ sắp xếp cột đó                                                                    | `sortRows(data, sort, PAGE_SORT)` với bộ truy xuất giá trị so sánh; tooltip mặc định báo rõ "trong trang đang xem" |

- Không gắn `'server'` cho cột mà API không sắp xếp được (server sẽ bỏ qua/báo lỗi). Thêm cột sắp xếp server mới → sửa API + `docs/api/` trước.
- Cột `'page'` có tooltip `sortHint` để người dùng không tưởng đang sắp xếp toàn bộ.
- Giá trị so sánh tiền/số từ chuỗi: `decimalSortValue(p.costPrice)` (chỉ để SO SÁNH, không để cộng tiền); trống luôn xếp cuối.
- Vòng sắp xếp trên tiêu đề: tăng → giảm → bỏ. Mặc định mỗi màn tự chọn sắp xếp ban đầu (hoặc không).

### 2.5 Đổi bộ lọc / tìm kiếm / sắp xếp / cỡ trang → về trang 1

Ở trang 7 mà lọc ra 2 kết quả thì phải thấy kết quả ngay, không phải "Không có dữ liệu". `useListState` làm việc này: mọi `set` bộ lọc, ô tìm, sắp xếp và cỡ trang đều đặt `page = 1`; chỉ `setPage` mới giữ trang. **Không tự viết** `setPage(1)` rải rác (bản cũ dùng `resetFilters(() => …)` — dễ quên).

- Ô tìm kiếm: gõ cập nhật ngay trong ô, truy vấn dùng giá trị trễ `useDebouncedValue(q.trim())` (300ms mặc định, `hooks/use-debounced-value.ts`).
- Dùng `placeholderData: keepPreviousData` trong hook truy vấn (đã có ở `useProductList`) để bảng không nháy trống khi đổi trang/lọc.

### 2.6 Phân trang và cỡ trang

- **Cấm** `const PAGE_SIZE = 20` và `limit: 20` cứng cho danh sách. `limit` = `prefs.pageSize` (mặc định `DEFAULT_PAGE_SIZE` = 15; lựa chọn `PAGE_SIZE_OPTIONS` = 15/50/100 — API nhận 1..100).
- `<Pagination meta={data?.meta} onPageChange={list.setPage} pageSize={prefs.pageSize} onPageSizeChange={…} />` luôn có Select "Số dòng/trang"; khi người dùng đổi: lưu vào prefs (`prefs.setPageSize`) **và** về trang 1.
- Chờ `prefs.isReady` trước khi gửi truy vấn đầu tiên (`enabled: prefs.isReady`) để không tải bằng cỡ trang mặc định rồi tải lại bằng cỡ trang đã lưu.
- Danh sách chọn nhanh trong ô chọn (picker/lookup: `limit: 20`) không phải trang danh sách, được giữ cỡ cố định.
- Tổng số dòng hiện ở `toolbar-count` (`{total.toLocaleString('vi-VN')} kết quả`) và ở `Pagination`.

### 2.7 Xuất Excel luôn khớp màn hình

- Dùng **cùng một đối tượng `filters`** (đã gồm tìm kiếm trễ, bộ lọc, `sort` server) cho truy vấn danh sách và cho tải file; chỉ danh sách thêm `page`/`limit`. Server bỏ qua `page/limit` khi `?format=xlsx`.

```tsx
const filters = { q: debouncedQ || undefined, isActive: …, sort: serverSort };   // dùng chung
const query = useProductList({ ...filters, page, limit: pageSize });
const onExport = async (cols: ProductExportColumnId[]) => {
  const { blob, filename } = await downloadProductsXlsx(filters, cols);
  saveBlob(blob, filename ?? exportFilename('hang-hoa', 'xlsx'));
};
```

- `ExportMenu` tự bắt lỗi (toast) và chỉ đóng khi tải xong; `disabled={!data || data.meta.total === 0}`.
- Sắp xếp kiểu `'page'` không có trong file xuất (server không biết) — chấp nhận, không giả lập.

### 2.8 Ba trạng thái: đang tải · rỗng · lỗi

| Trạng thái | Hiển thị                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Đang tải   | `DataTable isLoading` → 5 dòng skeleton ngay trong khung bảng (lần tải đầu); lần sau giữ dữ liệu cũ (`keepPreviousData`) |
| Rỗng       | `emptyText="Không có hàng hóa phù hợp"` — nêu rõ đối tượng; số kết quả = 0, `ExportMenu` bị khóa                  |
| Lỗi        | **Thay cả bảng và phân trang** bằng `<p className="alert alert-error" role="alert">{errorMessage(error)}</p>` (hoặc `QueryError` có nút "Thử lại"); toolbar giữ nguyên để người dùng đổi bộ lọc |

```tsx
{isError ? (
  <p className="alert alert-error" role="alert">{errorMessage(error)}</p>
) : (
  <>
    <DataTable … />
    <Pagination … />
  </>
)}
```

### 2.9 Khác

- **Dữ liệu theo chi nhánh** (tồn, giá vốn, công nợ, chứng từ): query key gồm `branchId` (`productKeys.list(branchId, params)`); `AppProviders` tự `resetQueries` khi đổi chi nhánh. Chi tiết (Sheet) đóng khi đổi chi nhánh.
- **Tiền/số**: `formatMoney`/`formatDecimal` trên chuỗi, cột số `.num`; thời gian `formatDateTime`.
- **Trạng thái**: `StatusBadge` (không `<span class="badge">`); xem bảng ánh xạ ở [components.md](components.md).
- `id` ô nhập có tiền tố riêng theo màn hình (ví dụ `pf-…`) vì Next.js giữ trang trước trong DOM.
- Trang bọc quyền xem ở `page.tsx`: `<RequirePermission anyOf={['product.view']}><ProductsScreen /></RequirePermission>`.

## 3. Ví dụ hoàn chỉnh tối giản

Danh sách "Hàng hóa" rút gọn: tìm kiếm, một bộ lọc, cột theo quyền, sắp xếp server + trang, xuất Excel, mở chi tiết. File thật: `app/(app)/products/products-screen.tsx`.

```tsx
'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker, ExportMenu, FilterSelect, TableSearch, TableToolbar, ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDecimal, formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import { downloadProductsXlsx, useProductList } from '@/lib/queries/products';
import { exportFilename, saveBlob } from '@/lib/table-export';
import { decimalSortValue, sortRows } from '@/lib/table-sort';

const TABLE_KEY = 'products';

export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');
  const canEdit = can(me, 'product.edit');
  const [detailId, setDetailId] = useState<string | null>(null);

  // 1. Cột (theo quyền) + tùy chỉnh bảng theo tài khoản
  const columns = useMemo<AppColumnDef<Product>[]>(() => {
    const cols: AppColumnDef<Product>[] = [
      {
        id: 'code', header: 'Mã hàng',
        meta: { label: 'Mã hàng', width: 120, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button type="button" className="link-button tabular"
            aria-label={`Xem hàng ${row.original.code}`} onClick={() => setDetailId(row.original.id)}>
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name', header: 'Tên hàng',
        meta: { label: 'Tên hàng', width: 320, locked: true, sort: 'server' },
        cell: ({ row }) => <span className="cell-title">{row.original.name}</span>,
      },
    ];
    if (canSeeCost) {
      cols.push({
        id: 'costPrice', header: () => <span className="num">Giá vốn</span>,
        meta: { label: 'Giá vốn', width: 140, sort: 'page' },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.costPrice)}</span>,
      });
    }
    cols.push(
      {
        id: 'onHand', header: () => <span className="num">Tồn kho</span>,
        meta: { label: 'Tồn kho', width: 110, sort: 'server' },
        cell: ({ row }) => <span className="num">{formatDecimal(row.original.onHand) || '0'}</span>,
      },
      {
        id: 'status', header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 180, sort: 'page' },
        cell: ({ row }) => <StatusBadge … />, // xem components.md: ánh xạ trạng thái → biến thể
      },
    );
    return cols;
  }, [canSeeCost]);
  const prefs = useTablePrefs(TABLE_KEY, columns);

  // 2. Bộ lọc, tìm kiếm, sắp xếp, trang, cỡ trang — đổi cái nào cũng về trang 1
  const list = useListState(…);

  // 3. Bộ lọc dùng chung cho danh sách VÀ xuất Excel
  const debouncedQ = useDebouncedValue(list.q.trim());
  const filters = { q: debouncedQ || undefined, isActive: …, sort: …server };
  const { data, isLoading, isError, error } = useProductList({ ...filters, page: list.page, limit: prefs.pageSize });
  const rows = useMemo(() => sortRows(data?.data ?? EMPTY, list.sort, PAGE_SORT), [data, list.sort]);

  const handleExport = async (cols) => { /* như mục 2.7 */ };

  return (
    <div className="page">
      <PageHeader … />
      <TableToolbar>…</TableToolbar>
      {isError ? <p className="alert alert-error" role="alert">{errorMessage(error)}</p> : (
        <>
          <DataTable … />
          <Pagination … />
        </>
      )}
    </div>
  );
}
const EMPTY: Product[] = [];
```

## 4. Chi tiết bản ghi: Sheet + Tabs

Mở chi tiết bằng `Sheet` bên phải, **không** chuyển trang. Mẫu: `products/product-drawer.tsx`.

- Trạng thái mở nằm ở màn danh sách: `const [drawer, setDrawer] = useState<DrawerTarget | null>(null)` với `DrawerTarget = { kind: 'create' } | { kind: 'view'; id: string; tab?: … }`; render có điều kiện ở cuối `.page`: `{drawer && <ProductDrawer target={drawer} onClose={() => setDrawer(null)} />}`. Bên trong `<Sheet open onOpenChange={(o) => !o && onClose()}>`.
- Khung: `SheetContent side="right" className="product-workspace" aria-describedby={undefined}` → `div.product-workspace-header > header` (`SheetTitle` = tên bản ghi, dòng `product-header-meta` = mã + `Badge`) → `div.product-workspace-body`.
- Tab: `Tabs className="product-workspace-tabs" orientation="horizontal"` → `TabsList aria-label="…"` → `TabsTrigger` (icon `aria-hidden` + chữ) → `div.product-workspace-editor` chứa `TabsContent`. Tab chỉ hiện khi có quyền/điều kiện; dữ liệu tab nặng (thẻ kho, sổ công nợ) chỉ tải khi tab mở.
- Ba trạng thái trong Sheet: tải (`<Skeleton className="skeleton-block" />`), lỗi (`.alert .alert-error`), nội dung. Tạo mới = Sheet chỉ có biểu mẫu (không tab); lưu xong chuyển sang `view` của bản ghi vừa tạo.
- Biểu mẫu trong Sheet: nút lưu/hủy ở `.form-actions` (dính đáy); xem [components.md](components.md) mục Form.
- Dữ liệu theo chi nhánh: đóng Sheet khi `branchId` đổi (`useEffect` so với giá trị lúc mở).
- Tên lớp `product-workspace-*` là tên lịch sử nhưng đang dùng chung (kể cả `suppliers/supplier-detail.tsx`). Chiều rộng riêng đặt bằng lớp modifier (`.sheet-content.purchase-workspace { width: 64vw }`) hoặc dùng `sheet-wide`. Đổi tên thành `detail-*` là việc dọn dẹp riêng, đừng làm trong PR tính năng.

## 5. Màn còn lệch chuẩn (cần chuyển dần)

Tình trạng 2026-11-06, so với trang Hàng hóa:

| Màn                                                           | Lệch                                                                                                                                                                                                                                               | Chuyển thế nào                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `settings/users/users-screen.tsx`                             | `PAGE_SIZE = 20` cứng; thanh tìm kiếm dựng tay (`div.toolbar-search` + `Input`, thiếu nút xóa/Esc) thay `TableSearch`; chỉ có hộp "Cột" dùng `useColumnVisibility` (localStorage, không thứ tự/độ rộng); không sắp xếp, không đổi độ rộng, không hiện số kết quả; danh sách `COLUMN_OPTIONS` tách rời mảng cột; xác nhận đặt lại mật khẩu dựng tay bằng `AlertDialog`; bộ lọc dùng `Select` thô + `resetFilters` | `useTablePrefs('users', columns)` + `meta`; `useListState`; `TableToolbar`/`TableSearch`/`FilterSelect`/`ToolbarEnd`; `ConfirmDialog` |
| `suppliers/suppliers-screen.tsx`                              | `limit: 20` cứng; `PurchaseToolbar` + `FilterSelect` riêng của `purchase-ui.tsx` (giá trị `''` ↔ `'all'`); `<span className="badge badge-…">` thô; mảng `columns` tạo lại mỗi lần render; nhãn hộp "Cột" lấy từ `String(c.header)` (vỡ nếu header là hàm); xuất Excel gọi `api.download` tay, không `ExportMenu` (không chọn cột); `sort` là chuỗi tự xử lý; cột Thao tác `header: ''` và `edit && …` có thể trả `false`; mã mở chi tiết dùng `Button variant="link"` thay `link-button` | `useTablePrefs('suppliers', …)`, `meta`, `StatusBadge`, `TableToolbar`, `ExportMenu`, `useListState`        |
| `components/purchasing/purchase-screen.tsx` + `purchase-ui.tsx` | Như trên (`limit: 20`, `PurchaseStatus` là badge thô, `PurchaseToolbar`, xuất tay); `sort` là chuỗi có ánh xạ tay `date` ↔ `orderedAt/receivedAt/returnedAt`; panel "Bộ lọc" nâng cao dựng tay (`.purchase-filter-panel`) — hợp lý nhưng chưa là thành phần chung | `StatusBadge` thay `PurchaseStatus`; bỏ `PurchaseToolbar`; giữ panel lọc nâng cao nhưng dùng `useListState` để về trang 1 |
| `components/data-table/export-menu.tsx`                       | Tiêu đề hộp thoại cứng "Xuất Excel · Hàng hóa" — sai khi dùng cho NCC/phiếu                                                                                                                                                                       | Truyền tên đối tượng qua prop (vd. `title`) khi tái dùng cho màn khác                                 |
| `purchase-detail.tsx`, `purchase-lines.tsx`                   | Bảng thô: cột số chưa canh phải/`col-numeric`; `<b>` rải rác                                                                                                                                                                                      | Giữ bảng thô (đúng chỗ), sửa theo mục "Bảng tĩnh" ở [components.md](components.md)                    |

Khi chuyển một màn: xóa `useColumnVisibility`/`useColumnWidths`/`resizable`/`columnLabels`/`sortableIds`/`sortHints`/`hiddenColumns` cũ (đã được `useTablePrefs` + `meta` thay), xóa `PAGE_SIZE`, rồi đi qua [checklist.md](checklist.md).
