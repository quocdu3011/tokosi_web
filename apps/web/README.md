# @kiot/web – Giao diện quản trị

Next.js 16 (App Router) + React 19 + **CSS thuần theo token** (không Tailwind/shadcn; Radix cho hành vi,
Sonner cho toast). Gọi API theo hợp đồng ở [`docs/api/`](../../docs/api/README.md). Giao diện theo
[`docs/design-system/`](../../docs/design-system/README.md) (token, component, checklist PR);
**trang danh sách mới phải theo [`list-page.md`](../../docs/design-system/list-page.md)**.

## Chạy

```bash
cp .env.example .env.local   # sửa NEXT_PUBLIC_API_URL nếu API không ở localhost:3001
pnpm dev                     # chạy ở thư mục gốc: web http://localhost:3000 + api
```

| Lệnh (trong `apps/web`) | Việc                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `pnpm test`             | Vitest (lớp gọi API, quyền, định dạng, ma trận phân quyền)                          |
| `pnpm api:types`        | Sinh lại `src/lib/api/schema.d.ts` từ `docs/api/openapi.json`; chạy Prettier sau đó |

## Cấu trúc `src/`

```
app/(auth)/            Đăng nhập, đổi mật khẩu
app/(app)/             Khu quản trị (cổng đăng nhập + sidebar); mỗi phân hệ một thư mục
components/ui/         Nguyên tố giao diện (Radix + lớp CSS thuần): Button, Badge, Dialog, Sheet, Select…
components/layout/     Khung trang, menu, chọn chi nhánh, sáng/tối, tài khoản
components/common/     Trang trống, kiểm tra quyền, ô biểu mẫu, StatusBadge…
components/data-table/ Bảng dữ liệu (TanStack Table v9), toolbar, xuất Excel, phân trang theo server
hooks/                 useTablePrefs (tùy chỉnh bảng theo tài khoản), useListState, useDebouncedValue…
styles/                tokens.css, base.css, layout.css, components/*.css (nạp qua components.css)
lib/api/               Client gọi API, lỗi chuẩn, kiểu dữ liệu (sinh từ OpenAPI)
lib/auth/              Phiên đăng nhập (token chỉ trong bộ nhớ)
lib/queries/           Hook TanStack Query theo phân hệ
lib/navigation.ts      Sơ đồ menu + quyền + cờ `ready` (backend đã có API chưa)
```

## Phân hệ Khách hàng

`/customers` đã nối API Khách hàng theo OpenAPI hiện có:

- Danh sách có tìm mã/tên/SĐT, lọc trạng thái, level giá, khách mình phụ trách, nguồn, tháng khách mới và công nợ; phân trang/sắp xếp trên server.
- Bảng dùng `DataTable`, `TableToolbar`, `useTablePrefs('customers', ...)`, `useListState`, `Pagination`, `StatusBadge` theo Design System. Tùy chỉnh cột và số dòng lưu theo tài khoản.
- Tạo/sửa khách, hồ sơ kho và hình thức bán hàng; ngưng/mở giao dịch có xác nhận. Quyền sửa và xem nợ có xét phạm vi `own`; khách không được xem nợ hiện `—`, không thay bằng 0.
- Chi tiết có số liệu riêng từng chi nhánh, hạn mức/kỳ hạn, sổ công nợ theo khoảng ngày và lịch tiếp khách (quyền `customer.visit.edit` để ghi/xóa).
- Import mẫu TKS chỉ có chế độ cập nhật, cần `import.run` và `customer.edit` phạm vi `all`; kiểm tra trước khi ghi và hiển thị cảnh báo từ BE. Quyền nhập nợ đầu kỳ do BE kiểm tra.
- Xuất Excel dùng bộ lọc/sắp xếp hiện tại và định dạng TKS do BE cung cấp. API Khách hàng hiện chưa nhận tùy chọn cột xuất; nút xuất tải nguyên mẫu TKS, khác với API xuất Hàng hóa có chọn cột.

## Quy ước chung

- **Phân hệ backend chưa có API thì để trống** (trang "Chức năng đang được xây dựng"), không dùng
  dữ liệu giả. Khi backend xong: bật `ready: true` trong `lib/navigation.ts` và thay trang trống.
- Ẩn/hiện menu, nút theo `permissions` của `/auth/me` (`can()` trong `lib/permissions.ts`), **không**
  theo vai trò.
- Access token chỉ nằm trong bộ nhớ; tải lại trang thì lấy lại bằng cookie refresh. Mọi yêu cầu gửi
  `X-Branch-Id` của chi nhánh đang làm việc; đổi chi nhánh thì dữ liệu đã tải bị xóa và tải lại.
- Tiền/giá/số lượng là chuỗi: hiển thị bằng `formatMoney` / `formatDecimal` (`lib/format.ts`),
  không đổi sang `number` để cộng.
- Next.js 16 với `cacheComponents` giữ trang trước trong DOM ở trạng thái ẩn: đặt `id` của ô nhập liệu
  có tiền tố riêng theo màn hình (vd `uf-username`) để không trùng với trang khác.
- **Trang danh sách mới** theo [`docs/design-system/list-page.md`](../../docs/design-system/list-page.md):
  `DataTable` + `useTablePrefs` (cột ẩn/hiện, thứ tự, độ rộng, số dòng/trang lưu theo tài khoản qua
  `/me/table-prefs`) và `Pagination` có chọn cỡ trang; không hard-code `PAGE_SIZE`/`limit: 20`; trạng thái
  dùng `StatusBadge`, không viết `<span className="badge …">`. CSS mới: thêm file vào `styles/components.css`,
  chỉ dùng token; `src/styles/design-constraints.test.ts` khóa các ràng buộc cứng (không 3D, không
  `transition: all`, chữ >= 12px, không Tailwind, không emoji).
