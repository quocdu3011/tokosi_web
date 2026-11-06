# Mẫu trang danh sách chuẩn

Rút từ trang **Hàng hóa**: `apps/web/src/app/(app)/products/products-screen.tsx` (danh sách) + `product-drawer.tsx` (chi tiết). **Mọi trang danh sách mới PHẢI theo mẫu này**; khi sửa lớn một trang cũ thì chuyển nó về mẫu (danh sách màn còn lệch ở mục 5).

> Chữ ký dưới đây đã đối chiếu với mã ở `components/data-table/*`, `hooks/use-table-prefs.ts`, `hooks/use-list-state.ts`, `components/common/status-badge.tsx`. Nếu mã đổi mà tài liệu chưa kịp theo thì **mã đúng** — sửa tài liệu trong cùng PR. Riêng `products-screen.tsx` ở thời điểm viết CHƯA được chuyển sang các hook mới (còn `PAGE_SIZE = 20`, `useColumnVisibility`); ví dụ ở mục 3 là dạng đích.

## 1. Giải phẫu

```
div.page                              khe 24px giữa các phần
├─ PageHeader                         title · description · actions   (components/common/coming-soon.tsx)
├─ TableToolbar  (div.toolbar)
│   ├─ TableSearch                    ô tìm có nút xóa, Esc để xóa
│   ├─ FilterSelect × N               mỗi bộ lọc một ô chọn, aria-label riêng
│   └─ ToolbarEnd (div.toolbar-end)   đẩy sang phải:
│        ├─ ToolbarCount              "1.234 kết quả" (aria-live=polite)
│        ├─ ColumnPicker prefs        "Cột": ẩn/hiện; "Mặc định" đặt lại toàn bộ tùy chỉnh bảng
│        ├─ ImportButton              chỉ khi can(me, 'import.run')
│        └─ ExportMenu                "Xuất Excel" chọn cột; khớp bộ lọc
├─ lỗi?  p.alert.alert-error[role=alert]   — thay cho bảng + phân trang khi tải lỗi
├─ DataTable prefs                    .data-table-frame: tiêu đề dính, kéo thả cột, skeleton/rỗng/dòng
├─ Pagination                         "x–y / tổng dòng" · Số dòng/trang (15/50/100) · Trước/Sau
└─ (cuối .page) Sheet chi tiết · ImportDialog · ConfirmDialog   — mount có điều kiện
```

| Thành phần                                                                                  | Nguồn                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `PageHeader({ title, description?, actions? })`                                             | `@/components/common/coming-soon` (hiện nằm chung file với `ComingSoon`)              |
| `TableToolbar`, `ToolbarEnd`, `ToolbarCount`, `FilterSelect`, `TableSearch`, `ColumnPicker`, `ImportButton` | `@/components/data-table/table-toolbar`                          |
| `ExportMenu`                                                                                | `@/components/data-table/export-menu` (cũng re-export từ `table-toolbar`)             |
| `DataTable`, `AppColumnDef`, `SortState`                                                    | `@/components/data-table/data-table`                                                  |
| `sortableIdsOf`, `TableColumnMeta`                                                          | `@/components/data-table/column-meta`                                                 |
| `Pagination`                                                                                | `@/components/data-table/pagination`                                                  |
| `useTablePrefs`, `TablePrefsController`                                                     | `@/hooks/use-table-prefs` (lưu theo tài khoản: `GET/PUT/DELETE /me/table-prefs`)      |
| `useListState`                                                                              | `@/hooks/use-list-state`                                                              |
| `StatusBadge`, `ACTIVE_STATUS_TONES`, `DOCUMENT_STATUS_TONES`, `statusTone`                 | `@/components/common/status-badge`                                                    |
| `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE`, `TABLE_KEY_PATTERN` (15/50/100, 15)               | `@kiot/shared`                                                                        |
| `sortRows`, `decimalSortValue`                                                              | `@/lib/table-sort`                                                                    |
| `exportFilename`, `saveBlob`                                                                | `@/lib/table-export`                                                                  |
| `formatMoney`, `formatDecimal`, `formatDateTime`                                            | `@/lib/format`                                                                        |
| `can`                                                                                       | `@/lib/permissions`                                                                   |

## 2. Quy tắc

### 2.1 `tableKey`

Mỗi bảng một khóa cố định, truyền cho `useTablePrefs(tableKey, columns)`; server lưu cột ẩn, thứ tự, độ rộng, số dòng/trang **theo từng tài khoản**.

- Khớp `^[a-z0-9][a-z0-9:_-]{0,63}$` (`TABLE_KEY_PATTERN` trong `@kiot/shared`): chữ thường, số, `-`, `:`, `_`.
- Đặt theo **tên danh sách**, số nhiều, kebab-case: `products`, `suppliers`, `purchase-orders`, `goods-receipts`, `purchase-returns`, `users`. Màn dùng chung cho nhiều loại (`PurchaseScreen kind=…`) thì khóa theo loại.
- **Không** nhét chi nhánh, người dùng vào khóa — prefs đã theo tài khoản, và bố cục cột không đổi theo chi nhánh.
- Hằng ở mức module: `const TABLE_KEY = 'products';`. Đổi khóa = mọi người mất tùy chỉnh đã lưu của bảng đó, đừng đổi tùy tiện.
- Bảng phụ trong chi tiết (sổ công nợ, thẻ kho) có thể không dùng prefs; nếu dùng thì khóa riêng (`supplier-ledger`).
- Các khóa của màn cũ được tự chuyển từ localStorage lên server một lần (`LEGACY_STORAGE_KEYS` trong `components/data-table/prefs-core.ts`); màn **mới** không cần thêm gì vào bảng đó.

### 2.2 Cách tùy chỉnh được lưu (để biết hệ quả)

- Người dùng đổi → áp ngay (lạc quan), gửi `PUT /me/table-prefs/:tableKey` sau ~600ms ngừng thao tác (kéo mép cột bắn liên tục); rời trang thì gửi luôn. Gửi lỗi → toast cảnh báo "Chưa lưu được tùy chỉnh bảng…", phiên này vẫn dùng bản mới.
- Có bản sao nóng trong localStorage (`tks:table-prefs:<userId>`) để vẽ đúng ngay lần đầu trước khi server trả lời. **Màn không tự đọc/ghi** localStorage cho việc này.
- Cột thêm sau này: nối vào cuối danh sách đổi chỗ được, theo `hiddenByDefault`. Cột bị xóa hoặc **đổi `id`**: tùy chỉnh của cột đó bị bỏ qua.
- `id` cột không có trên màn (ví dụ cột theo quyền, người này không thấy) vẫn được giữ nguyên trong danh sách ẩn đã lưu.
- Độ rộng lưu là số nguyên px, kẹp 64..1000 ở giao diện (server 40..1000). `pageSize` ∈ {15, 50, 100}.
- "Mặc định" ở `ColumnPicker` = `prefs.reset()`: xóa bản ghi trên server, đặt lại **ẩn/hiện + thứ tự + độ rộng + số dòng/trang**.

### 2.3 Khai báo cột

```tsx
const columns = useMemo<AppColumnDef<Product>[]>(() => [ … ], [canSeeCost]);
```

- `useMemo` theo các giá trị quyền/điều kiện mà cột phụ thuộc (`DataTable` xếp lại cột theo mảng này). `useTablePrefs` chịu được mảng tạo mới mỗi lần vẽ, nhưng `DataTable` thì tính lại — đừng để mảng đổi tham chiếu vô cớ.
- Mỗi cột có `id` **ổn định** (là khóa lưu trong prefs) và `meta`:

| `meta`             | Ý nghĩa                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `label` (bắt buộc) | Tên cột trong hộp "Cột" và nhãn trợ năng (viết hoa chữ đầu: `Giá vốn`)                                          |
| `width`            | Độ rộng mặc định (px); thiếu = 160                                                                              |
| `hiddenByDefault`  | Cột phụ: mặc định ẩn, người dùng bật ở "Cột" (vd. `createdAt`, `description`)                                   |
| `locked`           | Không ẩn được, không kéo đổi chỗ, không có trong hộp "Cột" (mã/tên định danh, cột Thao tác); đứng đúng chỗ khai báo |
| `sort`             | `'server'` \| `'page'`; thiếu = không sắp xếp (xem 2.5)                                                         |
| `sortHint`         | Tooltip nút sắp xếp (cột `page` có sẵn "Sắp xếp trong trang đang xem")                                          |

- Tiêu đề cột là chuỗi tiếng Việt. Cột số: `header: () => <span className="num">Tồn kho</span>` và ô `<span className="num">…</span>` (canh phải).
- Cột Thao tác: `id: 'actions'`, `header: () => <span className="sr-only">Thao tác</span>`, `meta: { label: 'Thao tác', locked: true, width: 100 }`; nút trong ô là `Button variant="ghost" size="icon"` có `aria-label` nêu đối tượng.
- Ô mở chi tiết (thường là cột mã): nút `className="link-button tabular"` có `aria-label` ("Xem hàng HH001"), xem ví dụ mục 3. Thêm `onRowClick` để bấm chỗ trống của dòng cũng mở (bấm vào nút/liên kết/ô nhập trong dòng thì dòng không kích hoạt).
- Thứ tự cột trên màn do người dùng kéo thả tiêu đề (chuột/cảm ứng: kéo >= 6px; bàn phím: Tab tới nút tay nắm "Đổi chỗ cột …" → Phím cách nhấc, mũi tên trái/phải di chuyển, Phím cách thả, Esc hủy). Màn không cần code thêm.

### 2.4 Cột `locked` và cột theo quyền

- `locked: true` cho cột định danh (Mã, Tên) và cột Thao tác.
- **Cột nhạy cảm theo quyền thì không đưa vào mảng cột khi thiếu quyền** (không chỉ ẩn bằng CSS/`hidden`). Trang mẫu: giá vốn chỉ khi `can(me, 'product.cost.view')` — server cũng bỏ hẳn field đó nếu thiếu quyền:

```tsx
const columns = useMemo<AppColumnDef<Product>[]>(() => {
  const cols: AppColumnDef<Product>[] = [ /* code, name … */ ];
  if (canSeeCost) cols.push({ id: 'costPrice', /* … */ meta: { label: 'Giá vốn', width: 140, sort: 'page' } });
  cols.push( /* onHand, status … */ );
  return cols;
}, [canSeeCost]);
```

- Tùy chọn **xuất Excel** cũng lọc theo quyền: `PRODUCT_EXPORT_COLUMNS.filter((c) => canSeeCost || !isProductCostColumn(c.id))`.
- Nút hành động (Thêm, Nhập, Sửa) ẩn theo `can(me, …)`, không theo vai trò: `actions={canEdit ? <Button>…</Button> : undefined}`.
- Quyền có phạm vi `own`: server đã lọc dữ liệu; giao diện không tự lọc lại.

### 2.5 Sắp xếp: server hay trong trang

| `meta.sort` | Ai sắp xếp                                        | Khi nào                                                                                     |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `'server'`  | **Server**, trên TOÀN BỘ kết quả                  | Cột nằm trong `sort` mà API hỗ trợ (`docs/api/endpoints.md`; Hàng hóa: `code`, `name`, `onHand`, `createdAt`) |
| `'page'`    | **Trình duyệt**, chỉ các dòng của trang đang xem  | API chưa hỗ trợ cột đó. Tooltip mặc định báo "Sắp xếp trong trang đang xem"                  |

Nối vào truy vấn (`sortableIdsOf(columns, 'server')` lấy đúng các cột `server`, không phải khai báo lại danh sách):

```tsx
const serverIds = sortableIdsOf(columns, 'server');
const serverSort =
  list.sort && serverIds.includes(list.sort.id)
    ? `${list.sort.desc ? '-' : ''}${list.sort.id}`
    : undefined;                                   // gửi lên API: sort=-onHand
const rows = useMemo(() => sortRows(data?.data ?? EMPTY, list.sort, PAGE_SORT), [data, list.sort]);
// PAGE_SORT: { costPrice: (p) => decimalSortValue(p.costPrice), … } chỉ cho cột 'page'
```

- Không gắn `'server'` cho cột API không sắp xếp được. Thêm cột sắp xếp server → sửa API và `docs/api/` trước.
- Giá trị so sánh tiền/số từ chuỗi dùng `decimalSortValue` (chỉ để SO SÁNH, không để cộng tiền); trống luôn xếp cuối.
- Vòng sắp xếp trên tiêu đề: tăng → giảm → bỏ.

### 2.6 Đổi bộ lọc / tìm kiếm / sắp xếp / cỡ trang → về trang 1

`useListState` gói sẵn: `setFilter`, `setQ`, `onSortChange`, `onPageSizeChange` đều đặt `page = 1`; chỉ `setPage` giữ trang; chọn lại đúng giá trị đang có thì không đổi gì. **Không tự viết** `setPage(1)` rải rác (kiểu `resetFilters(() => …)` của bản cũ).

```tsx
const list = useListState({ initialFilters: INITIAL_FILTERS, prefs });   // prefs → list.pageSize = prefs.pageSize
list.filters.status;  list.setFilter('status', 'inactive');              // → trang 1
list.q;  list.setQ('đèn');  list.debouncedQ;                             // debouncedQ đã trim + trễ 300ms, đưa vào API
list.sort;  list.onSortChange(next);  list.page;  list.setPage(2);
list.pageSize;  list.onPageSizeChange(50);                               // lưu vào prefs + về trang 1
list.resetFilters();                                                     // về lọc/tìm/sắp xếp ban đầu, giữ cỡ trang
```

- Giá trị bộ lọc là `string | number | boolean | null`. Với `FilterSelect`, chuỗi rỗng `''` = "mọi" (không lọc).
- Dùng `placeholderData: keepPreviousData` trong hook truy vấn (đã có ở `useProductList`) để bảng không nháy trống khi đổi trang/lọc.

### 2.7 Phân trang và cỡ trang

- **Cấm** `const PAGE_SIZE = 20` và `limit: 20` cứng cho danh sách. `limit` = `list.pageSize` (= `prefs.pageSize`; mặc định `DEFAULT_PAGE_SIZE` = 15; lựa chọn `PAGE_SIZE_OPTIONS` = 15/50/100; API nhận 1..100).
- Luôn truyền đủ để hiện ô "Số dòng/trang":

```tsx
<Pagination meta={data?.meta} onPageChange={list.setPage} pageSize={list.pageSize} onPageSizeChange={list.onPageSizeChange} />
```

  Khi người dùng đổi cỡ trang, `Pagination` gọi `onPageSizeChange(size)` rồi `onPageChange(1)`. Nếu màn không truyền `pageSize/onPageSizeChange` thì ô chọn không hiện (chỉ chấp nhận cho màn cũ).
- `prefs.isReady` = đủ dữ liệu để vẽ đúng (bản sao nóng hoặc server đã trả lời). Hook truy vấn nhận `enabled` thì truyền `enabled: prefs.isReady` để không tải bằng cỡ trang mặc định rồi tải lại.
- Danh sách chọn nhanh trong ô chọn (picker/lookup, `limit: 20`) không phải trang danh sách, giữ cỡ cố định.

### 2.8 Xuất Excel luôn khớp màn hình

Dùng **cùng một đối tượng `filters`** (đã gồm từ khóa trễ, bộ lọc, `sort` server) cho truy vấn danh sách và cho tải file; chỉ danh sách thêm `page`/`limit`. Server bỏ qua `page/limit` khi `?format=xlsx` (tối đa 10.000 dòng).

```tsx
const filters: ProductFilterParams = { q: list.debouncedQ || undefined, isActive, sort: serverSort };
const query = useProductList({ ...filters, page: list.page, limit: list.pageSize });
const handleExport = async (cols: ProductExportColumnId[]) => {
  const { blob, filename } = await downloadProductsXlsx(filters, cols);
  saveBlob(blob, filename ?? exportFilename('hang-hoa', 'xlsx'));
};
```

- `ExportMenu` tự bắt lỗi (toast) và chỉ đóng hộp thoại khi tải xong; `disabled={!data || data.meta.total === 0}`. Hộp thoại hiện cố định tiêu đề "Xuất Excel · Hàng hóa" (xem mục 5).
- Sắp xếp kiểu `'page'` không có trong file xuất (server không biết) — chấp nhận, không giả lập.

### 2.9 Ba trạng thái: đang tải · rỗng · lỗi

| Trạng thái | Hiển thị                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Đang tải   | `DataTable isLoading` → 5 dòng skeleton trong khung bảng (lần đầu); các lần sau giữ dữ liệu cũ (`keepPreviousData`)       |
| Rỗng       | `emptyText="Không có hàng hóa phù hợp"` — nêu đúng đối tượng; `toolbar-count` = 0 và `ExportMenu` bị khóa                  |
| Lỗi        | **Thay cả bảng và phân trang** bằng `<p className="alert alert-error" role="alert">{errorMessage(error)}</p>` (hoặc `QueryError` có nút "Thử lại"); toolbar giữ nguyên để người dùng đổi bộ lọc |

### 2.10 Khác

- **Dữ liệu theo chi nhánh** (tồn, giá vốn, công nợ, chứng từ): query key gồm `branchId` (`productKeys.list(branchId, params)`); `AppProviders` tự `resetQueries` khi đổi chi nhánh. Sheet chi tiết đóng khi đổi chi nhánh.
- **Tiền/số**: `formatMoney`/`formatDecimal` trên chuỗi, cột số `.num`; thời gian `formatDateTime`.
- **Trạng thái**: `StatusBadge` (không `<span class="badge">`); xem bảng ánh xạ ở [components.md](components.md).
- `id` ô nhập có tiền tố riêng theo màn hình (vd. `pf-…`) vì Next.js giữ trang trước trong DOM.
- Quyền xem bọc ở `page.tsx`: `<RequirePermission anyOf={['product.view']}><ProductsScreen /></RequirePermission>`.

## 3. Ví dụ hoàn chỉnh tối giản

Danh sách "Hàng hóa" rút gọn (dạng đích): tìm kiếm, một bộ lọc, cột theo quyền, sắp xếp server + trong trang, tùy chỉnh cột theo tài khoản, phân trang có chọn cỡ, nhập/xuất Excel, mở chi tiết. Bản đầy đủ: `app/(app)/products/products-screen.tsx`.

```tsx
'use client';

import {
  PRODUCT_EXPORT_COLUMNS,
  isProductCostColumn,
  type ProductExportColumnId,
} from '@kiot/shared';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { ACTIVE_STATUS_TONES, StatusBadge } from '@/components/common/status-badge';
import { sortableIdsOf } from '@/components/data-table/column-meta';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker, ExportMenu, FilterSelect, ImportButton, TableSearch, TableToolbar,
  ToolbarCount, ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { ImportDialog } from '@/components/import/import-dialog';
import { Button } from '@/components/ui/button';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDecimal, formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import { downloadProductsXlsx, useProductList, type ProductFilterParams } from '@/lib/queries/products';
import { exportFilename, saveBlob } from '@/lib/table-export';
import { decimalSortValue, sortRows, type SortValue } from '@/lib/table-sort';

import { ProductDrawer, type DrawerTarget } from './product-drawer';

const TABLE_KEY = 'products';
const INITIAL_FILTERS = { status: 'active' };            // '' = mọi trạng thái
const EMPTY: Product[] = [];                              // mảng cố định: tránh tạo mới mỗi lần vẽ
/** Cột 'page': API chưa sắp xếp được → so sánh ngay trên trang đang xem. */
const PAGE_SORT: Record<string, (p: Product) => SortValue> = {
  costPrice: (p) => decimalSortValue(p.costPrice),
};

export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');
  const canEdit = can(me, 'product.edit');
  const canImport = can(me, 'import.run');
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // 1. Cột (theo quyền) + tùy chỉnh bảng theo tài khoản
  const columns = useMemo<AppColumnDef<Product>[]>(() => {
    const cols: AppColumnDef<Product>[] = [
      {
        id: 'code',
        header: 'Mã hàng',
        meta: { label: 'Mã hàng', width: 120, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            aria-label={`Xem hàng ${row.original.code}`}
            onClick={() => setDrawer({ kind: 'view', id: row.original.id })}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: 'Tên hàng',
        meta: { label: 'Tên hàng', width: 320, locked: true, sort: 'server' },
        cell: ({ row }) => <span className="cell-title">{row.original.name}</span>,
      },
    ];
    if (canSeeCost) {
      cols.push({
        id: 'costPrice',
        header: () => <span className="num">Giá vốn</span>,
        meta: { label: 'Giá vốn', width: 140, sort: 'page', sortHint: 'Sắp xếp trong trang đang xem' },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.costPrice)}</span>,
      });
    }
    cols.push(
      {
        id: 'onHand',
        header: () => <span className="num">Tồn kho</span>,
        meta: { label: 'Tồn kho', width: 110, sort: 'server' },
        cell: ({ row }) => <span className="num">{formatDecimal(row.original.onHand) || '0'}</span>,
      },
      {
        id: 'description',
        header: 'Mô tả',
        meta: { label: 'Mô tả', width: 280, hiddenByDefault: true },   // cột phụ: bật ở nút "Cột"
        cell: ({ row }) => <span className="cell-sub">{row.original.description ?? ''}</span>,
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 180 },
        cell: ({ row }) => (
          <StatusBadge tone={ACTIVE_STATUS_TONES[row.original.isActive ? 'active' : 'inactive']}>
            {row.original.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
          </StatusBadge>
        ),
      },
    );
    return cols;
  }, [canSeeCost]);
  const prefs = useTablePrefs(TABLE_KEY, columns);

  // 2. Bộ lọc, tìm kiếm, sắp xếp, trang, cỡ trang — đổi cái nào (trừ trang) cũng về trang 1
  const list = useListState({ initialFilters: INITIAL_FILTERS, prefs });

  // 3. Bộ lọc dùng chung cho danh sách VÀ xuất Excel
  const serverIds = sortableIdsOf(columns, 'server');
  const filters: ProductFilterParams = {
    q: list.debouncedQ || undefined,
    isActive: list.filters.status === '' ? undefined : list.filters.status === 'active',
    sort: list.sort && serverIds.includes(list.sort.id)
      ? `${list.sort.desc ? '-' : ''}${list.sort.id}`
      : undefined,
  };
  const { data, isLoading, isError, error } = useProductList({
    ...filters,
    page: list.page,
    limit: list.pageSize,                                  // từ prefs, KHÔNG hard-code
  });
  const rows = useMemo(() => sortRows(data?.data ?? EMPTY, list.sort, PAGE_SORT), [data, list.sort]);

  const exportOptions = PRODUCT_EXPORT_COLUMNS.filter((c) => canSeeCost || !isProductCostColumn(c.id));
  const handleExport = async (cols: ProductExportColumnId[]) => {
    const { blob, filename } = await downloadProductsXlsx(filters, cols);
    saveBlob(blob, filename ?? exportFilename('hang-hoa', 'xlsx'));
  };

  return (
    <div className="page">
      <PageHeader
        title="Danh sách hàng hóa"
        description="Tồn kho và giá vốn hiển thị theo chi nhánh đang làm việc."
        actions={
          canEdit ? (
            <Button onClick={() => setDrawer({ kind: 'create' })}>
              <Plus aria-hidden="true" /> Thêm hàng hóa
            </Button>
          ) : undefined
        }
      />

      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã hoặc tên hàng"
          label="Tìm hàng hóa"
        />
        <FilterSelect
          label="Lọc theo trạng thái"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'active', label: 'Đang kinh doanh' },
            { value: 'inactive', label: 'Ngừng kinh doanh' },
          ]}
        />
        <ToolbarEnd>
          {data && <ToolbarCount total={data.meta.total} />}
          <ColumnPicker prefs={prefs} />
          {canImport && <ImportButton onClick={() => setImportOpen(true)} />}
          <ExportMenu
            options={exportOptions}
            onExport={handleExport}
            disabled={!data || data.meta.total === 0}
          />
        </ToolbarEnd>
      </TableToolbar>

      {isError ? (
        <p className="alert alert-error" role="alert">{errorMessage(error)}</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={isLoading}
            emptyText="Không có hàng hóa phù hợp"
            getRowId={(p) => p.id}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            onRowClick={(p) => setDrawer({ kind: 'view', id: p.id })}
          />
          <Pagination
            meta={data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}

      {importOpen && <ImportDialog type="products" onClose={() => setImportOpen(false)} />}
      {drawer && <ProductDrawer target={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
```

Những thứ KHÔNG còn xuất hiện so với bản cũ: `PAGE_SIZE`, `useColumnVisibility`, `DEFAULT_WIDTHS`, `DEFAULT_HIDDEN`, `PICKER_LABELS`, `COLUMN_LABELS`, `SORTABLE_IDS`, `SORT_HINTS`, `resizable`, `columnLabels`, `sortHints`, `hiddenColumns`, `resetFilters(() => …)` — tất cả đã được `meta` + `useTablePrefs` + `useListState` thay.

## 4. Chi tiết bản ghi: Sheet + Tabs

Mở chi tiết bằng `Sheet` bên phải, **không** chuyển trang. Mẫu: `products/product-drawer.tsx`.

- Trạng thái mở nằm ở màn danh sách: `const [drawer, setDrawer] = useState<DrawerTarget | null>(null)` với `DrawerTarget = { kind: 'create' } | { kind: 'view'; id: string; tab?: … }`; render có điều kiện ở cuối `.page`: `{drawer && <ProductDrawer target={drawer} onClose={() => setDrawer(null)} />}`; bên trong `<Sheet open onOpenChange={(o) => !o && onClose()}>`.
- Khung:

```tsx
<Sheet open onOpenChange={(o) => !o && onClose()}>
  <SheetContent side="right" className="product-workspace" aria-describedby={undefined}>
    <div className="product-workspace-header">
      <header>
        <SheetTitle>{product ? product.name : 'Thêm hàng hóa'}</SheetTitle>
        {product && (
          <div className="product-header-meta"><span>{product.code}</span>{/* Badge phân loại */}</div>
        )}
      </header>
    </div>
    <div className="product-workspace-body">
      {isError ? <p className="alert alert-error" role="alert">{errorMessage(error)}</p>
        : isLoading || !product ? <Skeleton className="skeleton-block" />
        : (
          <Tabs className="product-workspace-tabs" orientation="horizontal" value={tab} onValueChange={(v) => setTab(v as DrawerTab)}>
            <TabsList aria-label="Thông tin hàng hóa">
              <TabsTrigger value="info"><Info aria-hidden="true" />Thông tin</TabsTrigger>
              {product.productType === 'goods' && (
                <TabsTrigger value="stock-card"><Layers aria-hidden="true" />Thẻ kho</TabsTrigger>
              )}
            </TabsList>
            <div className="product-workspace-editor">
              <TabsContent value="info">{/* biểu mẫu + khối tóm tắt */}</TabsContent>
              <TabsContent value="stock-card">{/* chỉ tải khi mở */}</TabsContent>
            </div>
          </Tabs>
        )}
    </div>
  </SheetContent>
</Sheet>
```

- Tab chỉ hiện khi có quyền/điều kiện; dữ liệu tab nặng (thẻ kho, sổ công nợ) chỉ tải khi tab mở.
- Ba trạng thái trong Sheet: tải (`<Skeleton className="skeleton-block" />`), lỗi (`.alert .alert-error`), nội dung. Tạo mới = Sheet chỉ có biểu mẫu (không tab); lưu xong chuyển sang `view` của bản ghi vừa tạo.
- Biểu mẫu trong Sheet: nút lưu/hủy ở `.form-actions` (dính đáy khung); xem [components.md](components.md) mục Form.
- Dữ liệu theo chi nhánh: đóng Sheet khi `branchId` đổi (`useEffect` so với giá trị lúc mở).
- Tên lớp `product-workspace-*` là tên lịch sử nhưng đang dùng chung (kể cả `suppliers/supplier-detail.tsx`). Chiều rộng riêng đặt bằng lớp modifier (`.sheet-content.purchase-workspace { width: 64vw }`) hoặc dùng `sheet-wide`. Đổi tên thành `detail-*` là việc dọn dẹp riêng, đừng làm trong PR tính năng.

## 5. Màn còn lệch chuẩn (cần chuyển dần)

Tình trạng 2026-11-06, so với trang Hàng hóa dạng đích. Tìm bằng:
`grep -rnE "PAGE_SIZE|limit: [0-9]+" apps/web/src/app apps/web/src/components` và
`grep -rn "className=.*badge" apps/web/src --include=*.tsx`.

| Màn                                                              | Lệch                                                                                                                                                                                                                                                                                       | Chuyển thế nào                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `products/products-screen.tsx` (chính trang mẫu)                 | Còn dạng cũ: `PAGE_SIZE = 20`, `useColumnVisibility` + `resizable` + `columnLabels` + `sortableIds`/`sortHints`, 4 `Select` thô trong toolbar, `resetFilters(() => …)`                                                                                                                       | Chuyển đúng theo ví dụ mục 3; `FilterSelect` thay `Select` thô                                                     |
| `settings/users/users-screen.tsx`                                | `PAGE_SIZE = 20`; thanh tìm dựng tay (`div.toolbar-search` + `Input`, thiếu nút xóa/Esc) thay `TableSearch`; chỉ có ẩn/hiện cột bằng `useColumnVisibility` (localStorage, không thứ tự/độ rộng); không sắp xếp, không số kết quả; `COLUMN_OPTIONS` tách rời mảng cột; đặt lại mật khẩu dựng tay bằng `AlertDialog`; bộ lọc `Select` thô | `useTablePrefs('users', …)` + `meta`; `useListState`; `TableToolbar`/`TableSearch`/`FilterSelect`/`ToolbarEnd`; `ConfirmDialog` |
| `suppliers/suppliers-screen.tsx`                                 | `limit: 20` cứng; `PurchaseToolbar` (`purchase-ui.tsx`) thay `TableToolbar`; `<span className="badge badge-…">` thô; mảng `columns` tạo lại mỗi lần vẽ; nhãn hộp "Cột" lấy từ `String(c.header)` (vỡ nếu header là hàm); xuất Excel gọi `api.download` tay, không `ExportMenu` (không chọn cột); `sort` là chuỗi tự xử lý; cột Thao tác `header: ''`, `edit && …` có thể trả `false`; mã mở chi tiết dùng `Button variant="link"` thay `link-button` | `useTablePrefs('suppliers', …)`, `meta`, `StatusBadge` (`ACTIVE_STATUS_TONES`), `TableToolbar`, `ExportMenu`, `useListState` |
| `components/purchasing/purchase-screen.tsx` + `purchase-ui.tsx`  | Như trên (`limit: 20`, `PurchaseStatus` là badge thô thay vì `StatusBadge` + `DOCUMENT_STATUS_TONES`, `PurchaseToolbar`, xuất tay); `sort` là chuỗi có ánh xạ tay `date` ↔ `orderedAt/receivedAt/returnedAt`; panel "Bộ lọc" nâng cao dựng tay (`.purchase-filter-panel`) — hợp lý nhưng cần dùng `useListState` để về trang 1; `FilterSelect` đã dùng chung (re-export từ `table-toolbar`) | Như trên; bỏ `PurchaseToolbar`                                                                                    |
| `components/data-table/export-menu.tsx`                          | Tiêu đề hộp thoại cứng "Xuất Excel · Hàng hóa" — sai khi dùng cho NCC/phiếu                                                                                                                                                                                                              | Thêm prop tên đối tượng (vd. `title`) khi tái dùng cho màn khác                                                    |
| `purchase-detail.tsx`, `purchase-lines.tsx`                      | Bảng thô: cột số chưa canh phải/`col-numeric`; `<b>` rải rác                                                                                                                                                                                                                              | Giữ bảng thô (đúng chỗ), sửa theo mục "Bảng tĩnh" ở [components.md](components.md)                                 |

Khi chuyển một màn: xóa `useColumnVisibility`/`useColumnWidths`/`resizable`/`columnLabels`/`sortableIds`/`sortHints`/`hiddenColumns` cũ và `PAGE_SIZE`, rồi đi qua [checklist.md](checklist.md). Các tùy chọn cũ của `DataTable` (`resizable`, `columnLabels`, `hiddenColumns`, `sortableIds`) còn tồn tại chỉ để màn chưa chuyển vẫn chạy và sẽ bị gỡ — **không dùng trong code mới**.
