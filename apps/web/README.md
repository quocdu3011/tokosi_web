# @kiot/web – Giao diện quản trị

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui. Gọi API theo hợp đồng ở
[`docs/api/`](../../docs/api/README.md).

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
components/ui/         Component shadcn/ui
components/layout/     Khung trang, menu, chọn chi nhánh, sáng/tối, tài khoản
components/common/     Trang trống, kiểm tra quyền, ô biểu mẫu…
components/data-table/ Bảng dữ liệu (TanStack Table v9) + phân trang theo server
lib/api/               Client gọi API, lỗi chuẩn, kiểu dữ liệu (sinh từ OpenAPI)
lib/auth/              Phiên đăng nhập (token chỉ trong bộ nhớ)
lib/queries/           Hook TanStack Query theo phân hệ
lib/navigation.ts      Sơ đồ menu + quyền + cờ `ready` (backend đã có API chưa)
```

## Quy ước

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
