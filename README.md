# Tokosi – Quản lý bán hàng sỉ

Hệ thống quản lý bán hàng sỉ nội bộ (hàng hóa, mua hàng, đơn hàng, khách hàng, sổ quỹ, tổng quan, báo cáo), được xây dựng tùy biến thay thế KiotViet.

- Thiết kế, phạm vi, lộ trình: [`docs/TAI_LIEU_THIET_KE.md`](docs/TAI_LIEU_THIET_KE.md)
- Quy tắc cho AI agent / dev: [`CLAUDE.md`](CLAUDE.md)
- **Tài liệu API cho frontend:** [`docs/api/README.md`](docs/api/README.md) (quy ước chung) và [`docs/api/endpoints.md`](docs/api/endpoints.md) (danh sách endpoint)
- Tài liệu CSDL & từ điển dữ liệu: [`docs/db/README.md`](docs/db/README.md)

## Công nghệ

| Lớp        | Công nghệ                                         |
| ---------- | ------------------------------------------------- |
| Monorepo   | pnpm workspaces + Turborepo                       |
| Backend    | NestJS 12 (TypeScript, ESM), Vitest, Oxlint       |
| Frontend   | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| CSDL       | PostgreSQL 17 + Drizzle ORM (node-postgres)       |
| Lưu trữ    | MinIO / S3 compatible (quản lý file ảnh)          |
| Dùng chung | `@kiot/shared` (mã chứng từ, xuất Excel, định dạng tiền) |

## Yêu cầu môi trường

- Node.js ≥ 24 (khuyến nghị đúng bản trong `.nvmrc`)
- pnpm ≥ 9 (khuyến nghị pnpm 12)
- Docker (để chạy PostgreSQL 17 & MinIO cục bộ qua `infra/docker-compose.yml`)

## Bắt đầu nhanh

```bash
# 1. Cài đặt phụ thuộc
pnpm install

# 2. Khởi chạy CSDL & MinIO cục bộ
pnpm db:up

# 3. Tạo bucket lưu trữ ảnh dev (chạy một lần)
pnpm --filter @kiot/api storage:init

# 4. Nạp dữ liệu mẫu để dev (nếu cần)
pnpm --filter @kiot/api db:seed:demo

# 5. Chạy môi trường phát triển (Web + API)
pnpm dev
# Web:        http://localhost:3000
# API:        http://localhost:3001/api/v1
# Swagger UI: http://localhost:3001/api/docs

# 6. Kiểm tra mã nguồn (trước khi commit/PR)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Cấu trúc thư mục

```
apps/api         NestJS – backend API (modular monolith)
apps/web         Next.js – giao diện quản trị web
packages/shared  Kiểu dữ liệu, hằng số và tiện ích dùng chung
infra/           Docker Compose (PostgreSQL, MinIO)
docs/            Tài liệu thiết kế, API specs, sơ đồ DBML/ERD
tasks/           Kế hoạch và danh sách việc cần làm
```

## Tính năng đã triển khai

- **Xác thực & Phân quyền:** Đăng nhập JWT, đăng nhập Google qua Supabase, phân quyền động theo bảng quyền (`role_permissions`), quản lý người dùng và gán chi nhánh.
- **Hàng hóa & Tồn kho:** Quản lý hàng hóa (`goods`), hàng gói (`combo`), lưu trữ ảnh S3, ngừng/bật kinh doanh, tồn kho theo chi nhánh (Hà Nội, Sài Gòn), thẻ kho (`stock_movements`). Đã đơn giản hóa bằng cách loại bỏ nhóm hàng (categories).
- **Trải nghiệm web:** Ẩn/hiện cột bảng tùy biến, menu desktop thu gọn, kéo thả/dán ảnh từ clipboard, xem ảnh phóng to, hiển thị tồn kho trực tiếp tại tab thông tin hàng hóa, xuất Excel tùy chọn danh sách cột tải về.
- **Nhập/Xuất dữ liệu:** Nhập Excel chế độ ghi đè (`overwrite`) và thêm (`add`), chống nhập trùng file qua mã băm SHA-256; script `kiotviet:pull` kéo dữ liệu trực tiếp từ API KiotViet.
- **Mua hàng (API):** Quản lý nhà cung cấp theo chi nhánh, sổ công nợ nhà cung cấp, đặt hàng nhập (`PO`), nhập hàng (`PN`), trả hàng nhập (`THN`), tính giá vốn bình quân gia quyền.
- **Bảo mật & Toàn vẹn:** Chống tạo chứng từ trùng (`@Idempotent`), transaction an toàn chống deadlock, đối soát sổ cái tự động (`db:reconcile`).

## Lộ trình tiếp theo

1. **Giao diện Mua hàng & Nhà cung cấp:** Dựng UI danh sách và lập phiếu cho Nhà cung cấp, Đặt hàng nhập, Nhập hàng và Trả hàng nhập (kết nối API backend đã sẵn sàng).
2. **Nghiệp vụ Bán hàng (Sales):** API và giao diện cho Khách hàng, Đơn đặt hàng, Hóa đơn bán sỉ và Trả hàng bán.
3. **Sổ quỹ (Cashbook):** Phiếu thu / phiếu chi thanh toán công nợ và chi phí vận hành.
4. **Nghiệm thu toàn diện:** Hoàn thiện kiểm thử đa thiết bị (responsive), tương phản AA và thao tác phím nhanh.
