# CLAUDE.md – Hướng dẫn cho AI agent và lập trình viên

Hệ thống **quản lý bán hàng sỉ nội bộ** cho một công ty, thay thế KiotViet.
Tài liệu thiết kế gốc: [`docs/TAI_LIEU_THIET_KE.md`](docs/TAI_LIEU_THIET_KE.md) — **đọc mục liên quan trước khi làm tính năng**
(phạm vi: mục 2.2; dữ liệu: mục 5; lộ trình 2 tháng: mục 13).
Đối với những chức năng chưa quen thuộc, **đừng viết từ con số 0**. Hãy tìm kiếm các dự án mã nguồn mở trên GitHub để so sánh ý tưởng, cách tổ chức và các bẫy thường gặp trước khi bắt tay làm.

## Đọc trước khi làm

> Hai file dưới đây là **tài liệu làm việc cục bộ của dev backend**, nằm trong `.gitignore` (không có trên GitHub). Nếu không thấy file trên máy thì bỏ qua.

- [`CURRENT.md`](CURRENT.md): hiện trạng và nhật ký theo ngày — **đọc đầu tiên**; cuối mỗi ngày làm việc **thêm một mục mới ở đầu danh sách ngày** và cập nhật "Hiện trạng", "Việc tiếp theo".
- [`MEMORY.md`](MEMORY.md): quyết định đã chốt, điều còn mở, bẫy kỹ thuật đã gặp. Khi chốt quyết định mới hoặc gặp bẫy mới, ghi vào đó (sửa/xóa mục lỗi thời).

## Cấu trúc

```
apps/api        NestJS (modular monolith) — backend
apps/web        Next.js (App Router) + CSS thuần theo token (không Tailwind) — giao diện quản trị
packages/shared Kiểu dữ liệu, hằng số, tiện ích dùng chung (build ra dist/)
infra/          docker-compose (PostgreSQL) và hạ tầng
docs/           Tài liệu thiết kế, ERD, ADR
```

## Lệnh thường dùng (chạy ở thư mục gốc)

| Lệnh                                                        | Việc                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                              | Cài phụ thuộc                                                                                                                     |
| `pnpm dev`                                                  | Chạy web + api ở chế độ phát triển                                                                                                |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` | Qua Turborepo (có cache)                                                                                                          |
| `pnpm db:up` / `pnpm db:down`                               | Bật/tắt PostgreSQL + MinIO (kho file ảnh) cục bộ (cần Docker)                                                                     |
| `pnpm --filter @kiot/api test`                              | Chạy test của một gói                                                                                                             |
| `pnpm --filter @kiot/api test:e2e`                          | Test e2e của API (không cần CSDL thật)                                                                                            |
| `pnpm --filter @kiot/api db:seed`                           | Dữ liệu khởi tạo đầy đủ (xem `docs/db/README.md`); chạy lại an toàn                                                               |
| `pnpm --filter @kiot/api db:seed:demo`                      | Dữ liệu MẪU để dev (60 hàng, 3 combo, tồn 2 chi nhánh, 8 nhà cung cấp kèm nợ đầu kỳ theo chi nhánh); chỉ dev, từ chối ở production                                    |
| `pnpm --filter @kiot/api storage:init`                      | Tạo bucket ảnh + cho phép đọc công khai trên MinIO dev (chạy sau `pnpm db:up`); chạy lại an toàn                                  |
| `pnpm --filter @kiot/api db:reconcile`                      | Đối soát sổ cái với số liệu cache (tồn, công nợ nội bộ, quỹ); thoát mã 1 nếu lệch. Chạy hằng ngày khi chạy song song với KiotViet |
| `pnpm --filter @kiot/api storage:gc`                        | Liệt kê file ảnh mồ côi trên kho file (thêm `--apply` để xóa)                                                                     |
| `pnpm --filter @kiot/api kiotviet:pull -- --out <file.xlsx>` | Kéo hàng hóa + nhóm + tồn từ API KiotViet ra .xlsx (cần `KIOTVIET_CLIENT_ID/SECRET/RETAILER`; file phải NGOÀI repo) rồi nhập bằng Import "Thêm"; chỉ đọc, không chạm CSDL |
| `pnpm --filter @kiot/api openapi:export`                    | Xuất `docs/api/openapi.json` (chạy khi đổi endpoint/DTO, commit kèm)                                                              |

Mọi PR phải qua: `lint`, `typecheck`, `test`, `build`, và `openapi.json` + `docs/db/` đã sinh lại (CI chạy đúng bộ này và so sánh tài liệu sinh tự động).

## Hợp đồng API (backend ↔ frontend)

- Frontend đọc `docs/api/` để làm song song; đó là **hợp đồng**. Khi thêm/sửa/xóa endpoint hoặc field, **cập nhật `docs/api/` cùng PR** và ghi vào "Nhật ký thay đổi" trong `docs/api/README.md`.
- Quy ước đã chốt: JSON camelCase; tiền/giá/số lượng là **chuỗi thập phân**; thời gian ISO 8601 UTC; phân trang `data` + `meta`; lỗi `{ code, message, details, requestId }`; tạo chứng từ cần `Idempotency-Key`.
- Swagger tại `/api/docs`. Mọi controller gắn `@ApiTags`, `@ApiOperation`, `@ApiOkResponse`; mọi DTO có `@ApiProperty` và validator `class-validator`. Sau khi đổi endpoint/DTO chạy `pnpm --filter @kiot/api openapi:export` rồi commit `docs/api/openapi.json`.
- Backend phải khớp đúng cấu trúc trong `docs/api/endpoints.md`; nếu cần khác thì sửa tài liệu trước và báo frontend.

## Phân quyền (Quản lý cấu hình được)

- Quyền của từng vai trò nằm trong bảng `role_permissions` (Quản lý chỉnh qua `/roles/...`), **không** hard-code theo vai trò trong mã. Vai trò `manager` luôn đủ quyền.
- Danh mục quyền ở `packages/shared/src/permissions.ts` (mã `module.hành_động`, nhãn, `scopable`, `requires`). **Mọi endpoint nghiệp vụ phải gắn `@RequirePermission('<mã>')`** (`apps/api/src/modules/authorization/`); không tự kiểm tra `user.role === ...`.
- Quyền có phạm vi `own` (`req.grants['invoice.view'] === 'own'`) thì **service phải lọc** chỉ dữ liệu của người đó (khách có `sales_owner_id`, đơn/hóa đơn có `seller_id` là chính họ).
- Trường nhạy cảm (giá vốn, công nợ…) chỉ trả về khi đủ quyền tương ứng — xem `docs/api/README.md` mục 8.
- Thêm quyền mới: thêm vào danh mục + `DEFAULT_ROLE_PERMISSIONS` (nếu muốn cấp mặc định), cập nhật `docs/api/`. Cài đặt đã chạy rồi thì quyền mới chỉ Quản lý có cho tới khi được cấp (seed không ghi đè cấu hình hiện có).
- **Đăng nhập Google (Supabase):** `modules/google-auth/`. Supabase chỉ chứng minh danh tính (kiểm tra JWT bằng JWKS, chỉ nhận provider `google` + email đã xác minh); mọi quyền do hệ thống quyết định. Tự đăng ký do Quản lý bật (`settings/auth`, mặc định tắt, bắt buộc có danh sách tên miền); người mới có vai trò `pending` (`PENDING_ROLE`, không nằm trong `ROLES`, không quyền nào, không chi nhánh) cho tới khi Quản lý cấp. Cấu hình `SUPABASE_URL`; trong Supabase phải TẮT đăng ký email/mật khẩu.
- Ba guard toàn cục đăng ký trong `AuthModule` **theo đúng thứ tự: `AuthGuard` → `PermissionGuard` → `BranchContextGuard`** (đừng đổi). Endpoint mặc định **cần đăng nhập**; chỉ endpoint công khai mới gắn `@Public()`. Dùng `@CurrentUser()` lấy người dùng; handler làm việc theo chi nhánh gắn `@RequireBranch()` rồi lấy `@WorkingBranchId()`. Vai trò, trạng thái tài khoản đọc từ CSDL ở mỗi yêu cầu (token chỉ chứa id). Mật khẩu: argon2id; refresh token chỉ lưu bản băm; đừng ghi mật khẩu/tên đăng nhập gõ nhầm vào nhật ký.

## Nhiều chi nhánh (Hà Nội, Sài Gòn)

- **Loại hàng:** `goods` (Hàng hóa) và `combo` (gói các hàng thành phần ở `product_components`, chuỗi `MSP/SL,MSP/SL`). Combo KHÔNG có tồn/giá vốn riêng (luôn tính từ thành phần; `comboFigures` trong `modules/catalog/combo.ts`), không bao giờ có dòng sổ kho/chứng từ: `InventoryService` từ chối combo, lập đơn tách combo thành các dòng thành phần.
- Dùng chung: hàng hóa, khách hàng, nhà cung cấp. **Riêng từng chi nhánh:** tồn kho + **giá vốn** (`stocks`), công nợ (`debt_ledger.branch_id`), hạn mức (`customer_branch_terms`), quỹ, mọi chứng từ. **Không bao giờ dùng tồn/giá vốn/công nợ của chi nhánh này cho chi nhánh kia.** Hệ thống **không có giá bán** (không bảng giá): giá bán được quy ước chung ở mô tả sản phẩm, người lập đơn nhập đơn giá từng dòng.
- Mọi truy vấn dữ liệu theo chi nhánh phải qua `BranchAccessService` (`resolveWorkingBranch` từ header `X-Branch-Id`, `assertAccess`). Nhân viên chỉ thấy chi nhánh được gán; Quản lý thấy cả hai.
- Thay đổi tồn kho **chỉ** qua `InventoryService` (khóa dòng, không âm, cập nhật giá vốn bình quân của chi nhánh, ghi sổ cái) trong transaction của chứng từ. Chứng từ có **từ 2 dòng hàng trở lên PHẢI dùng `applyMovements`** (khóa trước theo thứ tự cố định chi nhánh → sản phẩm); gọi `applyMovement` trong vòng lặp sẽ gây bế tắc (deadlock → lỗi 500) khi hai chứng từ có cùng mặt hàng theo thứ tự ngược nhau chạy đồng thời. Quy tắc chung: khóa nhiều dòng thì luôn theo một thứ tự cố định. Cấp mã chứng từ qua `nextDocumentCode`. Tính tiền/giá vốn bằng `common/costing.ts` (Decimal), không dùng `number`.
- Chuyển kho giữa 2 chi nhánh: `StockTransfersService` (2 bước gửi → nhận; giá nhập bên nhận = giá vốn gửi + phí phân bổ; công nợ đối ứng qua khách/NCC nội bộ có `linked_branch_id`). Đó **không phải hóa đơn bán**: mọi báo cáo doanh số/công nợ/danh sách khách, NCC phải **loại đối tác nội bộ** (`linked_branch_id IS NOT NULL`).
- Trả hàng bán về chi nhánh của hóa đơn gốc; thu nợ chỉ cấn trừ hóa đơn cùng chi nhánh.

## Quy ước kỹ thuật dùng chung

- **Mã tự cấp (`KH…`, `NCC…`) phải dùng `nextFreeDocumentCode`** (`db/code-sequence.ts`, bỏ qua mã đã bị chiếm), không dùng `nextDocumentCode` trần cho thực thể có thể nhập mã tay: một mã nhập tay trùng đúng số kế tiếp sẽ làm mọi lần tự cấp sau đó lỗi trùng mãi. Sau khi chuyển dữ liệu từ KiotViet vẫn nâng bộ đếm lên số lớn nhất + 1.
- **Nhật ký thao tác:** luôn qua `AuditService.record(tx, {...})` (`modules/audit/`), trong CÙNG transaction với thay đổi. `requestId`, người dùng, chi nhánh, IP tự lấy từ ngữ cảnh yêu cầu (`common/request-context.ts`). Không tự `insert` vào `audit_logs`; không ghi mật khẩu/token/băm vào nhật ký.
- **Ghi nhiều dòng cùng lúc (tồn, nhập Excel…):** xử lý theo **thứ tự khóa cố định** (vd chi nhánh → sản phẩm) rồi mới ghi, để hai người ghi cùng lúc không bế tắc (deadlock → lỗi 500). PGlite (test) chỉ có một kết nối nên KHÔNG tái hiện bế tắc: phần nào khóa nhiều dòng phải thử trên PostgreSQL thật nhiều kết nối.
- **Tham số đường dẫn là UUID:** luôn `@Param('id', ParseIdPipe)` (`common/parse-id.pipe.ts`), không dùng `ParseUUIDPipe` của Nest (trả `BAD_REQUEST`, sai hợp đồng lỗi).
- **Danh sách:** dùng `PageQueryDto`/`pageParams`/`pageMeta`/`parseSort` (`common/pagination.ts`); tham số boolean dùng `QueryBoolean`; mọi danh sách có `?format=xlsx` dùng `common/excel.ts`.
- **File (ảnh):** chỉ qua `FileStorage` (`modules/files/`, chuẩn S3). Kiểm tra loại file theo **nội dung** (`detectImage`), không theo đuôi/Content-Type. Cấu hình `S3_*` + `FILE_PUBLIC_BASE_URL`; production bắt buộc.
- **Chống tạo trùng chứng từ:** endpoint tạo chứng từ gắn `@Idempotent()` (`modules/idempotency/`): bắt buộc header `Idempotency-Key`, gửi lại cùng khóa thì trả kết quả cũ. Interceptor chạy sau guard nên có người dùng.
- **Mua hàng:** phiếu nhập/trả hàng nhập (`modules/purchasing/`) chỉ ghi **nợ nhà cung cấp**; tiền trả NCC và tiền hoàn lại làm bằng phiếu chi/thu ở Sổ quỹ (không có `paid` trên phiếu). Giá vốn bình quân: nhập dùng `weightedAverageCost`; trả hàng nhập và hủy phiếu nhập truyền `reduceCostAt` vào `InventoryService` (→ `removeAtCost`) để tính lại/tính ngược; bán và chuyển kho không đổi giá vốn.
- **Công nợ + hạn mức:** nghiệp vụ đọc số dư công nợ để quyết định rồi ghi `debt_ledger` phải gọi `lockPartyBranch(tx, loại, id, chiNhánh)` (`common/advisory-lock.ts`) ĐẦU TIÊN trong transaction, nếu không hai hóa đơn song song cùng vượt hạn mức.
- **Đối soát:** mọi kịch bản chứng từ mới nên kết thúc bằng `new ReconciliationService().run(db)` trong test và kỳ vọng `ok`.
- **Kết nối CSDL:** `buildPoolConfig` đặt `statement_timeout` và `idle_in_transaction_session_timeout` (mặc định 30 giây): không giữ transaction mở khi chờ việc chậm (gọi kho file, băm mật khẩu…); làm những việc đó NGOÀI transaction.
- **Sau reverse proxy:** đặt `TRUST_PROXY` (vd `1`), nếu không giới hạn đăng nhập sai và nhật ký thấy mọi người cùng một IP.
- **Giá bán là số nguyên đồng** (kiểm tra ở API và khi nhập Excel); giá vốn/giá nhập mới có 4 chữ số thập phân.
- **Test HTTP:** dùng `createHttpTestApp` (`src/test-utils/http-app.ts`) — ứng dụng thật đủ ba guard trên PostgreSQL trong bộ nhớ. Với phần chạm tiền/kho, làm thêm **kiểm tra ngược** (tạm gỡ bản sửa, test phải thất bại).

## Quy tắc BẮT BUỘC (nghiệp vụ tiền / kho / công nợ)

1. **Không dùng số thực nhị phân (float) cho tiền.** Tiền chứng từ: số nguyên đồng. Đơn giá/giá vốn: `NUMERIC(18,4)`. Tính toán dùng Decimal ở backend.
2. **Không sửa trực tiếp số tồn / số dư công nợ / số dư quỹ.** Mọi thay đổi đi qua sổ cái chỉ-thêm (`stock_movements`, `debt_ledger`, `cash_transactions`) trong **cùng một transaction** với chứng từ gốc. CSDL **ép** điều này bằng trigger (migration 0012): `UPDATE`/`DELETE`/`TRUNCATE` trên `stock_movements`, `debt_ledger` và `DELETE`/đổi trường tiền của `cash_transactions` đều bị từ chối — sửa sai bằng **bút toán đảo**, đừng tìm cách gỡ trigger.
3. **Tạo hóa đơn phải idempotent** (`Idempotency-Key`/`client_request_id`) và nguyên tử: trừ kho + ghi nợ + ghi quỹ cùng lúc hoặc không gì cả.
4. **Không xóa cứng chứng từ.** Hủy = đổi trạng thái + ghi nhật ký.
5. **Công nợ được phép số dư âm** (khách trả dư).
6. **Giá bán** không lưu trong hệ thống (không bảng giá); đơn giá trên dòng đơn/hóa đơn do người lập đơn nhập. Giảm giá là **số tiền trên 1 đơn vị**, không phải %.
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
- **Giao diện `apps/web` là CSS thuần theo token (KHÔNG Tailwind/shadcn):** đọc [`docs/design-system/README.md`](docs/design-system/README.md) trước khi làm UI (token, component, checklist PR). **Trang danh sách mới PHẢI theo [`docs/design-system/list-page.md`](docs/design-system/list-page.md)**: `DataTable` + `useTablePrefs` (ẩn/hiện, thứ tự, độ rộng cột, số dòng/trang lưu theo tài khoản) và `Pagination` có chọn cỡ trang; không hard-code `PAGE_SIZE`/`limit: 20`; trạng thái dùng `StatusBadge`, không viết `<span class="badge …">`.
- NestJS 12 chạy ESM (`"type": "module"`, `nodenext`): import tương đối phải có đuôi `.js`. Test dùng Vitest, lint dùng Oxlint.
- ORM: **Drizzle** (`drizzle-orm` 0.45.x, `drizzle-kit` 0.31.x — bản ổn định; bản 1.0 còn beta/RC, không dùng). Lược đồ ở `apps/api/src/db/schema/`, migration ở `apps/api/drizzle/`. Chọn Drizzle vì là SQL gần như thuần, kiểu dữ liệu chặt, AI agent viết và rà soát ổn định hơn.
- Lệnh CSDL (chạy trong `apps/api`): `pnpm db:generate` (sinh migration từ schema), `pnpm db:migrate` (áp dụng), `pnpm db:studio`. Sau khi đổi lược đồ chạy thêm `pnpm db:docs` để sinh lại `docs/db/` (DBML, từ điển dữ liệu, schema.sql) và commit kèm; xem `docs/db/README.md`. Lược đồ hiện có 44 bảng (đã kiểm chứng migration chạy được trên PostgreSQL). **Tìm kiếm theo tên/mã/SĐT** luôn dùng `searchWhere()` (`apps/api/src/db/search.ts`) — không tự viết `LIKE` (xem `docs/db/README.md`). **Luôn đọc file SQL migration được sinh ra trước khi chạy**; không sửa tay CSDL production.
