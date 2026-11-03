# Từ điển dữ liệu

> **Sinh tự động** từ `apps/api/src/db/schema` bằng `pnpm db:docs` — không sửa tay. Tổng quan và cách xem sơ đồ: [`README.md`](README.md).

**35 bảng · 15 kiểu liệt kê (enum)**

## Mục lục

- **Hệ thống**: [`branches`](#branches), [`users`](#users), [`refresh_tokens`](#refresh_tokens), [`audit_logs`](#audit_logs), [`code_sequences`](#code_sequences), [`company_profile`](#company_profile), [`idempotency_keys`](#idempotency_keys), [`import_jobs`](#import_jobs)
- **Hàng hóa & giá**: [`categories`](#categories), [`products`](#products), [`product_images`](#product_images), [`price_books`](#price_books), [`price_book_items`](#price_book_items)
- **Tồn kho**: [`stocks`](#stocks), [`stock_movements`](#stock_movements)
- **Đối tác**: [`customers`](#customers), [`customer_invoice_profiles`](#customer_invoice_profiles), [`suppliers`](#suppliers)
- **Đơn hàng**: [`orders`](#orders), [`order_items`](#order_items), [`invoices`](#invoices), [`invoice_items`](#invoice_items), [`invoice_payments`](#invoice_payments), [`sales_returns`](#sales_returns), [`sales_return_items`](#sales_return_items)
- **Mua hàng**: [`goods_receipts`](#goods_receipts), [`goods_receipt_items`](#goods_receipt_items), [`purchase_returns`](#purchase_returns), [`purchase_return_items`](#purchase_return_items)
- **Sổ quỹ & công nợ**: [`cash_accounts`](#cash_accounts), [`cash_categories`](#cash_categories), [`cash_transactions`](#cash_transactions), [`debt_ledger`](#debt_ledger), [`payment_allocations`](#payment_allocations)

## Kiểu liệt kê (enum)

| Enum | Giá trị |
| --- | --- |
| `cash_account_type` | `cash`, `bank` |
| `cash_direction` | `in`, `out` |
| `customer_type` | `individual`, `company` |
| `doc_status` | `completed`, `cancelled` |
| `import_status` | `queued`, `running`, `completed`, `failed` |
| `import_type` | `products`, `customers`, `suppliers`, `price-books` |
| `ledger_entry_type` | `opening`, `invoice`, `payment`, `return`, `adjustment` |
| `order_status` | `draft`, `completed`, `cancelled` |
| `party_type` | `customer`, `supplier`, `employee` |
| `payment_method` | `cash`, `bank` |
| `permission_scope` | `all`, `own` |
| `return_settlement` | `offset_debt`, `refund` |
| `stock_ref_type` | `opening`, `goods_receipt`, `invoice`, `sales_return`, `purchase_return`, `adjustment` |
| `supplier_kind` | `goods`, `driver`, `other` |
| `user_role` | `manager`, `assistant`, `accountant`, `warehouse`, `driver`, `sales`, `marketing` |

## Hệ thống

### branches

Chi nhánh/kho. Hiện chỉ có 1 nhưng mọi chứng từ đều gắn chi nhánh.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `address` | text | ✔ |  |  |
| `phone` | text | ✔ |  |  |
| `is_default` | boolean |  | `false` |  |
| `is_active` | boolean |  | `true` |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `branches_one_default` (unique): `is_default` WHERE isDefault

### users

Người dùng đăng nhập. Vai trò cố định (enum user_role).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `username` | text |  |  | unique |
| `full_name` | text |  |  |  |
| `password_hash` | text |  |  |  |
| `role` | user_role |  |  |  |
| `phone` | text | ✔ |  |  |
| `default_branch_id` | uuid | ✔ |  | → `branches.id` |
| `is_active` | boolean |  | `true` |  |
| `last_login_at` | timestamptz | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `users_role_idx`: `role`

### refresh_tokens

Refresh token (lưu băm, không lưu token thô).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `user_id` | uuid |  |  | → `users.id` (on delete cascade) |
| `token_hash` | text |  |  | unique |
| `expires_at` | timestamptz |  |  |  |
| `revoked_at` | timestamptz | ✔ |  |  |
| `user_agent` | text | ✔ |  |  |
| `ip` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `refresh_tokens_user_idx`: `user_id`

### audit_logs

Nhật ký thao tác — chỉ thêm, không sửa.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `user_id` | uuid | ✔ |  | → `users.id` (on delete set null) |
| `action` | text |  |  |  |
| `entity_type` | text |  |  |  |
| `entity_id` | uuid | ✔ |  |  |
| `before` | jsonb | ✔ |  |  |
| `after` | jsonb | ✔ |  |  |
| `ip` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `audit_logs_entity_idx`: `entity_type`, `entity_id`
- `audit_logs_created_idx`: `created_at`

### code_sequences

Bộ đếm sinh mã chứng từ theo tiền tố (HD, DH, PN…).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `prefix` | text |  |  | **PK** |
| `next_value` | bigint |  | `1` |  |
| `digits` | integer |  | `6` |  |
| `updated_at` | timestamptz |  | `now()` |  |

### company_profile

Thông tin công ty (1 dòng) dùng cho mẫu in.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `name` | text |  |  |  |
| `address` | text | ✔ |  |  |
| `phone` | text | ✔ |  |  |
| `email` | text | ✔ |  |  |
| `tax_code` | text | ✔ |  |  |
| `bank_name` | text | ✔ |  |  |
| `bank_account` | text | ✔ |  |  |
| `logo_url` | text | ✔ |  |  |
| `invoice_note` | text | ✔ |  |  |
| `updated_at` | timestamptz |  | `now()` |  |

### idempotency_keys

Chống tạo trùng khi gửi lại yêu cầu (header Idempotency-Key).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `user_id` | uuid |  |  | → `users.id` |
| `key` | text |  |  |  |
| `endpoint` | text |  |  |  |
| `request_hash` | text |  |  |  |
| `response_status` | integer | ✔ |  |  |
| `response_body` | jsonb | ✔ |  |  |
| `resource_type` | text | ✔ |  |  |
| `resource_id` | uuid | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `expires_at` | timestamptz |  |  |  |

**Chỉ mục:**

- `idempotency_user_key_uq` (unique): `user_id`, `key`
- `idempotency_expires_idx`: `expires_at`

### import_jobs

Công việc import Excel chạy nền.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `type` | import_type |  |  |  |
| `status` | import_status |  | `'queued'` |  |
| `dry_run` | boolean |  | `true` |  |
| `file_name` | text | ✔ |  |  |
| `total` | integer |  | `0` |  |
| `created` | integer |  | `0` |  |
| `updated` | integer |  | `0` |  |
| `failed` | integer |  | `0` |  |
| `errors` | jsonb | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `finished_at` | timestamptz | ✔ |  |  |

## Hàng hóa & giá

### categories

Nhóm hàng dạng cây (parent_id).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `name` | text |  |  |  |
| `parent_id` | uuid | ✔ |  | → `categories.id` |
| `sort_order` | integer |  | `0` |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `categories_parent_idx`: `parent_id`

### products

Hàng hóa. Mỗi quy cách là một SKU riêng; tồn kho ở bảng stocks.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `category_id` | uuid | ✔ |  | → `categories.id` |
| `unit` | text |  | `'Cái'` | Đơn vị tính (quy cách thường nằm trong tên hàng) |
| `base_price` | numeric(18,4) |  | `0` | Giá bán trong Bảng giá chung |
| `cost_price` | numeric(18,4) |  | `0` | Giá vốn bình quân gia quyền |
| `last_purchase_price` | numeric(18,4) | ✔ |  |  |
| `min_stock` | numeric(14,3) | ✔ |  |  |
| `max_stock` | numeric(14,3) | ✔ |  |  |
| `location` | text | ✔ |  |  |
| `description` | text | ✔ |  |  |
| `weight_g` | numeric(12,2) | ✔ |  |  |
| `is_active` | boolean |  | `true` |  |
| `is_sellable` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `products_category_idx`: `category_id`
- `products_search_trgm`: `f_search_text(code || ' ' || name) gin_trgm_ops`
- `products_active_idx`: `is_active`

### product_images

Ảnh sản phẩm.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `product_id` | uuid |  |  | → `products.id` (on delete cascade) |
| `url` | text |  |  |  |
| `storage_key` | text | ✔ |  |  |
| `sort_order` | integer |  | `0` |  |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `product_images_product_idx`: `product_id`

### price_books

Bảng giá theo hạng khách (Chung, Lớn, Vừa, VIP và 3 bản VAT). Thiếu giá thì lùi về bảng mặc định.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `with_vat` | boolean |  | `false` |  |
| `is_default` | boolean |  | `false` |  |
| `is_active` | boolean |  | `true` |  |
| `sort_order` | integer |  | `0` |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `price_books_one_default` (unique): `is_default` WHERE isDefault

### price_book_items

Giá của từng sản phẩm trong từng bảng giá.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `price_book_id` | uuid |  |  | **PK**; → `price_books.id` (on delete cascade) |
| `product_id` | uuid |  |  | **PK**; → `products.id` (on delete cascade) |
| `price` | numeric(18,4) |  |  |  |
| `updated_by` | uuid | ✔ |  | → `users.id` |
| `updated_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`price_book_id`, `product_id`)

**Chỉ mục:**

- `price_book_items_product_idx`: `product_id`

## Tồn kho

### stocks

Tồn hiện tại theo chi nhánh. Chỉ cập nhật cùng transaction với stock_movements.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `branch_id` | uuid |  |  | **PK**; → `branches.id` |
| `product_id` | uuid |  |  | **PK**; → `products.id` |
| `on_hand` | numeric(14,3) |  | `0` | Tồn thực tế; không âm (CHECK) |
| `updated_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`branch_id`, `product_id`)

**Ràng buộc CHECK:**

- `stocks_on_hand_nonneg`: `onHand >= 0`

### stock_movements

Sổ cái kho — chỉ thêm. Phục vụ thẻ kho.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `branch_id` | uuid |  |  | → `branches.id` |
| `product_id` | uuid |  |  | → `products.id` |
| `qty_delta` | numeric(14,3) |  |  | Số lượng thay đổi: + nhập, − xuất |
| `unit_cost` | numeric(18,4) | ✔ |  |  |
| `ref_type` | stock_ref_type |  |  |  |
| `ref_id` | uuid | ✔ |  |  |
| `ref_code` | text | ✔ |  |  |
| `occurred_at` | timestamptz |  |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |

**Chỉ mục:**

- `stock_movements_product_time_idx`: `product_id`, `occurred_at`
- `stock_movements_ref_idx`: `ref_type`, `ref_id`

**Ràng buộc CHECK:**

- `stock_movements_nonzero`: `qtyDelta <> 0`

## Đối tác

### customers

Khách hàng. Công nợ không lưu ở đây: số dư = tổng debt_ledger (có thể âm). sales_owner_id = nhân viên phụ trách.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `type` | customer_type |  | `'individual'` |  |
| `phone` | text | ✔ |  | unique |
| `address` | text | ✔ |  |  |
| `facebook` | text | ✔ |  |  |
| `sales_owner_id` | uuid | ✔ |  | → `users.id`; Nhân viên phụ trách (ở KiotViet là "Nhóm khách hàng") |
| `default_price_book_id` | uuid | ✔ |  | → `price_books.id`; Bảng giá tự áp khi đặt hàng |
| `credit_limit` | numeric(18,0) | ✔ |  | Hạn mức công nợ (cảnh báo mềm) |
| `payment_term_days` | integer | ✔ |  |  |
| `note` | text | ✔ |  |  |
| `is_active` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `customers_search_trgm`: `f_search_text(code || ' ' || name || ' ' || coalesce(phone, '')) gin_trgm_ops`
- `customers_sales_owner_idx`: `sales_owner_id`
- `customers_price_book_idx`: `default_price_book_id`

### customer_invoice_profiles

Thông tin xuất hóa đơn VAT/điện tử của khách.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `customer_id` | uuid |  |  | **PK**; → `customers.id` (on delete cascade) |
| `buyer_name` | text | ✔ |  |  |
| `company_name` | text | ✔ |  |  |
| `tax_code` | text | ✔ |  |  |
| `address` | text | ✔ |  |  |
| `email` | text | ✔ |  |  |
| `phone` | text | ✔ |  |  |
| `bank_name` | text | ✔ |  |  |
| `bank_account` | text | ✔ |  |  |

### suppliers

Nhà cung cấp; kind phân biệt NCC hàng hóa với lái xe/đối tượng khác.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `kind` | supplier_kind |  | `'goods'` |  |
| `phone` | text | ✔ |  |  |
| `address` | text | ✔ |  |  |
| `tax_code` | text | ✔ |  |  |
| `note` | text | ✔ |  |  |
| `is_active` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `suppliers_search_trgm`: `f_search_text(code || ' ' || name || ' ' || coalesce(phone, '')) gin_trgm_ops`
- `suppliers_kind_idx`: `kind`

## Đơn hàng

### orders

Đặt hàng. draft = phiếu tạm giữ hàng; một đơn → tối đa một hóa đơn.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `customer_id` | uuid |  |  | → `customers.id` |
| `status` | order_status |  | `'draft'` |  |
| `price_book_id` | uuid |  |  | → `price_books.id` |
| `seller_id` | uuid | ✔ |  | → `users.id` |
| `ordered_at` | timestamptz |  |  |  |
| `subtotal` | numeric(18,0) |  | `0` |  |
| `discount` | numeric(18,0) |  | `0` |  |
| `total` | numeric(18,0) |  | `0` |  |
| `deposit_amount` | numeric(18,0) |  | `0` | Tiền đặt cọc đã thu |
| `ship_name` | text | ✔ |  |  |
| `ship_phone` | text | ✔ |  |  |
| `ship_address` | text | ✔ |  |  |
| `package_count` | integer | ✔ |  |  |
| `weight_g` | numeric(12,2) | ✔ |  |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `orders_customer_idx`: `customer_id`, `ordered_at`
- `orders_status_idx`: `status`

### order_items

Dòng hàng của đơn đặt hàng.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `order_id` | uuid |  |  | → `orders.id` (on delete cascade) |
| `line_no` | integer |  |  |  |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `list_price` | numeric(18,4) |  |  |  |
| `discount_per_unit` | numeric(18,4) |  | `0` | Giảm giá tính trên 1 đơn vị (số tiền, không phải %) |
| `unit_price` | numeric(18,4) |  |  |  |
| `line_total` | numeric(18,0) |  |  |  |
| `is_gift` | boolean |  | `false` |  |
| `note` | text | ✔ |  |  |

**Chỉ mục:**

- `order_items_order_idx`: `order_id`
- `order_items_product_idx`: `product_id`

**Ràng buộc CHECK:**

- `order_items_qty_pos`: `qty > 0`

### invoices

Hóa đơn bán. Không sửa sau khi tạo (hủy và tạo lại). root_invoice_id/revision_no dành cho bản sửa .nn.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `root_invoice_id` | uuid | ✔ |  | → `invoices.id`; Hóa đơn gốc (bản sửa .nn) |
| `revision_no` | integer |  | `0` |  |
| `branch_id` | uuid |  |  | → `branches.id` |
| `order_id` | uuid | ✔ |  | unique; → `orders.id` |
| `customer_id` | uuid |  |  | → `customers.id` |
| `price_book_id` | uuid |  |  | → `price_books.id` |
| `seller_id` | uuid | ✔ |  | → `users.id` |
| `invoiced_at` | timestamptz |  |  |  |
| `subtotal` | numeric(18,0) |  |  |  |
| `discount` | numeric(18,0) |  | `0` |  |
| `total` | numeric(18,0) |  |  |  |
| `paid_total` | numeric(18,0) |  | `0` | Đã thu khi tạo + đã cấn trừ về sau (cache của sổ cái) |
| `status` | doc_status |  | `'completed'` |  |
| `ship_name` | text | ✔ |  |  |
| `ship_phone` | text | ✔ |  |  |
| `ship_address` | text | ✔ |  |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `invoices_customer_idx`: `customer_id`, `invoiced_at`
- `invoices_time_idx`: `invoiced_at`
- `invoices_status_idx`: `status`
- `invoices_root_rev_uq` (unique): `root_invoice_id`, `revision_no`

### invoice_items

Dòng hóa đơn; lưu bản sao mã/tên/đơn vị/giá vốn tại thời điểm bán.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `invoice_id` | uuid |  |  | → `invoices.id` (on delete cascade) |
| `line_no` | integer |  |  |  |
| `product_id` | uuid |  |  | → `products.id` |
| `product_code` | text |  |  |  |
| `product_name` | text |  |  |  |
| `unit` | text | ✔ |  |  |
| `qty` | numeric(14,3) |  |  |  |
| `list_price` | numeric(18,4) |  |  |  |
| `discount_per_unit` | numeric(18,4) |  | `0` | Giảm giá tính trên 1 đơn vị (số tiền, không phải %) |
| `unit_price` | numeric(18,4) |  |  | list_price − discount_per_unit |
| `line_total` | numeric(18,0) |  |  |  |
| `unit_cost` | numeric(18,4) |  | `0` | Giá vốn tại thời điểm bán (tính lãi gộp) |
| `is_gift` | boolean |  | `false` |  |
| `note` | text | ✔ |  |  |

**Chỉ mục:**

- `invoice_items_invoice_idx`: `invoice_id`
- `invoice_items_product_idx`: `product_id`

**Ràng buộc CHECK:**

- `invoice_items_qty_pos`: `qty > 0`

### invoice_payments

Khoản thanh toán lúc xuất hóa đơn (tiền mặt/chuyển khoản).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `invoice_id` | uuid |  |  | → `invoices.id` (on delete cascade) |
| `method` | payment_method |  |  |  |
| `account_id` | uuid |  |  | → `cash_accounts.id` |
| `amount` | numeric(18,0) |  |  |  |
| `paid_at` | timestamptz |  |  |  |
| `cash_transaction_id` | uuid | ✔ |  | → `cash_transactions.id` |

**Chỉ mục:**

- `invoice_payments_invoice_idx`: `invoice_id`

**Ràng buộc CHECK:**

- `invoice_payments_amount_pos`: `amount > 0`

### sales_returns

Trả hàng bán. Có thể không tham chiếu hóa đơn; mặc định bù trừ công nợ.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `customer_id` | uuid |  |  | → `customers.id` |
| `invoice_id` | uuid | ✔ |  | → `invoices.id` |
| `status` | doc_status |  | `'completed'` |  |
| `returned_at` | timestamptz |  |  |  |
| `total` | numeric(18,0) |  |  |  |
| `settlement` | return_settlement |  | `'offset_debt'` |  |
| `refund_account_id` | uuid | ✔ |  | → `cash_accounts.id` |
| `received_by` | uuid | ✔ |  | → `users.id` |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `sales_returns_customer_idx`: `customer_id`, `returned_at`
- `sales_returns_invoice_idx`: `invoice_id`

### sales_return_items

Dòng hàng trả lại của khách.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `return_id` | uuid |  |  | → `sales_returns.id` (on delete cascade) |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `return_price` | numeric(18,4) |  |  |  |
| `line_total` | numeric(18,0) |  |  |  |
| `restock` | boolean |  | `true` | true = nhập lại kho |
| `restock_cost` | numeric(18,4) | ✔ |  |  |
| `reason` | text | ✔ |  |  |

**Chỉ mục:**

- `sales_return_items_return_idx`: `return_id`

**Ràng buộc CHECK:**

- `sales_return_items_qty_pos`: `qty > 0`

## Mua hàng

### goods_receipts

Phiếu nhập hàng. po_ref chỉ là mã phiếu đặt nhập dạng chữ để đối chiếu.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `supplier_id` | uuid |  |  | → `suppliers.id` |
| `status` | doc_status |  | `'completed'` |  |
| `received_at` | timestamptz |  |  |  |
| `supplier_invoice_no` | text | ✔ |  |  |
| `po_ref` | text | ✔ |  | Mã phiếu đặt nhập (PDN…) dạng chữ, chỉ để đối chiếu |
| `subtotal` | numeric(18,0) |  |  |  |
| `discount` | numeric(18,0) |  | `0` |  |
| `total` | numeric(18,0) |  |  |  |
| `paid_amount` | numeric(18,0) |  | `0` |  |
| `received_by` | uuid | ✔ |  | → `users.id` |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `goods_receipts_supplier_idx`: `supplier_id`, `received_at`
- `goods_receipts_time_idx`: `received_at`

### goods_receipt_items

Dòng hàng của phiếu nhập.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `receipt_id` | uuid |  |  | → `goods_receipts.id` (on delete cascade) |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `unit_cost` | numeric(18,4) |  |  |  |
| `line_total` | numeric(18,0) |  |  |  |
| `note` | text | ✔ |  |  |

**Chỉ mục:**

- `goods_receipt_items_receipt_idx`: `receipt_id`
- `goods_receipt_items_product_idx`: `product_id`

**Ràng buộc CHECK:**

- `goods_receipt_items_qty_pos`: `qty > 0`

### purchase_returns

Trả hàng nhập (trả lại nhà cung cấp).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `supplier_id` | uuid |  |  | → `suppliers.id` |
| `goods_receipt_id` | uuid | ✔ |  | → `goods_receipts.id` |
| `status` | doc_status |  | `'completed'` |  |
| `returned_at` | timestamptz |  |  |  |
| `total` | numeric(18,0) |  |  |  |
| `settlement` | return_settlement |  | `'offset_debt'` |  |
| `refund_account_id` | uuid | ✔ |  | → `cash_accounts.id` |
| `reason` | text | ✔ |  |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `purchase_returns_supplier_idx`: `supplier_id`, `returned_at`

### purchase_return_items

Dòng hàng của phiếu trả nhập.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `return_id` | uuid |  |  | → `purchase_returns.id` (on delete cascade) |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `return_price` | numeric(18,4) |  |  |  |
| `line_total` | numeric(18,0) |  |  |  |

**Chỉ mục:**

- `purchase_return_items_return_idx`: `return_id`

**Ràng buộc CHECK:**

- `purchase_return_items_qty_pos`: `qty > 0`

## Sổ quỹ & công nợ

### cash_accounts

Quỹ: tiền mặt hoặc tài khoản ngân hàng.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `name` | text |  |  |  |
| `type` | cash_account_type |  |  |  |
| `branch_id` | uuid | ✔ |  | → `branches.id` |
| `opening_balance` | numeric(18,0) |  | `0` |  |
| `is_active` | boolean |  | `true` |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

### cash_categories

Danh mục thu chi chuẩn.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `name` | text |  |  |  |
| `direction` | cash_direction |  |  |  |
| `is_system` | boolean |  | `false` |  |
| `is_active` | boolean |  | `true` |  |
| `sort_order` | integer |  | `0` |  |

### cash_transactions

Phiếu thu/chi. amount luôn dương, chiều do direction. party_id đa hình theo party_type.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `direction` | cash_direction |  |  |  |
| `amount` | numeric(18,0) |  |  | Luôn dương; chiều thu/chi do direction |
| `category_id` | uuid |  |  | → `cash_categories.id` |
| `account_id` | uuid |  |  | → `cash_accounts.id` |
| `occurred_at` | timestamptz |  |  |  |
| `party_type` | party_type | ✔ |  |  |
| `party_id` | uuid | ✔ |  | Đa hình theo party_type (không có khóa ngoại) |
| `party_name` | text | ✔ |  |  |
| `vehicle_ref` | text | ✔ |  |  |
| `ref_type` | text | ✔ |  |  |
| `ref_id` | uuid | ✔ |  |  |
| `status` | doc_status |  | `'completed'` |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `cash_transactions_time_idx`: `occurred_at`
- `cash_transactions_party_idx`: `party_type`, `party_id`
- `cash_transactions_account_idx`: `account_id`, `occurred_at`

**Ràng buộc CHECK:**

- `cash_transactions_amount_pos`: `amount > 0`

### debt_ledger

Sổ cái công nợ — chỉ thêm. amount có dấu (+ tăng nợ, − giảm nợ). Số dư được phép âm. party_id đa hình nên không có khóa ngoại.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `party_type` | party_type |  |  |  |
| `party_id` | uuid |  |  | Đa hình theo party_type (không có khóa ngoại) |
| `entry_type` | ledger_entry_type |  |  |  |
| `ref_type` | text | ✔ |  |  |
| `ref_id` | uuid | ✔ |  |  |
| `ref_code` | text | ✔ |  |  |
| `amount` | numeric(18,0) |  |  | + tăng nợ, − giảm nợ |
| `occurred_at` | timestamptz |  |  |  |
| `note` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |

**Chỉ mục:**

- `debt_ledger_party_idx`: `party_type`, `party_id`, `occurred_at`
- `debt_ledger_ref_idx`: `ref_type`, `ref_id`

**Ràng buộc CHECK:**

- `debt_ledger_nonzero`: `amount <> 0`

### payment_allocations

Cấn trừ phiếu thu vào từng hóa đơn.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `cash_transaction_id` | uuid |  |  | → `cash_transactions.id` |
| `invoice_id` | uuid |  |  | → `invoices.id` |
| `amount` | numeric(18,0) |  |  |  |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `payment_allocations_uq` (unique): `cash_transaction_id`, `invoice_id`
- `payment_allocations_invoice_idx`: `invoice_id`

**Ràng buộc CHECK:**

- `payment_allocations_amount_pos`: `amount > 0`
