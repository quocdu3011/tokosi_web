# CLAUDE.md – Hướng dẫn cho AI agent và lập trình viên

Hệ thống **quản lý bán hàng sỉ nội bộ** cho một công ty, thay thế KiotViet.
Tài liệu thiết kế gốc: [`docs/TAI_LIEU_THIET_KE.md`](docs/TAI_LIEU_THIET_KE.md) — **đọc mục liên quan trước khi làm tính năng**
(phạm vi: mục 2.2; dữ liệu: mục 5; lộ trình 2 tháng: mục 13).
Đối với những chức năng chưa quen thuộc, **đừng viết từ con số 0**. Hãy tìm kiếm các dự án mã nguồn mở trên GitHub để so sánh ý tưởng, cách tổ chức và các bẫy thường gặp trước khi bắt tay làm.

## Cấu trúc

```
apps/api        NestJS (modular monolith) — backend
apps/web        Next.js (App Router) + Tailwind — giao diện quản trị
packages/shared Kiểu dữ liệu, hằng số, tiện ích dùng chung (build ra dist/)
infra/          docker-compose (PostgreSQL) và hạ tầng
docs/           Tài liệu thiết kế, ERD, ADR
```

## Lệnh thường dùng (chạy ở thư mục gốc)

| Lệnh                                                        | Việc                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm install`                                              | Cài phụ thuộc                                                        |
| `pnpm dev`                                                  | Chạy web + api ở chế độ phát triển                                   |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` | Qua Turborepo (có cache)                                             |
| `pnpm db:up` / `pnpm db:down`                               | Bật/tắt PostgreSQL cục bộ (cần Docker)                               |
| `pnpm --filter @kiot/api test`                              | Chạy test của một gói                                                |
| `pnpm --filter @kiot/api test:e2e`                          | Test e2e của API (không cần CSDL thật)                               |
| `pnpm --filter @kiot/api openapi:export`                    | Xuất `docs/api/openapi.json` (chạy khi đổi endpoint/DTO, commit kèm) |

Mọi PR phải qua: `lint`, `typecheck`, `test`, `build` (CI chạy đúng bộ này).

## Hợp đồng API (backend ↔ frontend)

- Frontend đọc `docs/api/` để làm song song; đó là **hợp đồng**. Khi thêm/sửa/xóa endpoint hoặc field, **cập nhật `docs/api/` cùng PR** và ghi vào "Nhật ký thay đổi" trong `docs/api/README.md`.
- Quy ước đã chốt: JSON camelCase; tiền/giá/số lượng là **chuỗi thập phân**; thời gian ISO 8601 UTC; phân trang `data` + `meta`; lỗi `{ code, message, details, requestId }`; tạo chứng từ cần `Idempotency-Key`.
- Swagger tại `/api/docs`. Mọi controller gắn `@ApiTags`, `@ApiOperation`, `@ApiOkResponse`; mọi DTO có `@ApiProperty` và validator `class-validator`. Sau khi đổi endpoint/DTO chạy `pnpm --filter @kiot/api openapi:export` rồi commit `docs/api/openapi.json`.
- Backend phải khớp đúng cấu trúc trong `docs/api/endpoints.md`; nếu cần khác thì sửa tài liệu trước và báo frontend.

## Quy tắc BẮT BUỘC (nghiệp vụ tiền / kho / công nợ)

1. **Không dùng số thực nhị phân (float) cho tiền.** Tiền chứng từ: số nguyên đồng. Đơn giá/giá vốn: `NUMERIC(18,4)`. Tính toán dùng Decimal ở backend.
2. **Không sửa trực tiếp số tồn / số dư công nợ / số dư quỹ.** Mọi thay đổi đi qua sổ cái chỉ-thêm (`stock_movements`, `debt_ledger`, `cash_transactions`) trong **cùng một transaction** với chứng từ gốc.
3. **Tạo hóa đơn phải idempotent** (`Idempotency-Key`/`client_request_id`) và nguyên tử: trừ kho + ghi nợ + ghi quỹ cùng lúc hoặc không gì cả.
4. **Không xóa cứng chứng từ.** Hủy = đổi trạng thái + ghi nhật ký.
5. **Công nợ được phép số dư âm** (khách trả dư).
6. **Giá bán** theo thứ tự: giá riêng khách > bảng giá của khách > Bảng giá chung. Giảm giá là **số tiền trên 1 đơn vị**, không phải %.
7. Múi giờ: lưu UTC, hiển thị `Asia/Ho_Chi_Minh`.
8. Mã chứng từ giữ tiền tố KiotViet (`HD`, `DH`, `PN`, …) — xem `packages/shared/src/codes.ts`.
9. Phần chạm tiền/kho/nợ **bắt buộc có test** và **người duyệt** trước khi merge, kể cả khi AI viết code.

## Dữ liệu & bảo mật

- **Không commit, không dán vào prompt/log dữ liệu thật** (tên, SĐT, địa chỉ khách; công nợ). File Excel xuất từ KiotViet nằm **ngoài repo** (`E:\Web\Data`). `.gitignore` đã chặn `*.xlsx`, `*.csv`, `data/`.
- Dev/test dùng dữ liệu ẩn danh hoặc giả lập.
- Không commit `.env`; chỉ commit `*.env.example`.

## Quy ước mã nguồn

- TypeScript `strict`. Backend: mỗi nghiệp vụ là một module Nest trong `apps/api/src/modules/<tên>` (controller → service → repository), module không truy cập bảng của module khác trực tiếp.
- Tên bảng/cột CSDL: `snake_case`, tiếng Anh. Văn bản hiển thị cho người dùng: tiếng Việt.
- Commit theo Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Làm theo **lát dọc nhỏ**: một spec ngắn (đầu vào, quy tắc, ví dụ số) → code → test → PR.

## Ghi chú về phiên bản (kiểm tra 11/2026)

- Next.js 16 (có thay đổi lớn): xem `apps/web/AGENTS.md` và tài liệu trong `node_modules/next/dist/docs/` trước khi viết code Next.
- NestJS 12 chạy ESM (`"type": "module"`, `nodenext`): import tương đối phải có đuôi `.js`. Test dùng Vitest, lint dùng Oxlint.
- ORM: **Drizzle** (`drizzle-orm` 0.45.x, `drizzle-kit` 0.31.x — bản ổn định; bản 1.0 còn beta/RC, không dùng). Lược đồ ở `apps/api/src/db/schema/`, migration ở `apps/api/drizzle/`. Chọn Drizzle vì là SQL gần như thuần, kiểu dữ liệu chặt, AI agent viết và rà soát ổn định hơn.
- Lệnh CSDL (chạy trong `apps/api`): `pnpm db:generate` (sinh migration từ schema), `pnpm db:migrate` (áp dụng), `pnpm db:studio`. **Luôn đọc file SQL migration được sinh ra trước khi chạy**; không sửa tay CSDL production.
