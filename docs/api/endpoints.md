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

| Method         | Đường dẫn                   | Mô tả                                 | Quyền         | Mốc |
| -------------- | --------------------------- | ------------------------------------- | ------------- | --- |
| GET            | `/health`                   | Kiểm tra sống (không cần token)       | —             | W1  |
| POST           | `/auth/login`               | Đăng nhập                             | —             | W1  |
| POST           | `/auth/refresh`             | Lấy access token mới (dùng cookie)    | —             | W1  |
| POST           | `/auth/logout`              | Đăng xuất, xóa cookie                 | đã đăng nhập  | W1  |
| GET            | `/auth/me`                  | Thông tin người dùng hiện tại + quyền | đã đăng nhập  | W1  |
| POST           | `/auth/change-password`     | Đổi mật khẩu                          | đã đăng nhập  | W1  |
| GET            | `/branches`                 | Danh sách chi nhánh (hiện 1)          | đã đăng nhập  | W1  |
| GET/POST/PATCH | `/users`, `/users/:id`      | Quản lý người dùng                    | `user.manage` | W8  |
| POST           | `/users/:id/reset-password` | Đặt lại mật khẩu                      | `user.manage` | W8  |

**POST `/auth/login`**

```json
// request
{ "username": "ketoan01", "password": "••••••••" }

// 200 response (kèm Set-Cookie: refresh_token=...; HttpOnly)
{
  "accessToken": "eyJhbGciOi…",
  "expiresIn": 900,
  "user": {
    "id": "0192…", "code": "NV0001", "fullName": "Nguyễn Văn A",
    "role": "accountant",
    "permissions": ["invoice.create", "cash.create", "product.cost.view"],
    "branchId": "0192…"
  }
}
```

Lỗi: `401 UNAUTHENTICATED` (sai tài khoản/mật khẩu — thông báo chung, không nói rõ cái nào sai).

**GET `/auth/me`** → đối tượng `user` như trên.

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

| Method | Đường dẫn                          | Mô tả                                                        | Quyền          | Mốc |
| ------ | ---------------------------------- | ------------------------------------------------------------ | -------------- | --- |
| GET    | `/products`                        | Danh sách, lọc, phân trang                                   | đăng nhập      | W2  |
| GET    | `/products/lookup?q=`              | Tìm nhanh cho ô chọn hàng (tối đa 20 dòng, không phân trang) | đăng nhập      | W2  |
| GET    | `/products/:id`                    | Chi tiết                                                     | đăng nhập      | W2  |
| POST   | `/products`                        | Tạo                                                          | `product.edit` | W2  |
| PATCH  | `/products/:id`                    | Sửa (gồm ngưng bán `isActive=false`)                         | `product.edit` | W2  |
| POST   | `/products/:id/images`             | Tải ảnh (`multipart/form-data`, field `file`)                | `product.edit` | W3  |
| DELETE | `/products/:id/images/:imageId`    | Xóa ảnh                                                      | `product.edit` | W3  |
| GET    | `/products/:id/stock-card?from&to` | **Thẻ kho**: lịch sử nhập–xuất                               | đăng nhập      | W4  |

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
  "basePrice": "33500",
  "costPrice": "21800.5000", // vắng mặt nếu thiếu quyền product.cost.view
  "lastPurchasePrice": "21500.0000", // như trên
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
  "basePrice": "33500",
  "location": "11",
  "description": null,
  "maxStock": null,
  "isSellable": true
}
// Lỗi: 409 DUPLICATE_CODE
```

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

| Method | Đường dẫn                  | Mô tả                                                     | Quyền        | Mốc |
| ------ | -------------------------- | --------------------------------------------------------- | ------------ | --- |
| GET    | `/price-books`             | Danh sách bảng giá                                        | đăng nhập    | W2  |
| PATCH  | `/price-books/:id`         | Đổi tên / bật tắt                                         | `price.edit` | W3  |
| GET    | `/price-books/grid`        | **Lưới giá**: mỗi dòng = 1 sản phẩm, mỗi cột = 1 bảng giá | đăng nhập    | W3  |
| PUT    | `/price-books/grid`        | Lưu nhiều ô giá cùng lúc                                  | `price.edit` | W3  |
| POST   | `/price-books/bulk-adjust` | Tăng/giảm giá hàng loạt (có chế độ xem trước)             | `price.edit` | W3  |

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
// GET /price-books/grid?q=&categoryId=&page=1&limit=50
{
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
{ "changes": [{ "productId": "…", "priceBookId": "…", "price": "33000" }] }
// 200: { "updated": 1 }
```

```json
// POST /price-books/bulk-adjust
{
  "priceBookId": "…",
  "categoryId": "…?",
  "mode": "percent", // "percent" | "amount"
  "value": "5", // tăng 5%  (số âm = giảm)
  "roundTo": "100", // làm tròn đến bội số này (tùy chọn)
  "dryRun": true // true = chỉ trả bản xem trước, chưa lưu
}
// 200: { "affected": 54, "preview": [{ "productId": "…", "code": "…", "oldPrice": "33000", "newPrice": "34700" }] }
```

### 2.4 Báo giá cho màn hình tạo đơn

| Method | Đường dẫn        | Mô tả                                                              | Quyền     | Mốc |
| ------ | ---------------- | ------------------------------------------------------------------ | --------- | --- |
| POST   | `/pricing/quote` | Tính giá niêm yết, tồn và cảnh báo cho các dòng hàng của một khách | đăng nhập | W3  |

Dùng khi người dùng chọn khách / thêm hàng để **hiển thị đúng giá và tồn tức thì**. Đây chỉ là báo giá; khi lưu đơn server tính lại.

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
  "balance": "240000000", // + = mình còn nợ NCC; có thể âm
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
  "creditLimit": "50000000",
  "paymentTermDays": 15, // null = không giới hạn
  "balance": "12500000", // phải thu; ÂM = khách đang dư/ứng trước
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

| Method | Đường dẫn    | Mô tả             | Quyền         | Mốc |
| ------ | ------------ | ----------------- | ------------- | --- |
| GET    | `/dashboard` | Số liệu trang chủ | `report.view` | W8  |

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

Tất cả nhận `?format=json` (mặc định) \| `xlsx` \| `pdf`. Quyền: `report.view` (riêng tồn kho: thủ kho cũng xem được).

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
