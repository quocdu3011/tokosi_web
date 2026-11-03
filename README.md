# Kiot – Quản lý bán hàng sỉ

Hệ thống quản lý bán hàng sỉ nội bộ (hàng hóa, mua hàng, đơn hàng, khách hàng, sổ quỹ, tổng quan, báo cáo), thay thế KiotViet.

- Thiết kế, phạm vi, lộ trình: [`docs/TAI_LIEU_THIET_KE.md`](docs/TAI_LIEU_THIET_KE.md)
- Quy tắc cho AI agent / dev: [`CLAUDE.md`](CLAUDE.md)
- **Tài liệu API cho frontend:** [`docs/api/README.md`](docs/api/README.md) (quy ước chung) và [`docs/api/endpoints.md`](docs/api/endpoints.md) (danh sách endpoint)

## Công nghệ

| Lớp        | Công nghệ                                         |
| ---------- | ------------------------------------------------- |
| Monorepo   | pnpm workspaces + Turborepo                       |
| Backend    | NestJS 12 (TypeScript, ESM), Vitest, Oxlint       |
| Frontend   | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| CSDL       | PostgreSQL 17 + Drizzle ORM (node-postgres)       |
| Dùng chung | `@kiot/shared` (mã chứng từ, định dạng tiền)      |

## Yêu cầu

- Node.js ≥ 24 (khuyến nghị đúng bản trong `.nvmrc`)
- pnpm 12 (`npm i -g pnpm`)
- Docker (để chạy PostgreSQL cục bộ) — hoặc cài PostgreSQL 17 trực tiếp

## Bắt đầu

```bash
pnpm install
pnpm dev          # web: http://localhost:3000 — api: http://localhost:3001 (đổi bằng biến PORT)
                  # Swagger UI: http://localhost:3001/api/docs
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Cấu trúc

```
apps/api         NestJS – backend
apps/web         Next.js – giao diện
packages/shared  Kiểu dữ liệu, tiện ích dùng chung
infra/           docker-compose (PostgreSQL)
docs/            Tài liệu thiết kế
```

## Việc tiếp theo (tuần 1 – M0)

1. Viết lược đồ CSDL đầu tiên trong `apps/api/src/db/schema/` và chạy migration đầu tiên (`pnpm db:generate && pnpm db:migrate` trong `apps/api`).
2. ERD chi tiết theo `docs/TAI_LIEU_THIET_KE.md` mục 5.3–5.4.
3. Đăng nhập (JWT) và 4 vai trò cố định.
4. Môi trường staging và triển khai tự động.
5. Công cụ import từ KiotViet (dữ liệu để **ngoài repo**).
