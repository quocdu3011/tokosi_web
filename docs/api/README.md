# Tài liệu API (dành cho frontend)

> **Trạng thái: bản thảo hợp đồng API (contract-first).** Backend chưa triển khai các endpoint dưới đây; tài liệu này là **thỏa thuận giữa backend và frontend** để hai bên làm song song. Frontend có thể dựng giao diện và dữ liệu giả (mock) theo đúng cấu trúc này.
> Backend phụ trách cập nhật tài liệu mỗi khi hợp đồng thay đổi và ghi vào [Nhật ký thay đổi](#nhật-ký-thay-đổi).

| Tệp                            | Nội dung                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `README.md` (tệp này)          | Quy ước chung: xác thực, định dạng dữ liệu, phân trang, lỗi, enum, quyền       |
| [`endpoints.md`](endpoints.md) | Danh sách endpoint theo từng phân hệ, kèm cấu trúc request/response và quy tắc |

Phạm vi nghiệp vụ và lý do thiết kế: [`../TAI_LIEU_THIET_KE.md`](../TAI_LIEU_THIET_KE.md) (mục 2.2 và 5).

## 1. Thông tin chung

| Mục              | Giá trị                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL         | `http://localhost:3001/api/v1` (dev). Staging/production sẽ bổ sung sau                                                                                                                                                         |
| Định dạng        | JSON, UTF-8, `Content-Type: application/json` (trừ upload: `multipart/form-data`)                                                                                                                                               |
| Đặt tên field    | **camelCase** trong JSON (CSDL dùng snake_case, backend tự chuyển)                                                                                                                                                              |
| ID               | UUID (chuỗi). Ngoài ra mỗi chứng từ/đối tác có **mã nghiệp vụ** dễ đọc: `HD016890`, `KH006974`                                                                                                                                  |
| Tài liệu máy đọc | **OpenAPI/Swagger** — giao diện: `http://localhost:3001/api/docs`; JSON: `http://localhost:3001/api/docs-json`; file tĩnh: [`openapi.json`](openapi.json) (xem mục 10). Đây là nguồn sự thật cho các endpoint **đã triển khai** |

### Header

| Header                                | Khi nào                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <accessToken>` | Mọi endpoint trừ `/auth/login`, `/auth/refresh`, `/health`                                                                                |
| `Idempotency-Key: <uuid>`             | **Bắt buộc** khi tạo hóa đơn, phiếu thu/chi, nhập hàng, trả hàng (xem mục 6)                                                              |
| `X-Branch-Id: <uuid>`                 | **Chi nhánh đang làm việc** (Hà Nội / Sài Gòn). Bắt buộc với thao tác ghi và khi người dùng có nhiều chi nhánh; xem mục "Nhiều chi nhánh" |

### Nhiều chi nhánh (Hà Nội, Sài Gòn)

Công ty có **2 chi nhánh dùng chung một hệ thống**. Người dùng làm việc trong **một chi nhánh tại một thời điểm**; giao diện cần một ô chọn chi nhánh (lấy danh sách từ `GET /auth/me` → `branches`) và gửi `X-Branch-Id` trong mọi yêu cầu.

| Dữ liệu                                                                                            | Dùng chung hay riêng chi nhánh                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hàng hóa (mã, tên, nhóm, đơn vị, ảnh), khách hàng, nhà cung cấp, 7 hạng giá, danh mục thu chi      | **Dùng chung**                                                           |
| Giá bán (từng ô trong lưới giá), tồn kho, giá vốn, giá nhập cuối, tồn tối thiểu/tối đa, vị trí kho | **Riêng từng chi nhánh**                                                 |
| Công nợ khách hàng và nhà cung cấp, hạn mức và kỳ hạn công nợ                                      | **Riêng từng chi nhánh**, tách biệt hoàn toàn (không cấn trừ chéo)       |
| Đơn hàng, hóa đơn, trả hàng, phiếu nhập, sổ quỹ (quỹ tiền mặt, ngân hàng), phiếu thu/chi           | **Riêng từng chi nhánh** — mỗi chứng từ có `branch` (Hà Nội hay Sài Gòn) |

- **`X-Branch-Id` thiếu** và người dùng chỉ có 1 chi nhánh (hoặc đã có chi nhánh mặc định) → dùng chi nhánh đó. Có nhiều chi nhánh mà không gửi → `400 BRANCH_REQUIRED`. Gửi chi nhánh không được phép → `403 BRANCH_FORBIDDEN`.
- **Ai thấy chi nhánh nào:** nhân viên chỉ thấy chi nhánh được gán; **Quản lý thấy cả hai**. Mọi danh sách chứng từ mặc định lọc theo chi nhánh làm việc; người có từ 2 chi nhánh trở lên có thể truyền `?branchId=<uuid>` hoặc `?branchId=all` (xem gộp). Báo cáo và Dashboard cũng nhận `branchId` như vậy.
- **Mọi danh sách chứng từ có cột chi nhánh** (`branch.code`/`branch.name`), có bộ lọc chi nhánh, và file Excel xuất ra có cột **Chi nhánh**.
- **Số liệu theo chi nhánh trả về dạng mảng:** `balances` (công nợ), `terms` (hạn mức), …, mỗi phần tử có `branchId` + `branchCode`. Frontend tự hiển thị từng chi nhánh và dòng tổng (cộng các phần tử); server không trả sẵn tổng chéo để tránh cộng nhầm.
- **Chuyển kho giữa 2 chi nhánh** coi chi nhánh kia là khách/nhà cung cấp nội bộ (`isInternalBranch = true`): không phải bán hàng nên **không tính vào doanh thu/lãi gộp**; các danh sách khách/nhà cung cấp và báo cáo mặc định ẩn các đối tác nội bộ. Xem `endpoints.md` mục 11.
- Chứng từ **không đổi chi nhánh** sau khi tạo. Trả hàng bán về **chi nhánh của hóa đơn gốc**; thu nợ chỉ cấn trừ hóa đơn **cùng chi nhánh**.

## 2. Xác thực

Chi tiết endpoint và ví dụ: [`endpoints.md`](endpoints.md) mục 1. Quy tắc chung:

- Đăng nhập nhận `accessToken` (**JWT HS256, sống 15 phút**) trong body, gửi trong header `Authorization: Bearer …`. Token chỉ chứa id người dùng; **vai trò, quyền, trạng thái tài khoản và chi nhánh luôn được server đọc lại ở mỗi yêu cầu** nên khóa tài khoản hay đổi vai trò/quyền có hiệu lực ngay.
- **Refresh token** là chuỗi ngẫu nhiên (không phải JWT) nằm trong **cookie httpOnly** `refresh_token` (`SameSite=Lax`, `Path=/api/v1/auth`, sống 14 ngày; có cờ `Secure` ở production). Frontend **không đọc được và không cần lưu**; chỉ cần gọi `fetch(..., { credentials: 'include' })` tới `/auth/*`.
- Khi API trả `401` với `code = TOKEN_EXPIRED`: gọi `POST /auth/refresh`, nhận `accessToken` mới rồi **thử lại đúng 1 lần** yêu cầu cũ. Nếu refresh cũng `401` → xóa mọi trạng thái đăng nhập và về trang đăng nhập. Các `401` khác (`UNAUTHENTICATED`) → về trang đăng nhập luôn.
- Lưu `accessToken` trong **bộ nhớ** (biến/state), không lưu `localStorage`/`sessionStorage`. Sau khi tải lại trang thì gọi `POST /auth/refresh` để lấy lại token (cookie vẫn còn).
- **Gom các lần refresh:** nếu nhiều yêu cầu cùng nhận `TOKEN_EXPIRED`, chỉ gọi refresh **một lần** (chia sẻ một Promise). Gọi song song có thể khiến một lời gọi bị từ chối.
- Sai mật khẩu nhiều lần bị chặn tạm (`429 RATE_LIMITED`). Đăng nhập, làm mới, đăng xuất, health là endpoint **công khai**; mọi endpoint còn lại cần token.
- CORS: backend cho phép origin của web (`http://localhost:3000` khi dev, biến `WEB_ORIGIN`) kèm credentials. Production cần HTTPS cho cookie `Secure`.

## 3. Kiểu dữ liệu

### Tiền, giá, số lượng — **luôn là chuỗi thập phân**

Để tránh sai số số thực, mọi giá trị tiền/giá/số lượng trong JSON là **chuỗi** (string), cả khi gửi lên lẫn nhận về.

| Loại             | Ví dụ JSON          | Ghi chú                                                            |
| ---------------- | ------------------- | ------------------------------------------------------------------ |
| Tiền chứng từ    | `"33735000"`        | Số nguyên đồng (không phần thập phân). Có thể âm (vd: số dư nợ âm) |
| Đơn giá, giá vốn | `"219967.9800"`     | Tối đa 4 chữ số thập phân                                          |
| Số lượng         | `"1095"`, `"2.500"` | Tối đa 3 chữ số thập phân (hiện dữ liệu là số nguyên)              |

- Frontend **chỉ hiển thị** (dùng `formatVnd` trong `@kiot/shared`) và nhập liệu; **không tự tính tổng tiền để lưu** — server là nơi tính lại và là nguồn sự thật. Nếu cần hiển thị tạm tổng trên form, dùng thư viện số thập phân (vd `decimal.js`), **không** dùng `number` để cộng nhiều dòng.
- Server luôn **tính lại** giá, thành tiền và tổng khi nhận đơn; giá client gửi chỉ là gợi ý (xem `pricing/quote` trong `endpoints.md`).

### Thời gian

- Chuỗi ISO 8601 **UTC**: `"2026-11-03T07:11:16.170Z"`. Hiển thị theo `Asia/Ho_Chi_Minh` (UTC+7) ở frontend.
- Ngày thuần (không giờ) dùng `YYYY-MM-DD`, ví dụ tham số `from=2026-11-01&to=2026-11-30` (hai đầu **gồm cả**, tính theo giờ Việt Nam).

### Giá trị rỗng

- Field không có giá trị: trả `null` (không bỏ field), **trừ field bị ẩn do không đủ quyền** (xem mục 8) — field đó **vắng mặt** hoàn toàn. Frontend phải xử lý `undefined`.

## 4. Phân trang, sắp xếp, tìm kiếm

Endpoint danh sách dùng phân trang theo trang:

```
GET /products?page=1&limit=20&sort=-createdAt&q=quat&categoryId=...
```

| Tham số | Mặc định | Ghi chú                                                                                                                                                                             |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`  | `1`      | Bắt đầu từ 1                                                                                                                                                                        |
| `limit` | `20`     | Tối đa `100`                                                                                                                                                                        |
| `sort`  | tùy API  | Tên field; thêm `-` phía trước để giảm dần. Nhiều field cách nhau dấu phẩy                                                                                                          |
| `q`     | —        | Tìm **không phân biệt dấu/hoa thường** theo mã, tên, SĐT (tùy endpoint); nhiều từ cách nhau bằng dấu cách = **mọi từ đều phải có**, khớp một phần (vd `quat kep` ra "Quạt kẹp bàn") |

Response:

```json
{
  "data": [/* mảng đối tượng */],
  "meta": { "page": 1, "limit": 20, "total": 2787, "totalPages": 140 }
}
```

- Endpoint chi tiết/tạo/sửa trả **đối tượng trực tiếp** (không bọc `data`).
- **Xuất Excel**: mọi endpoint danh sách nhận thêm `?format=xlsx` để tải file theo đúng bộ lọc hiện tại (bỏ qua `page/limit`, trả `Content-Disposition: attachment`). Báo cáo còn hỗ trợ `format=pdf`.

## 5. Lỗi

Mọi lỗi có cùng cấu trúc:

```json
{
  "code": "STOCK_NOT_ENOUGH",
  "message": "Không đủ tồn kho cho mặt hàng QKBSP",
  "details": [{ "field": "items[0].qty", "productId": "…", "available": "120" }],
  "requestId": "7f3a…"
}
```

- `code`: chuỗi ổn định, **frontend dựa vào `code`** để xử lý; `message`: tiếng Việt, có thể hiển thị cho người dùng.
- `details`: tùy lỗi; với lỗi dữ liệu nhập là mảng `{ field, message }` để gắn vào từng ô.
- `requestId`: gửi kèm khi báo lỗi cho backend. Luôn có trong **mọi** lỗi (kể cả 404, 500, JSON hỏng) và cũng nằm trong header phản hồi `X-Request-Id`. Frontend có thể tự gửi header `X-Request-Id` (8–64 ký tự `A-Z a-z 0-9 . _ -`) để nối log hai phía; không hợp lệ thì server tự sinh.
- Lỗi 500 **không** kèm chi tiết nội bộ; nguyên nhân chỉ nằm trong log của server, tra bằng `requestId`.
- Lỗi dữ liệu nhập: `code = VALIDATION_ERROR`, `message` = lỗi đầu tiên, `details` = `[{ field, message }]`; `field` theo đường dẫn JSON như `name`, `items[0].qty`. Field không khai báo cũng bị từ chối (`field` là tên field lạ).
- Các lỗi chung của HTTP cũng có `code` ổn định: `BAD_REQUEST` (400, vd JSON hỏng), `NOT_FOUND` (404 kể cả đường dẫn không tồn tại), `METHOD_NOT_ALLOWED` (405), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415); mã HTTP khác không có trong bảng dùng `HTTP_<mã>`.

| HTTP | `code`                      | Ý nghĩa / cách xử lý                                                                                                     |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`          | Dữ liệu sai; `details` chỉ rõ từng field (kể cả `id`/`branchId`… trên đường dẫn không phải UUID: `field` là tên tham số) |
| 400  | `INVALID_STATE`             | Thao tác không hợp lệ với trạng thái hiện tại (vd sửa đơn đã hoàn thành)                                                 |
| 401  | `UNAUTHENTICATED`           | Chưa đăng nhập / token sai → về trang đăng nhập                                                                          |
| 401  | `TOKEN_EXPIRED`             | Gọi `/auth/refresh` rồi thử lại 1 lần                                                                                    |
| 403  | `FORBIDDEN`                 | Không đủ quyền; ẩn/khóa chức năng tương ứng                                                                              |
| 403  | `PASSWORD_CHANGE_REQUIRED`  | Phải đổi mật khẩu trước (`user.mustChangePassword`) → chuyển sang màn hình đổi mật khẩu                                  |
| 404  | `NOT_FOUND`                 | Không tồn tại hoặc đã bị xóa                                                                                             |
| 409  | `DUPLICATE_CODE`            | Trùng mã (sản phẩm, khách…)                                                                                              |
| 409  | `DUPLICATE_PHONE`           | Trùng số điện thoại khách hàng                                                                                           |
| 409  | `DUPLICATE_USERNAME`        | Trùng tên đăng nhập (không phân biệt hoa thường)                                                                         |
| 409  | `DUPLICATE_NAME`            | Trùng tên (nhóm hàng cùng nhóm cha, bảng giá)                                                                            |
| 400  | `IMPORT_TYPE_NOT_SUPPORTED` | Loại nhập Excel chưa hỗ trợ (khách hàng, nhà cung cấp)                                                                   |
| 413  | `PAYLOAD_TOO_LARGE`         | File tải lên quá lớn (ảnh > 5 MB, file Excel > 10 MB)                                                                    |
| 502  | `STORAGE_ERROR`             | Kho lưu file ảnh lỗi; thử lại                                                                                            |
| 503  | `STORAGE_NOT_CONFIGURED`    | Máy chủ chưa cấu hình kho lưu file ảnh                                                                                   |
| 409  | `IDEMPOTENCY_CONFLICT`      | Cùng `Idempotency-Key` nhưng nội dung khác                                                                               |
| 409  | `VERSION_CONFLICT`          | Dữ liệu đã bị người khác sửa (gửi lại `updatedAt` mới nhất)                                                              |
| 422  | `STOCK_NOT_ENOUGH`          | Không đủ tồn để xuất hóa đơn                                                                                             |
| 422  | `CREDIT_LIMIT_EXCEEDED`     | Vượt hạn mức công nợ **(cảnh báo mềm ở MVP: xem `warnings` ở endpoint)**                                                 |
| 422  | `PRICE_NOT_FOUND`           | Sản phẩm không có giá ở bảng giá và cả bảng chung                                                                        |
| 422  | `ALLOCATION_EXCEEDS`        | Số tiền cấn trừ lớn hơn số còn nợ của hóa đơn                                                                            |
| 400  | `BRANCH_REQUIRED`           | Cần chọn chi nhánh làm việc (gửi `X-Branch-Id`)                                                                          |
| 403  | `BRANCH_FORBIDDEN`          | Không được phép làm việc với chi nhánh này                                                                               |
| 429  | `RATE_LIMITED`              | Gọi quá nhanh; thử lại sau                                                                                               |
| 500  | `INTERNAL_ERROR`            | Lỗi hệ thống; báo kèm `requestId`                                                                                        |

## 6. Idempotency (chống tạo trùng)

Các thao tác tạo chứng từ ảnh hưởng tiền/kho/nợ phải gửi `Idempotency-Key` (UUID mới **sinh một lần cho mỗi lần người dùng bấm "Lưu"**):

- Mạng chậm/timeout → frontend **gửi lại đúng key cũ**: server trả lại **kết quả ban đầu** (cùng chứng từ), không tạo bản mới.
- Người dùng bấm "Lưu" lần mới (sau khi sửa nội dung) → sinh key mới.
- Áp dụng cho: `POST /invoices`, `POST /orders/:id/invoice`, `POST /sales-returns`, `POST /goods-receipts`, `POST /purchase-returns`, `POST /cash-transactions`, `POST /customers/:id/receipts`.

## 7. Enum

| Tên                                | Giá trị                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `role`                             | `manager` (Quản lý), `assistant` (Trợ lý), `accountant` (Kế toán), `warehouse` (Kho), `driver` (Lái xe), `sales` (Sale), `marketing` (Marketing) |
| `customer.type`                    | `individual`, `company`                                                                                                                          |
| `supplier.kind`                    | `goods` (hàng hóa), `driver` (lái xe), `other`                                                                                                   |
| `order.status`                     | `draft` (phiếu tạm), `completed` (đã xuất hóa đơn), `cancelled`                                                                                  |
| `invoice.status`                   | `completed`, `cancelled`                                                                                                                         |
| `receipt.status` / `return.status` | `completed`, `cancelled`                                                                                                                         |
| `payment.method`                   | `cash` (tiền mặt), `bank` (chuyển khoản)                                                                                                         |
| `cashAccount.type`                 | `cash`, `bank`                                                                                                                                   |
| `cash.direction`                   | `in` (thu), `out` (chi)                                                                                                                          |
| `party.type`                       | `customer`, `supplier`, `employee`                                                                                                               |
| `return.settlement`                | `offset_debt` (bù trừ công nợ), `refund` (hoàn tiền)                                                                                             |
| `ledger.entryType`                 | `opening`, `invoice`, `payment`, `return`, `adjustment`                                                                                          |

## 8. Phân quyền

**Quyền của từng vai trò do Quản lý cấu hình trong hệ thống** (màn hình _Phân quyền_, API ở [`endpoints.md`](endpoints.md) mục 10), không cố định trong mã. Có 7 vai trò theo cơ cấu công ty:

| `role`       | Tên hiển thị |
| ------------ | ------------ |
| `manager`    | Quản lý      |
| `assistant`  | Trợ lý       |
| `accountant` | Kế toán      |
| `warehouse`  | Kho          |
| `driver`     | Lái xe       |
| `sales`      | Sale         |
| `marketing`  | Marketing    |

### Cách hoạt động

- Mỗi **quyền** có mã dạng `module.hành_động` (vd `invoice.create`). Danh mục quyền lấy từ `GET /permissions/catalog`; **không tự hard-code** danh sách quyền ở frontend.
- Mỗi vai trò có một tập quyền. Quyền hỗ trợ `scopable` còn có **phạm vi**: `all` (toàn bộ dữ liệu) hoặc `own` (**chỉ dữ liệu của mình**: khách mình phụ trách, đơn/hóa đơn mình bán). Backend tự lọc theo phạm vi; frontend chỉ nên hiện nhãn "Của tôi".
- **Quyền đi kèm (`requires`)**: bật `invoice.create` thì tự bật `invoice.view`, `order.view`, `customer.view`, `product.view`… Server tự thêm và báo trong `autoAdded`.
- **Vai trò Quản lý luôn có đủ quyền**, không chỉnh được (tránh tự khóa hệ thống). Hai quyền `user.manage` và `role.manage` **chỉ Quản lý có**, không cấp được cho vai trò khác.
- Thay đổi **có hiệu lực ngay** cho mọi người dùng thuộc vai trò đó, không cần đăng nhập lại.

### Frontend dùng thế nào

- `GET /auth/me` trả `permissions: [{ "code", "scope" }]` — **ẩn/khóa menu và nút theo `permissions`, không hard-code theo `role`**. Ví dụ `can('invoice.cancel')` = có phần tử mang mã đó.
- Gọi API mà thiếu quyền → `403` với `code = FORBIDDEN` và `details.permission` là mã quyền thiếu. Khi gặp lỗi này nên tải lại `GET /auth/me` (quyền có thể vừa bị đổi).
- **Một số trường dữ liệu chỉ xuất hiện khi có quyền tương ứng** (vắng mặt hoàn toàn, không phải `null`):

| Trường                                                            | Cần quyền                               |
| ----------------------------------------------------------------- | --------------------------------------- |
| `costPrice`, `lastPurchasePrice`, `unitCost`, lãi gộp             | `product.cost.view`                     |
| `balance`, `creditLimit`, `debt`, `paid` của khách / nhà cung cấp | `debt.view`                             |
| Sửa `basePrice` và bảng giá                                       | `price.edit`                            |
| Sửa `listPrice` trên dòng hàng khi tạo đơn                        | `price.override`                        |
| Giá trên phiếu giao hàng                                          | luôn ẩn (`delivery.view` không gồm giá) |

### Cấu hình mặc định (đề xuất ban đầu)

Dùng để khởi tạo lần đầu (`pnpm db:seed`) và cho nút "Khôi phục mặc định". **Chưa chốt với công ty** — Quản lý có thể chỉnh lại ngay trên hệ thống. Bảng dưới sinh tự động từ mã nguồn; "của mình" = phạm vi `own`.

| Quyền                                                        | Quản lý | Trợ lý | Kế toán | Kho | Lái xe |   Sale   | Marketing |
| ------------------------------------------------------------ | :-----: | :----: | :-----: | :-: | :----: | :------: | :-------: |
| **Hàng hóa**                                                 |         |        |         |     |        |          |           |
| `product.view` Xem hàng hóa                                  |    ✔    |   ✔    |    ✔    |  ✔  |        |    ✔     |     ✔     |
| `product.edit` Thêm/sửa hàng hóa                             |    ✔    |   ✔    |         |  ✔  |        |          |           |
| `product.content.edit` Sửa mô tả, ảnh hàng hóa               |    ✔    |        |         |     |        |          |     ✔     |
| `price.edit` Thiết lập giá                                   |    ✔    |        |    ✔    |     |        |          |           |
| `price.override` Sửa giá khi bán                             |    ✔    |        |         |     |        |          |           |
| `product.cost.view` Xem giá vốn / giá nhập                   |    ✔    |        |    ✔    |     |        |          |           |
| **Mua hàng**                                                 |         |        |         |     |        |          |           |
| `purchase.view` Xem mua hàng                                 |    ✔    |   ✔    |    ✔    |  ✔  |        |          |           |
| `purchase.edit` Nhập hàng / trả hàng nhập / sửa nhà cung cấp |    ✔    |   ✔    |    ✔    |  ✔  |        |          |           |
| `purchase.cancel` Hủy phiếu nhập / phiếu trả nhập            |    ✔    |        |    ✔    |     |        |          |           |
| **Kho & chuyển kho**                                         |         |        |         |     |        |          |           |
| `transfer.view` Xem phiếu chuyển kho                         |    ✔    |   ✔    |    ✔    |  ✔  |        |          |           |
| `transfer.create` Lập/hủy phiếu chuyển kho (bên gửi)         |    ✔    |   ✔    |         |  ✔  |        |          |           |
| `transfer.receive` Xác nhận nhận hàng chuyển kho (bên nhận)  |    ✔    |   ✔    |         |  ✔  |        |          |           |
| **Khách hàng**                                               |         |        |         |     |        |          |           |
| `customer.view` Xem khách hàng                               |    ✔    |   ✔    |    ✔    |  ✔  |        | của mình |     ✔     |
| `customer.edit` Thêm/sửa khách hàng                          |    ✔    |   ✔    |         |     |        | của mình |           |
| **Đơn hàng**                                                 |         |        |         |     |        |          |           |
| `order.view` Xem đơn đặt hàng                                |    ✔    |   ✔    |    ✔    |  ✔  |        | của mình |           |
| `order.create` Tạo/sửa/hủy đơn đặt hàng                      |    ✔    |   ✔    |         |     |        | của mình |           |
| `invoice.view` Xem hóa đơn                                   |    ✔    |   ✔    |    ✔    |  ✔  |        | của mình |           |
| `invoice.create` Xuất hóa đơn                                |    ✔    |   ✔    |         |     |        | của mình |           |
| `invoice.cancel` Hủy hóa đơn                                 |    ✔    |        |    ✔    |     |        |          |           |
| `return.create` Tạo phiếu trả hàng bán                       |    ✔    |   ✔    |         |     |        | của mình |           |
| `delivery.view` Xem/in phiếu giao hàng                       |    ✔    |   ✔    |    ✔    |  ✔  |   ✔    |    ✔     |           |
| **Sổ quỹ & công nợ**                                         |         |        |         |     |        |          |           |
| `cash.view` Xem sổ quỹ                                       |    ✔    |        |    ✔    |     |        |          |           |
| `cash.create` Lập phiếu thu/chi, thu nợ khách, trả nợ NCC    |    ✔    |        |    ✔    |     |        |          |           |
| `cash.cancel` Hủy phiếu thu/chi                              |    ✔    |        |    ✔    |     |        |          |           |
| `cash.manage` Quản lý quỹ và danh mục thu chi                |    ✔    |        |    ✔    |     |        |          |           |
| `debt.view` Xem công nợ khách / nhà cung cấp                 |    ✔    |   ✔    |    ✔    |     |        | của mình |           |
| **Tổng quan & báo cáo**                                      |         |        |         |     |        |          |           |
| `dashboard.view` Xem trang Tổng quan                         |    ✔    |        |    ✔    |     |        |          |           |
| `report.sales` Báo cáo doanh số                              |    ✔    |        |    ✔    |     |        | của mình |     ✔     |
| `report.inventory` Báo cáo tồn kho                           |    ✔    |        |    ✔    |  ✔  |        |          |           |
| `report.debt` Báo cáo công nợ                                |    ✔    |        |    ✔    |     |        |          |           |
| `report.cash` Báo cáo sổ quỹ                                 |    ✔    |        |    ✔    |     |        |          |           |
| **Hệ thống**                                                 |         |        |         |     |        |          |           |
| `import.run` Nhập dữ liệu từ Excel                           |    ✔    |        |         |     |        |          |           |
| `user.manage` Quản lý người dùng                             |    ✔    |        |         |     |        |          |           |
| `role.manage` Phân quyền cho vai trò                         |    ✔    |        |         |     |        |          |           |

### Câu hỏi còn mở (ảnh hưởng cấu hình mặc định)

1. **Trợ lý** làm những việc gì? (đề xuất: thay Quản lý nhập đơn/khách/hàng, không đụng tiền, giá vốn và người dùng)
2. **Lái xe** có đăng nhập hệ thống không, hay chỉ cần in phiếu giao hàng? (lái xe hiện cũng là nhà cung cấp loại `driver` để theo dõi công nợ)
3. **Sale** có được xem khách/đơn của Sale khác không? (đề xuất: chỉ của mình)
4. **Marketing** có cần xem số điện thoại khách và doanh số theo sản phẩm không?

## 9. Quy tắc nghiệp vụ frontend cần biết

1. **Giá bán** do server quyết định theo thứ tự: giá riêng khách (Phase 2) > **bảng giá của khách** (`defaultPriceBookId`) > **Bảng giá chung**. Giảm giá là **số tiền trên 1 đơn vị**, không phải %. Hiển thị `listPrice − discountPerUnit = unitPrice`.
2. **Công nợ có thể âm** (khách trả dư/ứng trước). Hiển thị số âm rõ ràng (vd "Dư có").
3. **Một đơn → tối đa một hóa đơn.** Hóa đơn đã tạo **không sửa**; muốn sửa thì hủy và tạo lại (có nhật ký).
4. **Không xóa chứng từ**: chỉ `cancel`. Chứng từ hủy vẫn xem được, có `status = cancelled`.
5. **Tồn kho** trong danh sách là số dẫn xuất: `onHand` (thực tồn), `reserved` (khách đã đặt, đơn `draft`), `available = onHand − reserved`, `onOrder` (đang đặt NCC). Không cho sửa trực tiếp.
6. **Thu nợ khách** tạo phiếu thu gắn theo khách; server tự cấn trừ vào hóa đơn cũ nhất còn nợ, trừ khi client gửi `allocations` chọn tay.
7. Mã chứng từ do server cấp (`code`), frontend không tự sinh.
8. Danh sách lớn (sản phẩm 2.787, khách 1.665): luôn phân trang + tìm theo `q`; ô chọn hàng/khách trong màn hình tạo đơn dùng endpoint `lookup` nhẹ hơn.
9. **Nhiều chi nhánh:** mọi dữ liệu theo chi nhánh (giá, tồn, giá vốn, công nợ, chứng từ, quỹ) tính theo chi nhánh làm việc (`X-Branch-Id`). Không tự cộng gộp hai chi nhánh ở frontend khi chưa chắc: dùng `branchId=all` của báo cáo, hoặc cộng các phần tử `balances` có cùng loại tiền. Giá của chi nhánh này **không bao giờ** được dùng cho chi nhánh kia.

## 10. Làm việc song song frontend ↔ backend

- Frontend dựng mock theo đúng JSON mẫu trong `endpoints.md`; khi backend xong endpoint thì đổi sang gọi thật. Cột **Mốc** ở `endpoints.md` cho biết tuần dự kiến backend xong (theo lộ trình 2 tháng, mục 13 tài liệu thiết kế).
- Khi cần thêm/sửa field hoặc endpoint: nhờ backend sửa tài liệu này **trước**, rồi mới code. Không tự suy đoán field chưa có trong tài liệu.
- **Sinh kiểu TypeScript từ OpenAPI** (khuyến nghị, không gõ tay): `openapi.json` luôn được backend cập nhật cùng PR khi có endpoint mới. Ví dụ dùng `openapi-typescript`: `npx openapi-typescript ../../docs/api/openapi.json -o src/lib/api-types.ts`.
- Phân biệt hai nguồn: `endpoints.md` = **kế hoạch/hợp đồng** cho cả những endpoint chưa làm; `openapi.json` / Swagger = **những gì backend đã triển khai thật** (hiện mới có `GET /health`). Endpoint nào có trong cả hai thì OpenAPI là chuẩn về kiểu dữ liệu.
- Backend xuất lại file: chạy `pnpm openapi:export` trong `apps/api`.

## Nhật ký thay đổi

| Ngày       | Thay đổi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-03 | Tạo bản thảo hợp đồng API đầu tiên (chưa triển khai)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-11-03 | Cài Swagger: giao diện `/api/docs`, JSON `/api/docs-json`, file `openapi.json`; triển khai `GET /health`; tiền tố `/api/v1`, CORS có credentials, kiểm tra dữ liệu vào bằng DTO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-11-03 | Đổi vai trò từ 4 sang 7 theo cơ cấu công ty: `manager`, `assistant`, `accountant`, `warehouse`, `driver`, `sales`, `marketing`; thêm khái niệm dữ liệu "của mình" cho Sale; cập nhật bảng phân quyền (đề xuất)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-11-03 | **Phân quyền cấu hình được:** quyền từng vai trò lưu trong CSDL, Quản lý chỉnh qua API mới (`/permissions/catalog`, `/roles…`, endpoints.md mục 10); `GET /auth/me` trả `permissions` dạng `[{ code, scope }]` (trước đây là mảng chuỗi); phạm vi `all`/`own`; quyền đi kèm `requires`; tách `report.view` thành `dashboard.view`, `report.sales/inventory/debt/cash`; thêm `debt.view`, `delivery.view`, `product.content.edit`, `price.override`; một số trường chỉ có khi đủ quyền                                                                                                                                                                                                                                                                                                     |
| 2026-11-04 | **Nhiều chi nhánh (Hà Nội, Sài Gòn):** giá bán, tồn kho, giá vốn, công nợ, hạn mức, quỹ riêng từng chi nhánh; `X-Branch-Id` bắt buộc cho thao tác ghi; `GET /auth/me` trả `branches`; sản phẩm tách trường dùng chung và theo chi nhánh, thêm `GET/PUT /products/:id/branches…`; lưới giá nhận `branchId`, thêm `POST /price-books/copy-branch`; khách/nhà cung cấp trả `balances`/`terms` theo chi nhánh và cờ `isInternalBranch`; mọi chứng từ có `branch`; **chuyển kho** hai bước (`/stock-transfers…`, mục 11) và quyền `transfer.view/create/receive`; lỗi `BRANCH_REQUIRED`, `BRANCH_FORBIDDEN`                                                                                                                                                                                    |
| 2026-11-04 | **Đăng nhập JWT đã triển khai:** `/auth/login`, `/auth/refresh` (xoay vòng refresh token, phát hiện dùng lại), `/auth/logout` (công khai, dùng cookie → `204`), `/auth/me`, `/auth/change-password`, `GET /branches`; `user` có thêm `username`; mã lỗi mới `PASSWORD_CHANGE_REQUIRED` (403); `RATE_LIMITED` khi sai mật khẩu quá 5 lần; refresh token không còn là JWT nên bỏ `JWT_REFRESH_SECRET`                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-11-04 | **Mọi lỗi đúng hợp đồng `{ code, message, details, requestId }`**: lỗi dữ liệu nhập (`VALIDATION_ERROR`) có `details: [{ field, message }]`; 404/405/JSON hỏng/500 không còn dạng mặc định của Nest/Express; thêm header `X-Request-Id` (nhận và trả); mã lỗi chung `BAD_REQUEST`, `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`; chi nhánh mặc định đổi sang **Hà Nội**                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-11-04 | Nhà cung cấp có thêm trường **`groupName`** (nhóm nhà cung cấp, chuỗi tự do, có thể `null`; nhận ở POST/PATCH, lọc bằng `?groupName=`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-11-04 | **Quản lý người dùng đã triển khai:** `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/reset-password`, `PUT /users/:id/branches`; mã lỗi mới `DUPLICATE_USERNAME` (409); mật khẩu tạm do hệ thống sinh chỉ trả một lần                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-11-04 | Người dùng: số điện thoại được **chuẩn hóa** (`+84 901 234 567` → `0901234567`) và kiểm tra định dạng; `409 DUPLICATE_CODE` khi bộ đếm mã nhân viên lệch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-11-05 | **Phân hệ Hàng hóa đã triển khai** (mục 2.1–2.3, 9): nhóm hàng; danh sách hàng hóa (lọc, tìm không dấu, theo chi nhánh), thẻ kho, tồn tối thiểu/tối đa theo chi nhánh; **tải nhiều ảnh một lần** (kho file S3, mỗi ảnh một URL, thêm `GET/PUT order/DELETE` ảnh); thiết lập giá (lưới giá theo chi nhánh, lưu lưới, tăng/giảm hàng loạt có `dryRun` BẮT BUỘC, sao chép giữa chi nhánh, đổi tên/tắt bảng giá); xuất Excel `?format=xlsx`; nhập Excel `products`/`price-books` (xử lý ngay trong yêu cầu, `dryRun` mặc định `true`, tất cả hoặc không gì cả). `GET /categories` và `GET /price-books` cần quyền `product.view` (trước ghi "đăng nhập"). Quantity trả dạng `"515.000"`. Mã lỗi mới: `DUPLICATE_NAME`, `IMPORT_TYPE_NOT_SUPPORTED`, `STORAGE_ERROR`, `STORAGE_NOT_CONFIGURED` |
| 2026-11-06 | Tham số đường dẫn (`:id`, `:imageId`, `:branchId`) sai dạng UUID nay trả `400 VALIDATION_ERROR` với `details: [{ field, message }]` (trước đây `BAD_REQUEST`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
