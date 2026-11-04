# Danh sách endpoint

> Bản thảo hợp đồng — xem quy ước chung (xác thực, tiền là chuỗi, phân trang, lỗi, idempotency) tại [`README.md`](README.md). Tất cả đường dẫn dưới đây có tiền tố `/api/v1`.
> Cột **Mốc** = tuần backend dự kiến xong (W1 = tuần bắt đầu 09/11/2026, theo mục 13 tài liệu thiết kế). Cột **Quyền** là quyền tối thiểu để gọi.

## Mục lục

1. [Hệ thống & xác thực](#1-hệ-thống--xác-thực)
2. [Hàng hóa](#2-hàng-hóa)
3. [Mua hàng](#3-mua-hàng)
4. [Khách hàng](#4-khách-hàng)
5. [Đơn hàng](#5-đơn-hàng)
6. [Sổ quỹ](#6-sổ-quỹ)
7. [Tổng quan](#7-tổng-quan)
8. [Báo cáo](#8-báo-cáo)
9. [Nhập dữ liệu từ Excel](#9-nhập-dữ-liệu-từ-excel)

Ký hiệu: `?` = tùy chọn · `[]` = mảng · tiền/giá/số lượng là **chuỗi** (xem README mục 3).

---

## 1. Hệ thống & xác thực

> **Trạng thái: đã triển khai** (có trong Swagger `/api/docs` và `openapi.json`) — `/health`, `/auth/*`, `/branches`, `/roles…`, `/permissions/catalog`.

| Method         | Đường dẫn                   | Mô tả                                                     | Quyền                   | Mốc |
| -------------- | --------------------------- | --------------------------------------------------------- | ----------------------- | --- |
| GET            | `/health`                   | Kiểm tra sống                                             | công khai               | ✔   |
| POST           | `/auth/login`               | Đăng nhập                                                 | công khai               | ✔   |
| POST           | `/auth/refresh`             | Lấy access token mới (dùng cookie `refresh_token`)        | công khai (cần cookie)  | ✔   |
| POST           | `/auth/logout`              | Đăng xuất: thu hồi phiên hiện tại, xóa cookie             | công khai (dùng cookie) | ✔   |
| GET            | `/auth/me`                  | Thông tin người dùng + quyền + chi nhánh hiện tại         | đã đăng nhập            | ✔   |
| POST           | `/auth/change-password`     | Đổi mật khẩu (thu hồi mọi phiên cũ, cấp phiên mới)        | đã đăng nhập            | ✔   |
| GET            | `/branches`                 | Chi nhánh người dùng được phép làm việc (Quản lý: tất cả) | đã đăng nhập            | ✔   |
| GET/POST/PATCH | `/users`, `/users/:id`      | Quản lý người dùng                                        | `user.manage`           | W8  |
| POST           | `/users/:id/reset-password` | Đặt lại mật khẩu (đặt lại cờ `mustChangePassword`)        | `user.manage`           | W8  |
| PUT            | `/users/:id/branches`       | Gán chi nhánh cho người dùng `{ branchIds: [...] }`       | `user.manage`           | W8  |

**POST `/auth/login`**

```jsonc
// request  (tên đăng nhập không phân biệt hoa thường; khoảng trắng hai đầu được bỏ)
{ "username": "ketoan01", "password": "••••••••" }

// 200 response  — kèm  Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Expires=…
{
  "accessToken": "eyJhbGciOi…",            // JWT, gửi trong header  Authorization: Bearer …
  "expiresIn": 900,                        // giây (15 phút)
  "user": {
    "id": "0192…", "code": "NV0001", "username": "ketoan01", "fullName": "Nguyễn Văn A",
    "role": "accountant",
    "mustChangePassword": false,           // true → chỉ gọi được /auth/me, /auth/change-password, /auth/logout
    "permissions": [                       // theo cấu hình hiện tại của vai trò (Quản lý chỉnh được)
      { "code": "invoice.view",   "scope": "own" },   // "own" = chỉ dữ liệu của mình
      { "code": "invoice.create", "scope": "own" },
      { "code": "product.view",   "scope": "all" }
    ],
    "defaultBranchId": "0192…",            // null nếu chưa có chi nhánh mặc định → người dùng phải chọn
    "branches": [                          // chi nhánh người dùng được làm việc (Quản lý: tất cả)
      { "id": "0192…", "code": "SG", "name": "Chi nhánh Sài Gòn" },
      { "id": "0193…", "code": "HN", "name": "Chi nhánh Hà Nội" }
    ]
  }
}
```

| HTTP | `code`             | Khi nào                                                                                                    |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`  | Sai tên đăng nhập, sai mật khẩu hoặc tài khoản bị khóa — **luôn cùng một thông báo**, không nói rõ cái nào |
| 429  | `RATE_LIMITED`     | Sai quá 5 lần trong 15 phút (theo IP + tên đăng nhập); `details.retryAfterSeconds` = số giây phải chờ      |
| 400  | `VALIDATION_ERROR` | Thiếu `username` / `password` hoặc sai kiểu                                                                |

**POST `/auth/refresh`** — không có body; trình duyệt tự gửi cookie (frontend gọi với `credentials: 'include'`).

```jsonc
// 200  — kèm Set-Cookie: refresh_token=… (cookie MỚI; cái cũ đã bị thu hồi)
{ "accessToken": "eyJhbGciOi…", "expiresIn": 900 }
// 401 UNAUTHENTICATED: thiếu cookie / hết hạn / đã thu hồi / tài khoản bị khóa → về trang đăng nhập (cookie bị xóa)
```

- **Xoay vòng:** mỗi lần làm mới sinh refresh token mới. **Không gọi refresh song song** từ nhiều tab/nơi cùng lúc; hãy gom thành một lời gọi duy nhất (dùng chung một Promise) rồi thử lại các yêu cầu đang chờ.
- Dùng lại một refresh token đã bị thu hồi từ lâu (dấu hiệu bị đánh cắp) → **mọi phiên của người dùng đó bị đăng xuất**.

**POST `/auth/logout`** → `204`. Thu hồi phiên hiện tại và xóa cookie; gọi lặp lại hoặc khi không có cookie vẫn trả `204`. Access token đang cầm vẫn còn hiệu lực tới khi hết hạn (tối đa 15 phút) nên frontend phải **xóa nó khỏi bộ nhớ**.

**GET `/auth/me`** → đối tượng `user` như trên (quyền và chi nhánh luôn là giá trị **hiện tại**). Gọi lại khi tải trang, khi nhận `403 FORBIDDEN`, hoặc sau khi Quản lý đổi phân quyền.

**POST `/auth/change-password`**

```jsonc
// request
{ "currentPassword": "••••••••", "newPassword": "••••••••••••" }

// 200 — cùng cấu trúc như login (access token MỚI + cookie MỚI); mustChangePassword = false
{ "accessToken": "…", "expiresIn": 900, "user": { /* như trên */ } }
```

- Mật khẩu mới: **10–128 ký tự**, khác mật khẩu hiện tại, **không chứa tên đăng nhập**. Sai → `400 VALIDATION_ERROR` kèm `details: [{ field, message }]` để gắn vào từng ô.
- Mật khẩu hiện tại sai → `400 VALIDATION_ERROR`, `details[0].field = "currentPassword"`.
- Thu hồi **mọi phiên cũ ở mọi thiết bị**; thiết bị đang đổi mật khẩu nhận phiên mới ngay.

**Tài khoản bị bắt đổi mật khẩu (`mustChangePassword = true`)** — gặp ở tài khoản Quản lý khởi tạo và tài khoản vừa được đặt lại mật khẩu. Mọi endpoint khác ngoài `/auth/me`, `/auth/change-password`, `/auth/logout` trả `403 PASSWORD_CHANGE_REQUIRED`. Frontend: sau khi đăng nhập, nếu `user.mustChangePassword` là true thì chuyển thẳng sang màn hình đổi mật khẩu.

**GET `/branches`** → `[ { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn", "isDefault": true } ]` — chỉ các chi nhánh người dùng được phép (đã sắp theo mã).

---

## 2. Hàng hóa

### 2.1 Nhóm hàng

| Method | Đường dẫn         | Mô tả                                    | Quyền          | Mốc |
| ------ | ----------------- | ---------------------------------------- | -------------- | --- |
| GET    | `/categories`     | Cây nhóm hàng (không phân trang)         | đăng nhập      | W2  |
| POST   | `/categories`     | Tạo nhóm `{ name, parentId? }`           | `product.edit` | W2  |
| PATCH  | `/categories/:id` | Đổi tên / chuyển nhóm cha                | `product.edit` | W2  |
| DELETE | `/categories/:id` | Xóa (chỉ khi không còn hàng và nhóm con) | `product.edit` | W2  |

```json
// GET /categories
[
  {
    "id": "…",
    "name": "NHÀ BẾP",
    "parentId": null,
    "productCount": 310,
    "children": [
      { "id": "…", "name": "Nồi chảo", "parentId": "…", "productCount": 54, "children": [] }
    ]
  }
]
```

### 2.2 Danh sách hàng hóa

| Method | Đường dẫn                          | Mô tả                                                                        | Quyền          | Mốc |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------- | -------------- | --- |
| GET    | `/products`                        | Danh sách, lọc, phân trang                                                   | đăng nhập      | W2  |
| GET    | `/products/lookup?q=`              | Tìm nhanh cho ô chọn hàng (tối đa 20 dòng, không phân trang)                 | đăng nhập      | W2  |
| GET    | `/products/:id`                    | Chi tiết                                                                     | đăng nhập      | W2  |
| POST   | `/products`                        | Tạo                                                                          | `product.edit` | W2  |
| PATCH  | `/products/:id`                    | Sửa (gồm ngưng bán `isActive=false`)                                         | `product.edit` | W2  |
| POST   | `/products/:id/images`             | Tải ảnh (`multipart/form-data`, field `file`)                                | `product.edit` | W3  |
| DELETE | `/products/:id/images/:imageId`    | Xóa ảnh                                                                      | `product.edit` | W3  |
| GET    | `/products/:id/stock-card?from&to` | **Thẻ kho**: lịch sử nhập–xuất                                               | đăng nhập      | W4  |
| GET    | `/products/:id/branches`           | Chi tiết theo từng chi nhánh người dùng được phép: giá, tồn, giá vốn, vị trí | đăng nhập      | W4  |
| PUT    | `/products/:id/branches/:branchId` | Đặt tồn tối thiểu/tối đa và vị trí kho của một chi nhánh                     | `product.edit` | W4  |

Bộ lọc `GET /products`: `q`, `categoryId` (gồm cả nhóm con), `isActive`, `inStock` (`true` = còn tồn), `sort` (`code`, `name`, `onHand`, `createdAt`).

```json
// Đối tượng Product
{
  "id": "0192…",
  "code": "QKBSP",
  "name": "Quạt kẹp bàn Super MST-A1",
  "categoryId": "…",
  "categoryPath": "ĐIỆN GIA DỤNG > Quạt điện",
  "unit": "Cái",
  "branchId": "…", // chi nhánh mà các trường giá/tồn/vị trí dưới đây tính cho (= X-Branch-Id)
  "basePrice": "33500", // giá Bảng giá chung TẠI chi nhánh này
  "costPrice": "21800.5000", // giá vốn bình quân CỦA chi nhánh này; vắng mặt nếu thiếu quyền product.cost.view
  "lastPurchasePrice": "21500.0000", // giá nhập cuối của chi nhánh này; như trên
  "onHand": "515",
  "reserved": "40",
  "available": "475",
  "onOrder": "1000",
  "minStock": null,
  "maxStock": "2000",
  "location": "11",
  "description": null,
  "weightG": null,
  "images": [{ "id": "…", "url": "https://…/a.jpg", "sortOrder": 0 }],
  "isActive": true,
  "isSellable": true,
  "createdAt": "2026-11-03T01:30:11.087Z",
  "updatedAt": "…"
}
```

```json
// POST /products  (body)
{
  "code": "QKBSP",
  "name": "…",
  "categoryId": "…",
  "unit": "Cái",
  "description": null,
  "weightG": null,
  "isSellable": true
}
// Body chỉ chứa thông tin DÙNG CHUNG cho cả hai chi nhánh. Giá bán đặt qua lưới giá (mục 2.3);
// tồn tối thiểu/tối đa và vị trí kho đặt riêng từng chi nhánh qua PUT /products/:id/branches/:branchId.
// Lỗi: 409 DUPLICATE_CODE
```

**Phân biệt dữ liệu dùng chung và theo chi nhánh:** mã, tên, nhóm, đơn vị, ảnh, mô tả dùng chung; **giá bán, tồn kho, giá vốn, giá nhập cuối, tồn tối thiểu/tối đa, vị trí kho riêng từng chi nhánh**. Các trường theo chi nhánh trong response của `GET /products…` luôn tính cho chi nhánh làm việc (`X-Branch-Id`); muốn xem cả hai chi nhánh dùng `GET /products/:id/branches`.

Quy ước: `code` duy nhất, tối đa 30 ký tự, chỉ chữ/số/`-`/`_`/`.`, không dấu cách; **không đổi sau khi đã có giao dịch**. `onHand/reserved/available/onOrder` chỉ đọc.

```json
// GET /products/lookup?q=quat  →  mảng gọn
[
  {
    "id": "…",
    "code": "QKBSP",
    "name": "Quạt kẹp bàn Super MST-A1",
    "unit": "Cái",
    "basePrice": "33500",
    "available": "475",
    "imageUrl": "https://…/a.jpg"
  }
]
```

```json
// GET /products/:id/stock-card?from=2026-11-01&to=2026-11-30
{
  "openingQty": "400",
  "movements": [
    {
      "occurredAt": "…",
      "refType": "goods_receipt",
      "refId": "…",
      "refCode": "PN000948",
      "qtyDelta": "600",
      "balance": "1000",
      "unitCost": "1179.9700"
    },
    {
      "occurredAt": "…",
      "refType": "invoice",
      "refCode": "HD016890",
      "qtyDelta": "-515",
      "balance": "485"
    }
  ],
  "closingQty": "485"
}
```

`refType`: `opening`, `goods_receipt`, `invoice`, `sales_return`, `purchase_return`, `adjustment`.

### 2.3 Thiết lập giá

Có **7 bảng giá**: Chung (mặc định), Lớn, Vừa, VIP, và 3 bản VAT. Mỗi sản phẩm có thể chưa có giá ở một bảng; khi bán, bảng nào thiếu giá thì **lùi về Bảng giá chung**.

| Method | Đường dẫn                  | Mô tả                                                                         | Quyền        | Mốc |
| ------ | -------------------------- | ----------------------------------------------------------------------------- | ------------ | --- |
| GET    | `/price-books`             | Danh sách bảng giá                                                            | đăng nhập    | W2  |
| PATCH  | `/price-books/:id`         | Đổi tên / bật tắt                                                             | `price.edit` | W3  |
| GET    | `/price-books/grid`        | **Lưới giá**: mỗi dòng = 1 sản phẩm, mỗi cột = 1 bảng giá                     | đăng nhập    | W3  |
| PUT    | `/price-books/grid`        | Lưu nhiều ô giá cùng lúc                                                      | `price.edit` | W3  |
| POST   | `/price-books/bulk-adjust` | Tăng/giảm giá hàng loạt (có chế độ xem trước)                                 | `price.edit` | W3  |
| POST   | `/price-books/copy-branch` | Sao chép giá từ chi nhánh này sang chi nhánh kia (khởi tạo giá chi nhánh mới) | `price.edit` | W3  |

```json
// GET /price-books
[
  {
    "id": "…",
    "code": "CHUNG",
    "name": "Bảng giá chung",
    "withVat": false,
    "isDefault": true,
    "isActive": true
  },
  {
    "id": "…",
    "code": "LON",
    "name": "Lớn",
    "withVat": false,
    "isDefault": false,
    "isActive": true
  },
  {
    "id": "…",
    "code": "LON_VAT",
    "name": "Lớn VAT",
    "withVat": true,
    "isDefault": false,
    "isActive": true
  }
]
```

```json
// GET /price-books/grid?branchId=…&q=&categoryId=&page=1&limit=50   (branchId mặc định = chi nhánh làm việc)
{
  "branchId": "…",
  "books": [
    { "id": "…", "code": "CHUNG", "name": "Bảng giá chung" },
    { "id": "…", "code": "LON", "name": "Lớn" }
  ],
  "data": [
    {
      "productId": "…",
      "code": "QKBSP",
      "name": "Quạt kẹp bàn…",
      "costPrice": "21800.5000",
      "prices": {
        "<priceBookId CHUNG>": "33500",
        "<priceBookId LON>": "33000",
        "<priceBookId VIP>": null
      }
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 2787, "totalPages": 56 }
}
```

```json
// PUT /price-books/grid  (chỉ gửi các ô thay đổi; price = null nghĩa là xóa giá, lùi về bảng chung)
{ "branchId": "…", "changes": [{ "productId": "…", "priceBookId": "…", "price": "33000" }] }
// 200: { "updated": 1 }
```

```json
// POST /price-books/bulk-adjust
{
  "branchId": "…", // chi nhánh được điều chỉnh giá
  "priceBookId": "…",
  "categoryId": "…?",
  "mode": "percent", // "percent" | "amount"
  "value": "5", // tăng 5%  (số âm = giảm)
  "roundTo": "100", // làm tròn đến bội số này (tùy chọn)
  "dryRun": true // true = chỉ trả bản xem trước, chưa lưu
}
// 200: { "affected": 54, "preview": [{ "productId": "…", "code": "…", "oldPrice": "33000", "newPrice": "34700" }] }
```

**Giá theo chi nhánh:** 7 hạng giá dùng chung cho hai chi nhánh, nhưng **số tiền của từng ô giá là riêng từng chi nhánh**. Màn hình lưới giá cần chọn chi nhánh (tab/ô chọn). Khi bán, giá tra theo chi nhánh của đơn → hạng giá của khách → nếu thiếu thì lùi về Bảng giá chung **của cùng chi nhánh** (không lấy giá chi nhánh kia).

```json
// POST /price-books/copy-branch
{ "fromBranchId": "…", "toBranchId": "…", "priceBookId": "…?", "overwrite": false }
// overwrite=false: chỉ chép các ô chi nhánh đích chưa có giá. 200: { "copied": 1840, "skipped": 120 }
```

### 2.4 Báo giá cho màn hình tạo đơn

| Method | Đường dẫn        | Mô tả                                                              | Quyền     | Mốc |
| ------ | ---------------- | ------------------------------------------------------------------ | --------- | --- |
| POST   | `/pricing/quote` | Tính giá niêm yết, tồn và cảnh báo cho các dòng hàng của một khách | đăng nhập | W3  |

Dùng khi người dùng chọn khách / thêm hàng để **hiển thị đúng giá và tồn tức thì**. Đây chỉ là báo giá; khi lưu đơn server tính lại. **Giá, tồn và công nợ tính theo chi nhánh làm việc (`X-Branch-Id`)** — công nợ và hạn mức là của khách tại chi nhánh đó.

```json
// request
{ "customerId": "…", "priceBookId": "…?", "items": [{ "productId": "…", "qty": "100" }] }

// response
{
  "priceBookId": "…",                 // bảng giá thực tế được áp dụng
  "lines": [
    { "productId": "…", "listPrice": "33500", "priceSource": "book",   // "book" | "base" (đã lùi về bảng chung)
      "onHand": "515", "available": "475", "enoughStock": true }
  ],
  "customer": { "balance": "12500000", "creditLimit": "50000000", "overLimit": false }
}
```

---

## 3. Mua hàng

### 3.1 Nhà cung cấp

| Method | Đường dẫn                       | Mô tả                                          | Quyền           | Mốc |
| ------ | ------------------------------- | ---------------------------------------------- | --------------- | --- |
| GET    | `/suppliers`                    | Danh sách (`q`, `kind`, `hasDebt`, `isActive`) | `purchase.view` | W3  |
| GET    | `/suppliers/:id`                | Chi tiết + `balance`                           | `purchase.view` | W3  |
| POST   | `/suppliers`                    | Tạo                                            | `purchase.edit` | W3  |
| PATCH  | `/suppliers/:id`                | Sửa / ngưng                                    | `purchase.edit` | W3  |
| GET    | `/suppliers/:id/ledger?from&to` | Sổ công nợ NCC                                 | `purchase.view` | W7  |

```json
// Supplier
{
  "id": "…",
  "code": "NCC000002",
  "name": "Công ty TNHH ABC",
  "kind": "goods",
  "phone": "0901234567",
  "address": null,
  "taxCode": null,
  "note": null,
  "isInternalBranch": false, // true = nhà cung cấp hệ thống đại diện một chi nhánh (chuyển kho nội bộ)
  "balances": [
    // công nợ TÁCH BIỆT theo chi nhánh (chỉ các chi nhánh người dùng được phép); + = mình còn nợ NCC; có thể âm
    { "branchId": "…", "branchCode": "SG", "balance": "240000000" },
    { "branchId": "…", "branchCode": "HN", "balance": "0" }
  ],
  "isActive": true,
  "createdAt": "…"
}
```

Lưu ý: `phone` không kiểm tra định dạng (dữ liệu cũ có nhiều giá trị không phải số điện thoại).

**Sổ công nợ** (dùng chung cấu trúc cho khách và NCC):

```json
{
  "openingBalance": "0",
  "entries": [
    {
      "occurredAt": "…",
      "entryType": "invoice",
      "refCode": "HD016890",
      "refId": "…",
      "amount": "33735000",
      "balance": "33735000",
      "note": null
    },
    {
      "occurredAt": "…",
      "entryType": "payment",
      "refCode": "TT019327",
      "amount": "-12390000",
      "balance": "21345000"
    }
  ],
  "closingBalance": "21345000"
}
```

`amount` dương = tăng nợ, âm = giảm nợ.

### 3.2 Nhập hàng

| Method | Đường dẫn                    | Mô tả                                                 | Quyền             | Mốc |
| ------ | ---------------------------- | ----------------------------------------------------- | ----------------- | --- |
| GET    | `/goods-receipts`            | Danh sách (`q`, `supplierId`, `status`, `from`, `to`) | `purchase.view`   | W7  |
| GET    | `/goods-receipts/:id`        | Chi tiết                                              | `purchase.view`   | W7  |
| POST   | `/goods-receipts`            | Tạo phiếu nhập (**Idempotency-Key**)                  | `purchase.edit`   | W7  |
| POST   | `/goods-receipts/:id/cancel` | Hủy phiếu `{ reason }`                                | `purchase.cancel` | W7  |
| GET    | `/goods-receipts/:id/print`  | PDF A4                                                | `purchase.view`   | W7  |

```json
// POST /goods-receipts
{
  "supplierId": "…",
  "receivedAt": "2026-11-03T04:00:00.000Z", // tùy chọn, mặc định = bây giờ
  "supplierInvoiceNo": null, // số hóa đơn đầu vào
  "poRef": "PDN000394", // mã phiếu đặt nhập (chỉ để đối chiếu, dạng chữ)
  "discount": "0",
  "note": "Lô hàng tháng 10",
  "items": [{ "productId": "…", "qty": "1095", "unitCost": "219967.9800", "note": null }],
  "payment": { "accountId": "…", "amount": "0" } // tùy chọn: trả ngay một phần
}
```

Response (chi tiết):

```json
{
  "id": "…",
  "code": "PN000946",
  "status": "completed",
  "supplier": { "id": "…", "code": "NCC000001", "name": "Công ty TNHH ABC" },
  "receivedAt": "…",
  "supplierInvoiceNo": null,
  "poRef": "PDN000394",
  "subtotal": "240000000",
  "discount": "0",
  "total": "240000000",
  "paid": "0",
  "debt": "240000000",
  "items": [
    {
      "productId": "…",
      "code": "LUMI5T",
      "name": "…",
      "qty": "1095",
      "unitCost": "219967.9800",
      "lineTotal": "240000000"
    }
  ],
  "note": "…",
  "createdBy": { "id": "…", "fullName": "…" },
  "createdAt": "…"
}
```

Sau khi lưu server cộng tồn, tính lại **giá vốn bình quân** và ghi công nợ NCC.

### 3.3 Trả hàng nhập

| Method | Đường dẫn                      | Mô tả                                       | Quyền             | Mốc |
| ------ | ------------------------------ | ------------------------------------------- | ----------------- | --- |
| GET    | `/purchase-returns`            | Danh sách (`q`, `supplierId`, `from`, `to`) | `purchase.view`   | W7  |
| GET    | `/purchase-returns/:id`        | Chi tiết                                    | `purchase.view`   | W7  |
| POST   | `/purchase-returns`            | Tạo (**Idempotency-Key**)                   | `purchase.edit`   | W7  |
| POST   | `/purchase-returns/:id/cancel` | Hủy                                         | `purchase.cancel` | W7  |

```json
{
  "supplierId": "…",
  "goodsReceiptId": "…?",
  "reason": "Hàng lỗi",
  "items": [{ "productId": "…", "qty": "10", "returnPrice": "8450.2200" }],
  "settlement": "offset_debt", // hoặc "refund" (kèm refund.accountId)
  "refund": { "accountId": "…" } // chỉ khi settlement = "refund"
}
```

---

## 4. Khách hàng

| Method | Đường dẫn                                           | Mô tả                                              | Quyền           | Mốc |
| ------ | --------------------------------------------------- | -------------------------------------------------- | --------------- | --- |
| GET    | `/customers`                                        | Danh sách                                          | `customer.view` | W3  |
| GET    | `/customers/lookup?q=`                              | Tìm nhanh (tên/SĐT/mã) cho ô chọn khách, tối đa 20 | `customer.view` | W3  |
| GET    | `/customers/:id`                                    | Chi tiết + `balance`                               | `customer.view` | W3  |
| POST   | `/customers`                                        | Tạo                                                | `customer.edit` | W3  |
| PATCH  | `/customers/:id`                                    | Sửa / ngưng                                        | `customer.edit` | W3  |
| GET    | `/customers/:id/ledger?from&to`                     | Sổ công nợ (cấu trúc như mục 3.1)                  | `customer.view` | W6  |
| GET    | `/customers/:id/orders`                             | Lịch sử đặt hàng (phân trang)                      | `customer.view` | W6  |
| GET    | `/customers/:id/invoices`                           | Lịch sử hóa đơn (kèm `paid`, `debt`)               | `customer.view` | W6  |
| GET    | `/customers/:id/sales-returns`                      | Lịch sử trả hàng                                   | `customer.view` | W6  |
| GET    | `/customers/:id/aging`                              | Tuổi nợ                                            | `customer.view` | W6  |
| POST   | `/customers/:id/receipts`                           | **Thu nợ nhanh** (**Idempotency-Key**)             | `cash.create`   | W6  |
| GET    | `/customers/:id/statement?from&to&format=xlsx\|pdf` | Biên bản đối chiếu công nợ                         | `customer.view` | W6  |

Bộ lọc `GET /customers`: `q`, `type`, `salesOwnerId`, `priceBookId`, `hasDebt` (`true` = đang nợ), `isActive`; sort: `code`, `name`, `balance`, `lastTransactionAt`.

```json
// Customer
{
  "id": "…",
  "code": "KH000001",
  "name": "Cửa hàng Ví Dụ 1",
  "type": "individual",
  "phone": "0900000001",
  "address": "12 Đường Ví Dụ, Quận 1, TP.HCM",
  "facebook": null,
  "salesOwner": { "id": "…", "fullName": "Trần Văn B" }, // nhân viên phụ trách
  "defaultPriceBookId": "…",
  "isInternalBranch": false, // true = khách hàng hệ thống đại diện một chi nhánh (chuyển kho nội bộ)
  "terms": [
    // hạn mức & kỳ hạn công nợ RIÊNG từng chi nhánh; không có dòng = không giới hạn
    { "branchId": "…", "branchCode": "SG", "creditLimit": "50000000", "paymentTermDays": 15 },
    { "branchId": "…", "branchCode": "HN", "creditLimit": null, "paymentTermDays": null }
  ],
  "balances": [
    // công nợ TÁCH BIỆT theo chi nhánh; phải thu; ÂM = khách đang dư/ứng trước
    { "branchId": "…", "branchCode": "SG", "balance": "12500000" },
    { "branchId": "…", "branchCode": "HN", "balance": "0" }
  ],
  "lastTransactionAt": "…",
  "totalSales": "1200000000",
  "note": null,
  "isActive": true,
  "invoiceProfile": {
    "buyerName": null,
    "companyName": null,
    "taxCode": null,
    "address": null,
    "email": null,
    "phone": null,
    "bankName": null,
    "bankAccount": null
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

**Công nợ theo chi nhánh:** khách hàng và nhà cung cấp là dữ liệu dùng chung, nhưng **mỗi chi nhánh có sổ công nợ riêng**, không cấn trừ chéo (thu nợ ở Hà Nội không giảm nợ Sài Gòn). `balances` và `GET …/ledger`, `…/aging`, `…/statement` nhận `branchId` (mặc định = chi nhánh làm việc). Danh sách khách/nhà cung cấp mặc định **không gồm** các đối tác nội bộ (`isInternalBranch = true`); thêm `?includeInternal=true` nếu cần. `hasDebt` tính theo chi nhánh làm việc.

Quy ước: `phone` được chuẩn hóa về dạng `0xxxxxxxxx` và **không trùng** (lỗi `409 DUPLICATE_PHONE`, `details` kèm khách đã có). `balance` chỉ đọc.

```json
// GET /customers/:id/aging
{
  "asOf": "2026-11-03",
  "total": "12500000",
  "buckets": {
    "current": "5000000",
    "d1_30": "4000000",
    "d31_60": "2500000",
    "d61_90": "1000000",
    "over90": "0"
  }
}
```

```json
// POST /customers/:id/receipts   — thu nợ nhanh
{
  "amount": "10000000",
  "method": "bank",
  "accountId": "…",
  "occurredAt": "…?",
  "note": "CK ngày 3/11",
  "allocations": [{ "invoiceId": "…", "amount": "6000000" }] // tùy chọn; bỏ qua = tự cấn hóa đơn cũ nhất
}
// 201: { "cashTransaction": { "id": "…", "code": "TT019330", … },
//        "allocations": [{ "invoiceId": "…", "invoiceCode": "HD016500", "amount": "6000000" }, …],
//        "balanceAfter": "2500000" }
// Lỗi: 422 ALLOCATION_EXCEEDS
```

---

## 5. Đơn hàng

### 5.1 Đặt hàng (phiếu tạm)

| Method | Đường dẫn             | Mô tả                                                             | Quyền            | Mốc |
| ------ | --------------------- | ----------------------------------------------------------------- | ---------------- | --- |
| GET    | `/orders`             | Danh sách (`q`, `status`, `customerId`, `sellerId`, `from`, `to`) | `order.view`     | W4  |
| GET    | `/orders/:id`         | Chi tiết                                                          | `order.view`     | W4  |
| POST   | `/orders`             | Tạo phiếu tạm (`draft`)                                           | `order.create`   | W4  |
| PATCH  | `/orders/:id`         | Sửa — **chỉ khi `draft`** (thay toàn bộ `items`)                  | `order.create`   | W4  |
| POST   | `/orders/:id/cancel`  | Hủy đơn `{ reason? }` (chỉ `draft`)                               | `order.create`   | W4  |
| POST   | `/orders/:id/invoice` | **Xuất hóa đơn từ đơn** (**Idempotency-Key**)                     | `invoice.create` | W5  |

```json
// POST /orders   (cùng body cho PATCH)
{
  "customerId": "…",
  "priceBookId": "…?", // bỏ qua = bảng giá mặc định của khách
  "sellerId": "…?", // người bán (NVKD); mặc định = người đang đăng nhập
  "items": [
    { "productId": "…", "qty": "2000", "discountPerUnit": "0", "isGift": false, "note": null }
  ],
  "discount": "0", // giảm giá cả đơn (số tiền)
  "deposit": { "accountId": "…", "method": "bank", "amount": "5000000" }, // đặt cọc, tùy chọn
  "ship": { "name": null, "phone": null, "address": null, "packageCount": null, "weightG": null },
  "note": "thêm hàng"
}
```

Không gửi `listPrice`/`unitPrice`/`lineTotal`: server tự tính. Tùy chọn `listPrice` chỉ dùng cho `isGift=true`/hàng được phép sửa giá (cần quyền `price.override`).

```json
// Order (response)
{
  "id": "…", "code": "DH022295", "status": "draft",
  "branch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" }, // chi nhánh của đơn = X-Branch-Id lúc tạo; không đổi được
  "customer": { "id": "…", "code": "KH000002", "name": "Cửa hàng Ví Dụ 2", "phone": "…" },
  "priceBook": { "id": "…", "name": "Lớn" },
  "seller": { "id": "…", "fullName": "…" },
  "orderedAt": "…",
  "items": [{
    "id": "…", "productId": "…", "code": "T888LL", "name": "Lược lăn tinh dầu dưỡng tóc T888", "unit": "Cái",
    "qty": "2000", "listPrice": "12600", "discountPerUnit": "0", "unitPrice": "12600",
    "lineTotal": "25200000", "isGift": false, "note": null,
    "available": "3000"
  }],
  "subtotal": "44200000", "discount": "0", "total": "44200000",
  "deposit": "5000000", "invoiceId": null, "invoiceCode": null,
  "ship": { … }, "note": "thêm hàng",
  "warnings": [{ "code": "CREDIT_LIMIT_EXCEEDED", "message": "Vượt hạn mức công nợ 6.000.000 ₫" }],
  "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…", "updatedAt": "…"
}
```

- `warnings` là **cảnh báo mềm** (vượt hạn mức, thiếu tồn…); không chặn lưu đơn `draft`. Hiển thị cho người dùng.
- Đơn `draft` **giữ hàng** (`reserved`). Hủy đơn thì nhả hàng.

### 5.2 Hóa đơn

| Method | Đường dẫn                                    | Mô tả                                                                        | Quyền            | Mốc |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- | --- |
| GET    | `/invoices`                                  | Danh sách (`q`, `status`, `customerId`, `sellerId`, `hasDebt`, `from`, `to`) | `invoice.view`   | W5  |
| GET    | `/invoices/:id`                              | Chi tiết                                                                     | `invoice.view`   | W5  |
| POST   | `/orders/:id/invoice`                        | Xuất hóa đơn từ đơn (mục 5.1)                                                | `invoice.create` | W5  |
| POST   | `/invoices`                                  | Tạo hóa đơn trực tiếp, không qua đơn (**Idempotency-Key**)                   | `invoice.create` | W5  |
| POST   | `/invoices/:id/cancel`                       | Hủy hóa đơn `{ reason }` (bắt buộc lý do)                                    | `invoice.cancel` | W5  |
| GET    | `/invoices/:id/print?type=invoice\|delivery` | PDF A4: hóa đơn hoặc phiếu giao hàng                                         | `invoice.view`   | W5  |

```json
// POST /orders/:id/invoice
{
  "payments": [
    { "method": "bank", "accountId": "…", "amount": "10000000" },
    { "method": "cash", "accountId": "…", "amount": "2000000" }
  ],
  "note": null
}
// Phần chưa thanh toán tự ghi vào công nợ khách. Bỏ trống payments = ghi nợ toàn bộ.
```

`POST /invoices` nhận cùng body như tạo đơn (`customerId`, `items`, `discount`, `ship`, `note`) cộng `payments[]`.

```json
// Invoice (response)
{
  "id": "…",
  "code": "HD016890",
  "status": "completed",
  "branch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" }, // = chi nhánh của đơn gốc
  "orderId": "…",
  "orderCode": "DH022215",
  "customer": {
    "id": "…",
    "code": "KH000003",
    "name": "Cửa hàng Ví Dụ 3",
    "phone": "…",
    "address": "…"
  },
  "priceBook": { "id": "…", "name": "Lớn" },
  "seller": { "id": "…", "fullName": "…" },
  "invoicedAt": "2026-11-03T07:11:16.170Z",
  "items": [
    {
      "productId": "…",
      "code": "QKBSP",
      "name": "Quạt kẹp bàn Super MST-A1",
      "unit": "Cái",
      "qty": "515",
      "listPrice": "33500",
      "discountPerUnit": "500",
      "unitPrice": "33000",
      "lineTotal": "16995000",
      "isGift": false,
      "unitCost": "21800.5000"
    }
  ], // vắng mặt nếu thiếu quyền xem giá vốn
  "subtotal": "33735000",
  "discount": "0",
  "total": "33735000",
  "payments": [{ "method": "bank", "amount": "10000000", "paidAt": "…" }],
  "paid": "10000000",
  "debt": "23735000",
  "note": "…",
  "cancelledAt": null,
  "cancelReason": null,
  "createdBy": { "id": "…", "fullName": "…" },
  "createdAt": "…"
}
```

- `debt = total − paid − (các khoản thu nợ đã cấn về sau)`. Hiển thị theo `debt` hiện tại.
- Hóa đơn `completed` **không sửa**; hủy rồi tạo lại. Hủy sẽ hoàn kho và đảo công nợ/quỹ; lỗi `INVALID_STATE` nếu hóa đơn đã bị trả hàng hoặc đã hủy.
- Lỗi khi xuất: `422 STOCK_NOT_ENOUGH` (kèm `details[]` từng mặt hàng thiếu).

### 5.3 Trả hàng bán

| Method | Đường dẫn            | Mô tả                                                    | Quyền           | Mốc |
| ------ | -------------------- | -------------------------------------------------------- | --------------- | --- |
| GET    | `/sales-returns`     | Danh sách (`q`, `customerId`, `invoiceId`, `from`, `to`) | `invoice.view`  | W6  |
| GET    | `/sales-returns/:id` | Chi tiết                                                 | `invoice.view`  | W6  |
| POST   | `/sales-returns`     | Tạo phiếu trả (**Idempotency-Key**)                      | `return.create` | W6  |

```json
// POST /sales-returns
{
  "customerId": "…",
  "invoiceId": "…?", // có thể trả không tham chiếu hóa đơn
  "items": [
    {
      "productId": "…",
      "qty": "36",
      "returnPrice": "130000",
      "restock": true, // true = nhập lại kho
      "reason": "lô mới nhỏ hơn khách ko lấy"
    }
  ],
  "settlement": "offset_debt", // hoặc "refund" + refund.accountId
  "refund": { "accountId": "…" },
  "note": null
}
```

Response có `code` (`TH001076`), `total`, `settlement`, `items[]` (kèm `restockCost` nếu có quyền xem giá vốn).

---

## 6. Sổ quỹ

| Method     | Đường dẫn                                  | Mô tả                                      | Quyền         | Mốc |
| ---------- | ------------------------------------------ | ------------------------------------------ | ------------- | --- |
| GET        | `/cash-accounts`                           | Quỹ tiền mặt / tài khoản ngân hàng + số dư | `cash.view`   | W6  |
| POST/PATCH | `/cash-accounts`, `/cash-accounts/:id`     | Tạo / sửa quỹ                              | `cash.manage` | W6  |
| GET        | `/cash-categories`                         | Danh mục thu chi (`direction`)             | `cash.view`   | W6  |
| POST/PATCH | `/cash-categories`, `/cash-categories/:id` | Tạo / sửa danh mục                         | `cash.manage` | W6  |
| GET        | `/cash-transactions`                       | Danh sách phiếu thu/chi + tổng hợp kỳ      | `cash.view`   | W6  |
| GET        | `/cash-transactions/:id`                   | Chi tiết                                   | `cash.view`   | W6  |
| POST       | `/cash-transactions`                       | Tạo phiếu thu/chi (**Idempotency-Key**)    | `cash.create` | W6  |
| POST       | `/cash-transactions/:id/cancel`            | Hủy phiếu `{ reason }`                     | `cash.cancel` | W6  |

Bộ lọc `GET /cash-transactions`: `from`, `to`, `direction`, `categoryId`, `accountId`, `partyType`, `partyId`, `q`.

```json
// GET /cash-transactions?from=2026-11-01&to=2026-11-03
{
  "summary": {
    "openingBalance": "300000000",
    "totalIn": "100000000",
    "totalOut": "150000000",
    "closingBalance": "250000000"
  },
  "data": [
    {
      "id": "…",
      "code": "CTM002305",
      "direction": "out",
      "amount": "2800000",
      "category": { "id": "…", "name": "SỬA CHỮA KHO" },
      "account": { "id": "…", "name": "Tiền mặt", "type": "cash" },
      "party": null,
      "partyName": null,
      "vehicleRef": null,
      "occurredAt": "…",
      "note": null,
      "status": "completed"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 32, "totalPages": 2 }
}
```

`amount` luôn **dương**; chiều thu/chi do `direction`. `summary` tính cho toàn bộ bộ lọc (không chỉ trang hiện tại).

```json
// POST /cash-transactions
{
  "direction": "out",
  "amount": "4300000",
  "categoryId": "…",
  "accountId": "…",
  "occurredAt": "…?",
  "party": { "type": "supplier", "id": "…" }, // tùy chọn; hoặc dùng partyName (chữ) khi không có trong hệ thống
  "partyName": null,
  "vehicleRef": null, // biển số/xe cho chi phí vận chuyển, xăng xe
  "allocations": [{ "invoiceId": "…", "amount": "4300000" }], // chỉ khi thu nợ khách (direction=in, party.type=customer)
  "note": null
}
```

- **Thu nợ khách** nên dùng `POST /customers/:id/receipts` (tiện hơn); `cash-transactions` dùng cho thu/chi khác và trả nợ NCC (`party.type = "supplier"`, danh mục "Công nợ").
- Phiếu đã tạo **không sửa**, chỉ hủy.

---

## 7. Tổng quan

| Method | Đường dẫn    | Mô tả             | Quyền            | Mốc |
| ------ | ------------ | ----------------- | ---------------- | --- |
| GET    | `/dashboard` | Số liệu trang chủ | `dashboard.view` | W8  |

```json
{
  "asOf": "2026-11-03T08:00:00.000Z",
  "revenue": { "today": "128000000", "thisMonth": "1500000000", "lastMonth": "2800000000" },
  "invoiceCount": { "today": 65, "thisMonth": 129, "lastMonth": 1900 },
  "receivable": "5000000000", // tổng khách đang nợ (chỉ cộng số dư dương)
  "payable": "240000000",
  "cashBalance": "250000000",
  "topProducts": [
    { "productId": "…", "code": "QKBSP", "name": "…", "qty": "515", "revenue": "16995000" }
  ], // 10 dòng, tháng này
  "topCustomers": [{ "customerId": "…", "code": "KH000003", "name": "…", "revenue": "33735000" }], // 10 dòng, tháng này
  "dailyRevenue": [{ "date": "2026-10-05", "revenue": "…", "invoiceCount": 12 }] // 30 ngày gần nhất, đủ ngày (ngày không bán = 0)
}
```

---

## 8. Báo cáo

Tất cả nhận `?format=json` (mặc định) \| `xlsx` \| `pdf`. Quyền theo từng báo cáo: `/reports/inventory` → `report.inventory`; `/reports/sales` → `report.sales` (phạm vi `own` thì chỉ tính đơn của mình; cột lãi gộp chỉ có khi có `product.cost.view`); `/reports/customer-debt`, `/reports/supplier-debt` → `report.debt`; `/reports/cash-book` → `report.cash`.

| Method | Đường dẫn                | Mô tả                             | Tham số chính                                                                                       | Mốc |
| ------ | ------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------- | --- |
| GET    | `/reports/inventory`     | Tồn kho: SL, giá vốn, giá trị tồn | `asOf`, `categoryId`, `q`, `onlyInStock`, `noMovementDays`                                          | W4  |
| GET    | `/reports/sales`         | Doanh số + lãi gộp                | `from`, `to`, `groupBy=day\|month\|customer\|product\|category\|seller`, `customerId`, `categoryId` | W5  |
| GET    | `/reports/customer-debt` | Công nợ khách theo tuổi nợ        | `asOf`, `salesOwnerId`, `overdueOnly`, `q`                                                          | W6  |
| GET    | `/reports/cash-book`     | Sổ quỹ theo kỳ/loại               | `from`, `to`, `accountId`, `groupBy=category\|day`                                                  | W6  |
| GET    | `/reports/supplier-debt` | Công nợ NCC                       | `asOf`, `q`                                                                                         | W7  |

Cấu trúc chung cho dạng JSON: `{ "params": {…}, "columns": [{ "key": "…", "title": "…", "type": "text|money|qty|date" }], "rows": [ {…} ], "totals": {…} }` — frontend dựng bảng **theo `columns`** nên thêm cột không phải sửa giao diện.

```json
// GET /reports/sales?from=2026-11-01&to=2026-11-30&groupBy=customer
{
  "params": { "from": "2026-11-01", "to": "2026-11-30", "groupBy": "customer" },
  "columns": [
    { "key": "name", "title": "Khách hàng", "type": "text" },
    { "key": "invoiceCount", "title": "Số hóa đơn", "type": "qty" },
    { "key": "revenue", "title": "Doanh thu", "type": "money" },
    { "key": "grossProfit", "title": "Lãi gộp", "type": "money" } // bị bỏ nếu thiếu quyền xem giá vốn
  ],
  "rows": [
    {
      "key": "…",
      "name": "Cửa hàng Ví Dụ 3",
      "invoiceCount": "3",
      "revenue": "33735000",
      "grossProfit": "6200000"
    }
  ],
  "totals": { "invoiceCount": "129", "revenue": "1500000000", "grossProfit": "…" }
}
```

---

## 9. Nhập dữ liệu từ Excel

Dùng cho import hàng loạt (chuyển dữ liệu từ KiotViet và nhập tay bằng file). Xử lý **bất đồng bộ**: tải file lên → nhận `jobId` → hỏi trạng thái.

| Method | Đường dẫn                 | Mô tả                                                                                                           | Quyền        | Mốc |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ | --- |
| POST   | `/imports/:type`          | Tải file lên (`multipart/form-data`, field `file`). `type`: `products`, `customers`, `suppliers`, `price-books` | `import.run` | W3  |
| GET    | `/imports/:id`            | Trạng thái và lỗi từng dòng                                                                                     | `import.run` | W3  |
| GET    | `/imports/:type/template` | Tải file Excel mẫu                                                                                              | `import.run` | W3  |

```json
// POST /imports/products?dryRun=true   → 202 { "id": "…", "status": "queued" }

// GET /imports/:id
{
  "id": "…",
  "type": "products",
  "status": "completed", // queued | running | completed | failed
  "dryRun": true, // true = chỉ kiểm tra, chưa ghi dữ liệu
  "total": 2787,
  "created": 2700,
  "updated": 80,
  "failed": 7,
  "errors": [{ "row": 15, "field": "code", "message": "Mã hàng trùng trong file" }]
}
```

- Nên cho người dùng chạy `dryRun=true` trước, xem lỗi rồi mới chạy thật (`dryRun=false`).
- Import có thể chạy lại nhiều lần (cập nhật theo **mã**, không tạo trùng).
- Hiển thị tiến độ bằng cách gọi `GET /imports/:id` mỗi 1–2 giây cho đến khi `status` là `completed` hoặc `failed`.
- Import số dư đầu kỳ (tồn, nợ, quỹ) **không** mở cho giao diện; backend chạy bằng công cụ riêng khi chuyển đổi.

---

## 10. Phân quyền (dành cho Quản lý)

Quyền của từng vai trò là **dữ liệu trong CSDL**, do Quản lý chỉnh trên màn hình _Phân quyền_; không còn cố định trong mã. Mọi endpoint dưới đây cần quyền `role.manage` (chỉ vai trò Quản lý có, không thể cấp cho vai trò khác). Quy tắc và giải thích: [`README.md`](README.md) mục 8.

| Method | Đường dẫn                        | Mô tả                                             | Mốc |
| ------ | -------------------------------- | ------------------------------------------------- | --- |
| GET    | `/permissions/catalog`           | Danh mục quyền gom theo phân hệ (để dựng ma trận) | W1  |
| GET    | `/roles`                         | 7 vai trò kèm số quyền, số người dùng             | W1  |
| GET    | `/roles/:role/permissions`       | Quyền hiện tại của một vai trò                    | W1  |
| PUT    | `/roles/:role/permissions`       | Đặt lại **toàn bộ** quyền của vai trò             | W1  |
| POST   | `/roles/:role/permissions/reset` | Khôi phục cấu hình mặc định của vai trò           | W1  |

`:role` là một trong `manager`, `assistant`, `accountant`, `warehouse`, `driver`, `sales`, `marketing`.

```jsonc
// GET /permissions/catalog
{
  "modules": [
    {
      "key": "sales", "label": "Đơn hàng",
      "permissions": [
        { "code": "invoice.view", "label": "Xem hóa đơn", "description": null,
          "scopable": true,                       // có thể chọn "chỉ của mình"
          "requires": ["customer.view"],          // tự được thêm khi bật quyền này
          "lockedToAdmin": false },
        { "code": "invoice.cancel", "label": "Hủy hóa đơn", "scopable": false,
          "requires": ["invoice.view"], "lockedToAdmin": false }
      ]
    }
  ]
}

// GET /roles
[
  { "role": "manager", "label": "Quản lý", "locked": true,  "permissionCount": 31, "userCount": 1 },
  { "role": "sales",   "label": "Sale",    "locked": false, "permissionCount": 11, "userCount": 8 }
]

// GET /roles/sales/permissions
{ "role": "sales", "label": "Sale", "locked": false,
  "permissions": [
    { "code": "product.view",  "scope": "all" },
    { "code": "invoice.view",  "scope": "own" }
  ] }
```

```jsonc
// PUT /roles/sales/permissions   — gửi bộ quyền MỚI (thay thế toàn bộ bộ cũ)
{ "permissions": [
    { "code": "product.view",   "scope": "all" },
    { "code": "invoice.create", "scope": "own" }
] }

// 200 — bộ quyền cuối cùng sau khi server chuẩn hóa
{ "role": "sales", "label": "Sale", "locked": false,
  "permissions": [
    { "code": "product.view",   "scope": "all" },
    { "code": "customer.view",  "scope": "own" },
    { "code": "order.view",     "scope": "own" },
    { "code": "invoice.view",   "scope": "own" },
    { "code": "invoice.create", "scope": "own" }
  ],
  "autoAdded": ["customer.view", "order.view", "invoice.view"] }   // hiện cho người dùng: "đã tự bật thêm…"
```

Lỗi thường gặp:

| HTTP | `code`              | Khi nào                                                                        |
| ---- | ------------------- | ------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`  | Mã quyền không có trong danh mục (`details.unknown`), phạm vi sai, thiếu field |
| 400  | `PERMISSION_LOCKED` | Cố cấp `user.manage` / `role.manage` cho vai trò khác (`details.locked`)       |
| 404  | `NOT_FOUND`         | `:role` không phải vai trò hợp lệ                                              |
| 409  | `ROLE_LOCKED`       | Cố sửa/khôi phục vai trò `manager` (luôn đủ quyền)                             |

**Lưu ý cho frontend khi dựng màn hình:**

- Dựng ma trận từ `/permissions/catalog` (hàng = quyền, gom theo `modules`; cột = vai trò). Ô của quyền `scopable` có thêm lựa chọn **Tất cả / Chỉ của mình**; quyền `lockedToAdmin` hiển thị khóa.
- Bật một quyền có `requires` thì **hiển thị trước** các quyền đi kèm sẽ tự bật (frontend có thể tự bật theo `requires`); kết quả cuối cùng luôn lấy theo response của PUT.
- Cột `manager` chỉ để xem (khóa). Nút "Khôi phục mặc định" gọi `POST …/reset` và cần hộp thoại xác nhận.
- Có hiệu lực **ngay** cho mọi người dùng thuộc vai trò đó, không cần đăng nhập lại. Frontend nên gọi lại `GET /auth/me` khi nhận `403 FORBIDDEN` hoặc khi tải lại trang để cập nhật menu/nút.
- Nên cảnh báo khi Quản lý bỏ quyền làm vai trò đó mất khả năng làm việc (vd bỏ `product.view` của Sale) — server vẫn cho phép.
- Mọi thay đổi được ghi vào nhật ký thao tác (ai đổi, trước/sau).

---

## 11. Chi nhánh và chuyển kho

Công ty có **2 chi nhánh dùng chung một hệ thống** (Hà Nội, Sài Gòn). Quy tắc chung cho mọi endpoint: [`README.md`](README.md) mục "Nhiều chi nhánh".

### 11.1 Chuyển kho giữa hai chi nhánh

Quy trình **hai bước**: chi nhánh gửi lập phiếu (trừ tồn bên gửi, hàng "đang đi đường") → chi nhánh nhận xác nhận (cộng tồn bên nhận, tính giá vốn, ghi công nợ đối ứng). Mã phiếu `CH000001`.

| Method | Đường dẫn                      | Mô tả                                                        | Quyền              | Mốc |
| ------ | ------------------------------ | ------------------------------------------------------------ | ------------------ | --- |
| GET    | `/stock-transfers`             | Danh sách (`status`, `direction=out\|in`, `from`, `to`, `q`) | `transfer.view`    | W5  |
| GET    | `/stock-transfers/:id`         | Chi tiết                                                     | `transfer.view`    | W5  |
| POST   | `/stock-transfers`             | **Bước 1 — gửi hàng** (**Idempotency-Key**)                  | `transfer.create`  | W5  |
| POST   | `/stock-transfers/:id/receive` | **Bước 2 — nhận hàng** (**Idempotency-Key**)                 | `transfer.receive` | W5  |
| POST   | `/stock-transfers/:id/cancel`  | Hủy khi còn đang đi đường `{ reason }` (bắt buộc lý do)      | `transfer.create`  | W5  |
| GET    | `/stock-transfers/:id/print`   | PDF phiếu chuyển kho                                         | `transfer.view`    | W5  |

Người dùng thấy phiếu mà chi nhánh **gửi hoặc nhận** nằm trong chi nhánh họ được phép. Chỉ người thuộc **chi nhánh gửi** mới tạo/hủy phiếu; chỉ người thuộc **chi nhánh nhận** mới xác nhận nhận (Quản lý làm được cả hai).

```jsonc
// POST /stock-transfers   — chi nhánh gửi = chi nhánh làm việc (X-Branch-Id)
{
  "toBranchId": "…",
  "items": [
    { "productId": "…", "qty": "40" },
    { "productId": "…", "qty": "10" }
  ],
  "shippingFee": "1000",             // phí vận chuyển, số nguyên đồng; mặc định "0"
  "shippingPaidBy": "sender",        // "sender" (mặc định) | "receiver": bên ứng tiền trả xe
  "note": "Xe tải 51D-xxxxx"
}

// 201
{
  "id": "…", "code": "CH000001", "status": "in_transit",       // in_transit | received | cancelled
  "fromBranch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" },
  "toBranch":   { "id": "…", "code": "HN", "name": "Chi nhánh Hà Nội" },
  "sentAt": "…", "receivedAt": null,
  "goodsValue": "60000",             // theo giá vốn bên gửi — vắng mặt nếu thiếu quyền product.cost.view
  "shippingFee": "1000", "shippingPaidBy": "sender",
  "debtAmount": null,                // có giá trị sau khi nhận: tiền hàng (+ phí nếu bên gửi ứng)
  "items": [
    { "productId": "…", "code": "QKBSP", "name": "…", "qty": "40",
      "unitCostSent": "1000.0000",       // giá vốn — chỉ có khi có product.cost.view
      "shippingShare": "667",            // phần phí phân bổ cho dòng này, theo tỷ lệ giá trị hàng
      "unitCostReceived": null }         // = unitCostSent + shippingShare / qty, có sau khi nhận
  ],
  "note": "…", "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…"
}
```

**Quy tắc nghiệp vụ**

- Giá nhập kho bên nhận = **giá vốn bên gửi + phí vận chuyển phân bổ** (theo tỷ lệ giá trị từng dòng); giá vốn bình quân của bên nhận được tính lại. Phí vẫn được lưu riêng ở `shippingFee`.
- Nhận hàng **phải đủ** số lượng ghi trên phiếu (chưa hỗ trợ nhận thiếu). Sai lệch thì hủy phiếu khi còn đi đường rồi lập lại.
- Công nợ đối ứng ghi **khi nhận**: chi nhánh gửi thấy chi nhánh nhận là **khách hàng nội bộ** (phải thu), chi nhánh nhận thấy chi nhánh gửi là **nhà cung cấp nội bộ** (phải trả). Thanh toán công nợ này bằng phiếu thu/chi thường ở Sổ quỹ.
- Phiếu chuyển kho **không phải hóa đơn bán**: không tính vào doanh thu, lãi gộp hay Dashboard; báo cáo gộp hai chi nhánh phải loại các đối tác nội bộ.
- Hàng đang đi đường đã trừ tồn bên gửi và chưa cộng bên nhận; hiển thị ở màn hình phiếu (trạng thái `in_transit`), không nằm trong tồn của chi nhánh nào.

| HTTP | `code`             | Khi nào                                                                                    |
| ---- | ------------------ | ------------------------------------------------------------------------------------------ |
| 422  | `STOCK_NOT_ENOUGH` | Bên gửi không đủ tồn (`details.available`)                                                 |
| 400  | `INVALID_STATE`    | Nhận/hủy phiếu không còn đang đi đường (đã nhận hoặc đã hủy)                               |
| 400  | `VALIDATION_ERROR` | Gửi và nhận cùng chi nhánh; danh sách rỗng; trùng mặt hàng; số lượng sai; phí không hợp lệ |
| 403  | `BRANCH_FORBIDDEN` | Không thuộc chi nhánh gửi (khi tạo/hủy) hoặc chi nhánh nhận (khi nhận)                     |
