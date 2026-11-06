# Từ điển dữ liệu

> **Sinh tự động** từ `apps/api/src/db/schema` bằng `pnpm db:docs` — không sửa tay. Tổng quan và cách xem sơ đồ: [`README.md`](README.md).

**44 bảng · 19 kiểu liệt kê (enum)**

## Mục lục

- **Hệ thống**: [`branches`](#branches), [`users`](#users), [`refresh_tokens`](#refresh_tokens), [`audit_logs`](#audit_logs), [`code_sequences`](#code_sequences), [`company_profile`](#company_profile), [`idempotency_keys`](#idempotency_keys), [`import_jobs`](#import_jobs), [`user_branches`](#user_branches), [`role_permissions`](#role_permissions), [`user_identities`](#user_identities), [`system_settings`](#system_settings), [`user_table_prefs`](#user_table_prefs)
- **Hàng hóa & giá**: [`products`](#products), [`product_images`](#product_images), [`product_components`](#product_components), [`price_books`](#price_books), [`price_book_items`](#price_book_items)
- **Tồn kho & chuyển kho**: [`stocks`](#stocks), [`stock_movements`](#stock_movements), [`stock_transfers`](#stock_transfers), [`stock_transfer_items`](#stock_transfer_items)
- **Đối tác**: [`customers`](#customers), [`customer_branch_terms`](#customer_branch_terms), [`customer_profiles`](#customer_profiles), [`customer_visits`](#customer_visits), [`suppliers`](#suppliers), [`supplier_branch_history`](#supplier_branch_history)
- **Đơn hàng**: [`orders`](#orders), [`order_items`](#order_items), [`invoices`](#invoices), [`invoice_items`](#invoice_items), [`invoice_payments`](#invoice_payments), [`sales_returns`](#sales_returns), [`sales_return_items`](#sales_return_items)
- **Mua hàng**: [`purchase_orders`](#purchase_orders), [`purchase_order_items`](#purchase_order_items), [`goods_receipts`](#goods_receipts), [`goods_receipt_items`](#goods_receipt_items), [`purchase_returns`](#purchase_returns), [`purchase_return_items`](#purchase_return_items)
- **Sổ quỹ & công nợ**: [`cash_accounts`](#cash_accounts), [`cash_categories`](#cash_categories), [`cash_transactions`](#cash_transactions), [`debt_ledger`](#debt_ledger), [`payment_allocations`](#payment_allocations)

## Kiểu liệt kê (enum)

| Enum | Giá trị |
| --- | --- |
| `cash_account_type` | `cash`, `bank` |
| `cash_direction` | `in`, `out` |
| `customer_price_level` | `new`, `medium`, `large`, `vip` |
| `doc_status` | `completed`, `cancelled` |
| `import_mode` | `overwrite`, `add` |
| `import_status` | `queued`, `running`, `completed`, `failed` |
| `import_type` | `products`, `customers`, `suppliers`, `price-books` |
| `ledger_entry_type` | `opening`, `invoice`, `payment`, `return`, `adjustment`, `transfer` |
| `liquidation_status` | `normal`, `clearance`, `disabled`, `high_stock`, `priority_stock` |
| `order_status` | `draft`, `completed`, `cancelled` |
| `party_type` | `customer`, `supplier`, `employee` |
| `payment_method` | `cash`, `bank` |
| `permission_scope` | `all`, `own` |
| `product_type` | `goods`, `combo` |
| `purchase_order_status` | `draft`, `confirmed`, `completed`, `cancelled` |
| `shipping_payer` | `sender`, `receiver` |
| `stock_ref_type` | `opening`, `goods_receipt`, `invoice`, `sales_return`, `purchase_return`, `adjustment`, `transfer_out`, `transfer_in`, `transfer_cancel` |
| `transfer_status` | `in_transit`, `received`, `cancelled` |
| `user_role` | `manager`, `assistant`, `accountant`, `warehouse`, `driver`, `sales`, `marketing`, `pending` |

## Hệ thống

### branches

Chi nhánh/kho (Hà Nội, Sài Gòn). Giá bán, tồn kho, giá vốn, công nợ, quỹ và mọi chứng từ đều tách theo chi nhánh.

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
| `must_change_password` | boolean |  | `false` |  |
| `role` | user_role |  |  |  |
| `phone` | text | ✔ |  |  |
| `default_branch_id` | uuid | ✔ |  | → `branches.id` |
| `is_active` | boolean |  | `true` |  |
| `last_login_at` | timestamptz | ✔ |  |  |
| `password_changed_at` | timestamptz | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `users_role_idx`: `role`
- `users_username_lower_unique` (unique): `lower(username)`

### refresh_tokens

Refresh token (lưu băm, không lưu token thô).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `user_id` | uuid |  |  | → `users.id` (on delete cascade) |
| `token_hash` | text |  |  | unique |
| `expires_at` | timestamptz |  |  |  |
| `revoked_at` | timestamptz | ✔ |  |  |
| `revoke_reason` | text | ✔ |  |  |
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
| `request_id` | text | ✔ |  |  |
| `branch_id` | uuid | ✔ |  | → `branches.id` |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `audit_logs_request_idx`: `request_id`
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
| `mode` | import_mode |  | `'overwrite'` |  |
| `status` | import_status |  | `'queued'` |  |
| `dry_run` | boolean |  | `true` |  |
| `file_name` | text | ✔ |  |  |
| `total` | integer |  | `0` |  |
| `created` | integer |  | `0` |  |
| `updated` | integer |  | `0` |  |
| `failed` | integer |  | `0` |  |
| `errors` | jsonb | ✔ |  |  |
| `branch_id` | uuid | ✔ |  | → `branches.id` |
| `file_hash` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `finished_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `import_jobs_add_file_unique` (unique): `branch_id`, `file_hash` WHERE mode = 'add' and dryRun = false and status = 'completed' and fileHash is not null

### user_branches

Chi nhánh người dùng được làm việc (Quản lý thấy tất cả, không cần dòng ở đây).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `user_id` | uuid |  |  | **PK**; → `users.id` (on delete cascade) |
| `branch_id` | uuid |  |  | **PK**; → `branches.id` |
| `created_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`user_id`, `branch_id`)

**Chỉ mục:**

- `user_branches_branch_idx`: `branch_id`

### role_permissions

Quyền của từng vai trò do Quản lý cấu hình (vai trò manager luôn đủ quyền, không lưu ở đây).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `role` | user_role |  |  | **PK** |
| `permission_code` | text |  |  | **PK** |
| `scope` | permission_scope |  | `'all'` |  |
| `updated_by` | uuid | ✔ |  | → `users.id` (on delete set null) |
| `updated_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`role`, `permission_code`)

**Chỉ mục:**

- `role_permissions_role_idx`: `role`

### user_identities

Danh tính đăng nhập bên ngoài (Google qua Supabase) gắn với người dùng; khớp theo provider_subject, không theo email.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `user_id` | uuid |  |  | → `users.id` (on delete cascade) |
| `provider` | text |  |  |  |
| `provider_subject` | text |  |  |  |
| `email` | text |  |  |  |
| `linked_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `user_identities_provider_subject_unique` (unique): `provider`, `provider_subject`
- `user_identities_user_idx`: `user_id`

### system_settings

Cài đặt hệ thống dạng khóa → JSON do Quản lý chỉnh (vd mở/tắt tự đăng ký bằng Google).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `key` | text |  |  | **PK** |
| `value` | jsonb |  |  |  |
| `updated_by` | uuid | ✔ |  | → `users.id` (on delete set null) |
| `updated_at` | timestamptz |  | `now()` |  |

### user_table_prefs

Tùy chỉnh bảng theo từng tài khoản (cột ẩn, thứ tự, độ rộng, số dòng/trang); mỗi (người dùng, khóa bảng) một dòng, settings là JSON.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `user_id` | uuid |  |  | **PK**; → `users.id` (on delete cascade) |
| `table_key` | text |  |  | **PK** |
| `settings` | jsonb |  |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`user_id`, `table_key`)

## Hàng hóa & giá

### products

Hàng hóa — chỉ thông tin DÙNG CHUNG giữa các chi nhánh. Giá bán ở price_book_items, tồn kho/giá vốn/vị trí ở stocks (theo chi nhánh).

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `product_type` | product_type |  | `'goods'` | Loại hàng: goods = Hàng hóa (mặc định), combo = gói các hàng thành phần (không có tồn/giá vốn riêng) |
| `liquidation_status` | liquidation_status |  | `'normal'` | Trạng thái thanh lý: normal = Thường (mặc định), clearance = Thanh Lý, disabled = Tắt Mã, high_stock = Tồn Cao, priority_stock = Tồn Ưu Tiên |
| `description` | text | ✔ |  |  |
| `is_active` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `products_search_trgm`: `f_search_text(code || ' ' || name) gin_trgm_ops`
- `products_active_idx`: `is_active`
- `products_type_idx`: `product_type`
- `products_liquidation_idx`: `liquidation_status`
- `products_code_lower_unique` (unique): `lower(code)`

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

### product_components

Thành phần của combo: combo_id → component_id (hàng hóa) với qty nguyên dương. Combo không có tồn/giá vốn riêng, luôn tính từ thành phần.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `combo_id` | uuid |  |  | **PK**; → `products.id` (on delete cascade) |
| `component_id` | uuid |  |  | **PK**; → `products.id` |
| `qty` | integer |  |  |  |
| `sort_order` | integer |  | `0` |  |

**Khóa chính ghép:** (`combo_id`, `component_id`)

**Chỉ mục:**

- `product_components_component_idx`: `component_id`

**Ràng buộc CHECK:**

- `product_components_qty_positive`: `qty > 0`
- `product_components_not_self`: `comboId <> componentId`

## Tồn kho & chuyển kho

### stocks

Kho theo (chi nhánh, sản phẩm): tồn, giá vốn bình quân, giá nhập cuối, tồn tối thiểu/tối đa, vị trí kho. Chỉ cập nhật cùng transaction với stock_movements.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `branch_id` | uuid |  |  | **PK**; → `branches.id` |
| `product_id` | uuid |  |  | **PK**; → `products.id` |
| `on_hand` | numeric(14,3) |  | `0` | Tồn thực tế; không âm (CHECK) |
| `cost_price` | numeric(18,4) |  | `0` | Giá vốn bình quân gia quyền CỦA chi nhánh này |
| `last_purchase_price` | numeric(18,4) | ✔ |  | Giá nhập cuối của chi nhánh này |
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

### stock_transfers

Phiếu chuyển kho giữa 2 chi nhánh, 2 bước (đang đi đường → đã nhận). Không phải hóa đơn bán. Giá nhập bên nhận = giá vốn bên gửi + phí vận chuyển phân bổ.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `from_branch_id` | uuid |  |  | → `branches.id` |
| `to_branch_id` | uuid |  |  | → `branches.id` |
| `status` | transfer_status |  | `'in_transit'` |  |
| `sent_at` | timestamptz |  |  |  |
| `received_at` | timestamptz | ✔ |  |  |
| `goods_value` | numeric(18,0) |  |  | Tổng tiền hàng theo giá vốn bên gửi tại thời điểm gửi |
| `shipping_fee` | numeric(18,0) |  | `0` | Phí vận chuyển; cộng vào giá nhập kho của bên nhận |
| `shipping_paid_by` | shipping_payer |  | `'sender'` | Bên ứng tiền trả xe; sender → công nợ đối ứng gồm cả phí |
| `debt_amount` | numeric(18,0) | ✔ |  | Công nợ đối ứng đã ghi khi nhận hàng |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `received_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `stock_transfers_from_idx`: `from_branch_id`, `sent_at`
- `stock_transfers_to_idx`: `to_branch_id`, `sent_at`
- `stock_transfers_status_idx`: `status`

**Ràng buộc CHECK:**

- `stock_transfers_branches_differ`: `fromBranchId <> toBranchId`
- `stock_transfers_fee_nonneg`: `shippingFee >= 0`

### stock_transfer_items

Dòng hàng chuyển kho: giá vốn bên gửi, phần phí phân bổ và giá nhập kho của bên nhận.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `transfer_id` | uuid |  |  | → `stock_transfers.id` (on delete cascade) |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `unit_cost_sent` | numeric(18,4) |  |  |  |
| `shipping_share` | numeric(18,0) |  | `0` |  |
| `unit_cost_received` | numeric(18,4) | ✔ |  | Giá nhập kho bên nhận = giá vốn gửi + phí phân bổ / số lượng |

**Chỉ mục:**

- `stock_transfer_items_transfer_idx`: `transfer_id`
- `stock_transfer_items_product_idx`: `product_id`

**Ràng buộc CHECK:**

- `stock_transfer_items_qty_pos`: `qty > 0`

## Đối tác

### customers

Khách hàng. Công nợ không lưu ở đây: số dư = tổng debt_ledger (có thể âm). sales_owner_id = nhân viên phụ trách.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `phone` | text | ✔ |  | unique |
| `address` | text | ✔ |  |  |
| `sales_owner_id` | uuid | ✔ |  | → `users.id`; Nhân viên phụ trách (ở KiotViet là "Nhóm khách hàng") |
| `price_level` | customer_price_level |  | `'new'` | Level giá (Mới/Vừa/Lớn/Vip) để nhân viên tham chiếu khi báo giá; hệ thống không có bảng giá |
| `new_since` | date | ✔ |  | Tháng trở thành khách mới (ngày đầu tháng); trống = khách cũ hoặc không rõ |
| `acquisition_source` | text | ✔ |  | Nguồn khách mới (vd Page) |
| `linked_branch_id` | uuid | ✔ |  | unique; → `branches.id`; Khách hàng hệ thống đại diện một chi nhánh (chuyển kho nội bộ) |
| `note` | text | ✔ |  |  |
| `is_active` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `customers_search_trgm`: `f_search_text(code || ' ' || name || ' ' || coalesce(phone, '')) gin_trgm_ops`
- `customers_sales_owner_idx`: `sales_owner_id`

### customer_branch_terms

Hạn mức và kỳ hạn công nợ của khách, riêng từng chi nhánh.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `customer_id` | uuid |  |  | **PK**; → `customers.id` (on delete cascade) |
| `branch_id` | uuid |  |  | **PK**; → `branches.id` |
| `credit_limit` | numeric(18,0) | ✔ |  | Hạn mức công nợ tại chi nhánh này (cảnh báo mềm) |
| `payment_term_days` | integer | ✔ |  |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Khóa chính ghép:** (`customer_id`, `branch_id`)

### customer_profiles

Hồ sơ kinh doanh của khách (kho, đối thủ, hình thức bán, quy mô) từ file TKS; quan hệ 1-1, hầu hết khách không có.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `customer_id` | uuid |  |  | **PK**; → `customers.id` (on delete cascade) |
| `warehouse_location` | text | ✔ |  |  |
| `warehouse_count` | integer | ✔ |  |  |
| `warehouse_area` | text | ✔ |  |  |
| `warehouse_photo_url` | text | ✔ |  | Đường link ảnh kho từ file TKS |
| `competitors` | text | ✔ |  |  |
| `sales_methods` | text[] | ✔ |  | Hình thức bán hàng (nhiều giá trị): Bán cửa hàng, FB live, Kho buôn, Bán sàn, Sang tay, FB ads, Khác |
| `scale` | text | ✔ |  |  |
| `updated_at` | timestamptz |  | `now()` |  |

### customer_visits

Lịch tiếp khách: mỗi dòng một ngày; ngày tiếp khách gần nhất = ngày lớn nhất.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `customer_id` | uuid |  |  | → `customers.id` (on delete cascade) |
| `visited_on` | date |  |  |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `customer_visits_uq` (unique): `customer_id`, `visited_on`

### suppliers

Nhà cung cấp; group_name là nhóm NCC (chuỗi tự do, có thể để trống). Số liệu tiền theo từng chi nhánh: xem supplier_branch_history và debt_ledger.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `name` | text |  |  |  |
| `group_name` | text | ✔ |  |  |
| `linked_branch_id` | uuid | ✔ |  | unique; → `branches.id`; Nhà cung cấp hệ thống đại diện một chi nhánh (chuyển kho nội bộ) |
| `is_active` | boolean |  | `true` |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |
| `deleted_at` | timestamptz | ✔ |  |  |

**Chỉ mục:**

- `suppliers_search_trgm`: `f_search_text(code || ' ' || name || ' ' || coalesce(groupName, '')) gin_trgm_ops`
- `suppliers_code_lower_unique` (unique): `lower(code)`

### supplier_branch_history

Tổng mua / mua thuần lịch sử (chuyển từ KiotViet) của NCC tại từng chi nhánh.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `supplier_id` | uuid |  |  | **PK**; → `suppliers.id` (on delete cascade) |
| `branch_id` | uuid |  |  | **PK**; → `branches.id` |
| `purchase_total` | numeric(18,0) |  | `0` |  |
| `purchase_net` | numeric(18,0) |  | `0` |  |

**Khóa chính ghép:** (`supplier_id`, `branch_id`)

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
| `seller_id` | uuid | ✔ |  | → `users.id`; Người nhận đặt (khác người tạo) |
| `ordered_at` | timestamptz |  |  |  |
| `subtotal` | numeric(18,0) |  | `0` | Σ line_total của các dòng |
| `discount` | numeric(18,0) |  | `0` |  |
| `total` | numeric(18,0) |  | `0` | subtotal − discount (Khách cần trả) |
| `pickup_address` | text | ✔ |  | Địa chỉ lấy hàng (file KiotViet) |
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
| `discount_per_unit` | numeric(18,4) |  | `0` | Giảm giá tính trên 1 đơn vị (số tiền, không phải %) |
| `unit_price` | numeric(18,4) |  |  | Giá bán sau giảm; giá trước giảm = unit_price + discount_per_unit |
| `line_total` | numeric(18,0) |  |  |  |
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
| `seller_id` | uuid | ✔ |  | → `users.id` |
| `invoiced_at` | timestamptz |  |  |  |
| `subtotal` | numeric(18,0) |  |  |  |
| `discount` | numeric(18,0) |  | `0` |  |
| `total` | numeric(18,0) |  |  |  |
| `paid_total` | numeric(18,0) |  | `0` | Đã thu khi tạo + đã cấn trừ về sau (cache của sổ cái) |
| `status` | doc_status |  | `'completed'` |  |
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
| `qty` | numeric(14,3) |  |  |  |
| `discount_per_unit` | numeric(18,4) |  | `0` | Giảm giá tính trên 1 đơn vị (số tiền, không phải %) |
| `unit_price` | numeric(18,4) |  |  | Giá bán sau giảm; giá trước giảm = unit_price + discount_per_unit |
| `line_total` | numeric(18,0) |  |  |  |
| `unit_cost` | numeric(18,4) |  | `0` | Giá vốn tại thời điểm bán (tính lãi gộp) |
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
| `restock_price` | numeric(18,4) | ✔ |  | Giá nhập lại (file KiotViet), có thể khác giá bán; không đổi giá vốn bình quân, chênh lệch (giá bán − giá nhập lại) × SL tính vào lợi nhuận |
| `note` | text | ✔ |  |  |

**Chỉ mục:**

- `sales_return_items_return_idx`: `return_id`

**Ràng buộc CHECK:**

- `sales_return_items_qty_pos`: `qty > 0`

## Mua hàng

### purchase_orders

Đặt hàng nhập (chưa cộng tồn); ordered_by = Người đặt, created_by = Người tạo.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `supplier_id` | uuid |  |  | → `suppliers.id` |
| `status` | purchase_order_status |  | `'draft'` |  |
| `ordered_at` | timestamptz |  |  |  |
| `ordered_by` | uuid | ✔ |  | → `users.id` |
| `total` | numeric(18,0) |  |  |  |
| `note` | text | ✔ |  |  |
| `created_by` | uuid | ✔ |  | → `users.id` |
| `cancelled_at` | timestamptz | ✔ |  |  |
| `cancel_reason` | text | ✔ |  |  |
| `created_at` | timestamptz |  | `now()` |  |
| `updated_at` | timestamptz |  | `now()` |  |

**Chỉ mục:**

- `purchase_orders_supplier_idx`: `supplier_id`, `ordered_at`
- `purchase_orders_branch_idx`: `branch_id`, `ordered_at`

### purchase_order_items

Dòng hàng của đặt hàng nhập.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `order_id` | uuid |  |  | → `purchase_orders.id` (on delete cascade) |
| `product_id` | uuid |  |  | → `products.id` |
| `qty` | numeric(14,3) |  |  |  |
| `unit_cost` | numeric(18,4) |  |  |  |
| `line_total` | numeric(18,0) |  |  |  |

**Chỉ mục:**

- `purchase_order_items_order_idx`: `order_id`
- `purchase_order_items_product_idx`: `product_id`

**Ràng buộc CHECK:**

- `purchase_order_items_qty_pos`: `qty > 0`

### goods_receipts

Phiếu nhập hàng; purchase_order_id trỏ tới đặt hàng nhập (nếu có). Tiền trả NCC đi qua Sổ quỹ.

| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |
| --- | --- | :-: | --- | --- |
| `id` | uuid |  | `gen_random_uuid()` | **PK** |
| `code` | text |  |  | unique |
| `branch_id` | uuid |  |  | → `branches.id` |
| `supplier_id` | uuid |  |  | → `suppliers.id` |
| `purchase_order_id` | uuid | ✔ |  | → `purchase_orders.id` |
| `status` | doc_status |  | `'completed'` |  |
| `received_at` | timestamptz |  |  |  |
| `total` | numeric(18,0) |  |  |  |
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
- `goods_receipts_po_idx`: `purchase_order_id`

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
| `returned_by` | uuid | ✔ |  | → `users.id` |
| `total` | numeric(18,0) |  |  |  |
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
| `note` | text | ✔ |  |  |

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
| `code` | text | ✔ |  | unique |
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
| `branch_id` | uuid |  |  | → `branches.id`; Công nợ tách biệt theo chi nhánh |
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

- `debt_ledger_party_idx`: `party_type`, `party_id`, `branch_id`, `occurred_at`
- `debt_ledger_branch_idx`: `branch_id`, `occurred_at`
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
