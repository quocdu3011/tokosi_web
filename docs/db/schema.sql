-- Sinh tự động từ apps/api/drizzle/*.sql bằng `pnpm db:docs` — không sửa tay.
-- Chạy theo thứ tự trên PostgreSQL 17 để tạo toàn bộ lược đồ (DBeaver, pgModeler, DataGrip…).

-- ===== 0000_init.sql =====
CREATE TYPE "public"."cash_account_type" AS ENUM('cash', 'bank');CREATE TYPE "public"."cash_direction" AS ENUM('in', 'out');CREATE TYPE "public"."customer_type" AS ENUM('individual', 'company');CREATE TYPE "public"."doc_status" AS ENUM('completed', 'cancelled');CREATE TYPE "public"."import_status" AS ENUM('queued', 'running', 'completed', 'failed');CREATE TYPE "public"."import_type" AS ENUM('products', 'customers', 'suppliers', 'price-books');CREATE TYPE "public"."ledger_entry_type" AS ENUM('opening', 'invoice', 'payment', 'return', 'adjustment');CREATE TYPE "public"."order_status" AS ENUM('draft', 'completed', 'cancelled');CREATE TYPE "public"."party_type" AS ENUM('customer', 'supplier', 'employee');CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank');CREATE TYPE "public"."return_settlement" AS ENUM('offset_debt', 'refund');CREATE TYPE "public"."stock_ref_type" AS ENUM('opening', 'goods_receipt', 'invoice', 'sales_return', 'purchase_return', 'adjustment');CREATE TYPE "public"."supplier_kind" AS ENUM('goods', 'driver', 'other');CREATE TYPE "public"."user_role" AS ENUM('owner', 'accountant', 'warehouse', 'clerk');CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
CREATE TABLE "code_sequences" (
	"prefix" text PRIMARY KEY NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"digits" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "company_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"tax_code" text,
	"bank_name" text,
	"bank_account" text,
	"logo_url" text,
	"invoice_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"resource_type" text,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "import_type" NOT NULL,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"file_name" text,
	"total" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"phone" text,
	"default_branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_code_unique" UNIQUE("code"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
CREATE TABLE "price_book_items" (
	"price_book_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_book_items_price_book_id_product_id_pk" PRIMARY KEY("price_book_id","product_id")
);
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"with_vat" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_books_code_unique" UNIQUE("code")
);
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"storage_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"unit" text DEFAULT 'Cái' NOT NULL,
	"base_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"last_purchase_price" numeric(18, 4),
	"min_stock" numeric(14, 3),
	"max_stock" numeric(14, 3),
	"location" text,
	"description" text,
	"weight_g" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sellable" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
CREATE TABLE "customer_invoice_profiles" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"buyer_name" text,
	"company_name" text,
	"tax_code" text,
	"address" text,
	"email" text,
	"phone" text,
	"bank_name" text,
	"bank_account" text
);
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "customer_type" DEFAULT 'individual' NOT NULL,
	"phone" text,
	"address" text,
	"facebook" text,
	"sales_owner_id" uuid,
	"default_price_book_id" uuid,
	"credit_limit" numeric(18, 0),
	"payment_term_days" integer,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_code_unique" UNIQUE("code"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "supplier_kind" DEFAULT 'goods' NOT NULL,
	"phone" text,
	"address" text,
	"tax_code" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_delta" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(18, 4),
	"ref_type" "stock_ref_type" NOT NULL,
	"ref_id" uuid,
	"ref_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_movements_nonzero" CHECK ("stock_movements"."qty_delta" <> 0)
);
CREATE TABLE "stocks" (
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"on_hand" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocks_branch_id_product_id_pk" PRIMARY KEY("branch_id","product_id"),
	CONSTRAINT "stocks_on_hand_nonneg" CHECK ("stocks"."on_hand" >= 0)
);
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"unit" text,
	"qty" numeric(14, 3) NOT NULL,
	"list_price" numeric(18, 4) NOT NULL,
	"discount_per_unit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_gift" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "invoice_items_qty_pos" CHECK ("invoice_items"."qty" > 0)
);
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(18, 0) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"cash_transaction_id" uuid,
	CONSTRAINT "invoice_payments_amount_pos" CHECK ("invoice_payments"."amount" > 0)
);
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"root_invoice_id" uuid,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid,
	"customer_id" uuid NOT NULL,
	"price_book_id" uuid NOT NULL,
	"seller_id" uuid,
	"invoiced_at" timestamp with time zone NOT NULL,
	"subtotal" numeric(18, 0) NOT NULL,
	"discount" numeric(18, 0) DEFAULT '0' NOT NULL,
	"total" numeric(18, 0) NOT NULL,
	"paid_total" numeric(18, 0) DEFAULT '0' NOT NULL,
	"status" "doc_status" DEFAULT 'completed' NOT NULL,
	"ship_name" text,
	"ship_phone" text,
	"ship_address" text,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_code_unique" UNIQUE("code"),
	CONSTRAINT "invoices_orderId_unique" UNIQUE("order_id")
);
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"list_price" numeric(18, 4) NOT NULL,
	"discount_per_unit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	"is_gift" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "order_items_qty_pos" CHECK ("order_items"."qty" > 0)
);
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"price_book_id" uuid NOT NULL,
	"seller_id" uuid,
	"ordered_at" timestamp with time zone NOT NULL,
	"subtotal" numeric(18, 0) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 0) DEFAULT '0' NOT NULL,
	"total" numeric(18, 0) DEFAULT '0' NOT NULL,
	"deposit_amount" numeric(18, 0) DEFAULT '0' NOT NULL,
	"ship_name" text,
	"ship_phone" text,
	"ship_address" text,
	"package_count" integer,
	"weight_g" numeric(12, 2),
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_unique" UNIQUE("code")
);
CREATE TABLE "sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"return_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"restock_cost" numeric(18, 4),
	"reason" text,
	CONSTRAINT "sales_return_items_qty_pos" CHECK ("sales_return_items"."qty" > 0)
);
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" "doc_status" DEFAULT 'completed' NOT NULL,
	"returned_at" timestamp with time zone NOT NULL,
	"total" numeric(18, 0) NOT NULL,
	"settlement" "return_settlement" DEFAULT 'offset_debt' NOT NULL,
	"refund_account_id" uuid,
	"received_by" uuid,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_code_unique" UNIQUE("code")
);
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	"note" text,
	CONSTRAINT "goods_receipt_items_qty_pos" CHECK ("goods_receipt_items"."qty" > 0)
);
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "doc_status" DEFAULT 'completed' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"supplier_invoice_no" text,
	"po_ref" text,
	"subtotal" numeric(18, 0) NOT NULL,
	"discount" numeric(18, 0) DEFAULT '0' NOT NULL,
	"total" numeric(18, 0) NOT NULL,
	"paid_amount" numeric(18, 0) DEFAULT '0' NOT NULL,
	"received_by" uuid,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_code_unique" UNIQUE("code")
);
CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"return_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	CONSTRAINT "purchase_return_items_qty_pos" CHECK ("purchase_return_items"."qty" > 0)
);
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"goods_receipt_id" uuid,
	"status" "doc_status" DEFAULT 'completed' NOT NULL,
	"returned_at" timestamp with time zone NOT NULL,
	"total" numeric(18, 0) NOT NULL,
	"settlement" "return_settlement" DEFAULT 'offset_debt' NOT NULL,
	"refund_account_id" uuid,
	"reason" text,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_code_unique" UNIQUE("code")
);
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "cash_account_type" NOT NULL,
	"branch_id" uuid,
	"opening_balance" numeric(18, 0) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "cash_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"amount" numeric(18, 0) NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"party_type" "party_type",
	"party_id" uuid,
	"party_name" text,
	"vehicle_ref" text,
	"ref_type" text,
	"ref_id" uuid,
	"status" "doc_status" DEFAULT 'completed' NOT NULL,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_transactions_code_unique" UNIQUE("code"),
	CONSTRAINT "cash_transactions_amount_pos" CHECK ("cash_transactions"."amount" > 0)
);
CREATE TABLE "debt_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_type" "party_type" NOT NULL,
	"party_id" uuid NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"ref_code" text,
	"amount" numeric(18, 0) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "debt_ledger_nonzero" CHECK ("debt_ledger"."amount" <> 0)
);
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cash_transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(18, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_pos" CHECK ("payment_allocations"."amount" > 0)
);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "users" ADD CONSTRAINT "users_default_branch_id_branches_id_fk" FOREIGN KEY ("default_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "customer_invoice_profiles" ADD CONSTRAINT "customer_invoice_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_owner_id_users_id_fk" FOREIGN KEY ("sales_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "customers" ADD CONSTRAINT "customers_default_price_book_id_price_books_id_fk" FOREIGN KEY ("default_price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stocks" ADD CONSTRAINT "stocks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stocks" ADD CONSTRAINT "stocks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_account_id_cash_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_cash_transaction_id_cash_transactions_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "public"."cash_transactions"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_root_invoice_id_invoices_id_fk" FOREIGN KEY ("root_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "orders" ADD CONSTRAINT "orders_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_refund_account_id_cash_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_refund_account_id_cash_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_category_id_cash_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cash_categories"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_account_id_cash_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "debt_ledger" ADD CONSTRAINT "debt_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_cash_transaction_id_cash_transactions_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "public"."cash_transactions"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");CREATE UNIQUE INDEX "branches_one_default" ON "branches" USING btree ("is_default") WHERE "branches"."is_default";CREATE UNIQUE INDEX "idempotency_user_key_uq" ON "idempotency_keys" USING btree ("user_id","key");CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");CREATE INDEX "users_role_idx" ON "users" USING btree ("role");CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");CREATE INDEX "price_book_items_product_idx" ON "price_book_items" USING btree ("product_id");CREATE UNIQUE INDEX "price_books_one_default" ON "price_books" USING btree ("is_default") WHERE "price_books"."is_default";CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");CREATE INDEX "products_name_idx" ON "products" USING btree ("name");CREATE INDEX "products_active_idx" ON "products" USING btree ("is_active");CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");CREATE INDEX "customers_sales_owner_idx" ON "customers" USING btree ("sales_owner_id");CREATE INDEX "customers_price_book_idx" ON "customers" USING btree ("default_price_book_id");CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");CREATE INDEX "suppliers_kind_idx" ON "suppliers" USING btree ("kind");CREATE INDEX "stock_movements_product_time_idx" ON "stock_movements" USING btree ("product_id","occurred_at");CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");CREATE INDEX "invoice_items_product_idx" ON "invoice_items" USING btree ("product_id");CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id","invoiced_at");CREATE INDEX "invoices_time_idx" ON "invoices" USING btree ("invoiced_at");CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");CREATE UNIQUE INDEX "invoices_root_rev_uq" ON "invoices" USING btree ("root_invoice_id","revision_no");CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","ordered_at");CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");CREATE INDEX "sales_return_items_return_idx" ON "sales_return_items" USING btree ("return_id");CREATE INDEX "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer_id","returned_at");CREATE INDEX "sales_returns_invoice_idx" ON "sales_returns" USING btree ("invoice_id");CREATE INDEX "goods_receipt_items_receipt_idx" ON "goods_receipt_items" USING btree ("receipt_id");CREATE INDEX "goods_receipt_items_product_idx" ON "goods_receipt_items" USING btree ("product_id");CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id","received_at");CREATE INDEX "goods_receipts_time_idx" ON "goods_receipts" USING btree ("received_at");CREATE INDEX "purchase_return_items_return_idx" ON "purchase_return_items" USING btree ("return_id");CREATE INDEX "purchase_returns_supplier_idx" ON "purchase_returns" USING btree ("supplier_id","returned_at");CREATE INDEX "cash_transactions_time_idx" ON "cash_transactions" USING btree ("occurred_at");CREATE INDEX "cash_transactions_party_idx" ON "cash_transactions" USING btree ("party_type","party_id");CREATE INDEX "cash_transactions_account_idx" ON "cash_transactions" USING btree ("account_id","occurred_at");CREATE INDEX "debt_ledger_party_idx" ON "debt_ledger" USING btree ("party_type","party_id","occurred_at");CREATE INDEX "debt_ledger_ref_idx" ON "debt_ledger" USING btree ("ref_type","ref_id");CREATE UNIQUE INDEX "payment_allocations_uq" ON "payment_allocations" USING btree ("cash_transaction_id","invoice_id");CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");
-- ===== 0001_vai_tro_7.sql =====
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;DROP TYPE "public"."user_role";CREATE TYPE "public"."user_role" AS ENUM('manager', 'assistant', 'accountant', 'warehouse', 'driver', 'sales', 'marketing');ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";
-- ===== 0002_tim_khong_dau.sql =====
-- Tìm kiếm không phân biệt dấu / hoa thường (tiếng Việt).
-- unaccent() chỉ là STABLE nên không dùng được trong chỉ mục; bọc lại thành hàm IMMUTABLE.
CREATE EXTENSION IF NOT EXISTS unaccent;CREATE EXTENSION IF NOT EXISTS pg_trgm;CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;-- Chuẩn hóa chuỗi để so khớp: bỏ dấu + chữ thường. "Đèn Lồng" -> "den long".
CREATE OR REPLACE FUNCTION f_search_text(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.f_unaccent($1)) $$;

-- ===== 0003_chi_muc_tim_kiem.sql =====
DROP INDEX "products_name_idx";DROP INDEX "customers_name_idx";DROP INDEX "suppliers_name_idx";CREATE INDEX "products_search_trgm" ON "products" USING gin (f_search_text("code" || ' ' || "name") gin_trgm_ops);CREATE INDEX "customers_search_trgm" ON "customers" USING gin (f_search_text("code" || ' ' || "name" || ' ' || coalesce("phone", '')) gin_trgm_ops);CREATE INDEX "suppliers_search_trgm" ON "suppliers" USING gin (f_search_text("code" || ' ' || "name" || ' ' || coalesce("phone", '')) gin_trgm_ops);
-- ===== 0004_phan_quyen_theo_vai_tro.sql =====
CREATE TYPE "public"."permission_scope" AS ENUM('all', 'own');CREATE TABLE "role_permissions" (
	"role" "user_role" NOT NULL,
	"permission_code" text NOT NULL,
	"scope" "permission_scope" DEFAULT 'all' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role");
-- ===== 0005_seed_nen.sql =====
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;ALTER TABLE "cash_categories" ADD COLUMN "code" text;ALTER TABLE "cash_categories" ADD CONSTRAINT "cash_categories_code_unique" UNIQUE("code");
-- ===== 0006_nhieu_chi_nhanh.sql =====
CREATE TYPE "public"."shipping_payer" AS ENUM('sender', 'receiver');CREATE TYPE "public"."transfer_status" AS ENUM('in_transit', 'received', 'cancelled');ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'transfer';ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_out';ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_in';ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_cancel';CREATE TABLE "user_branches" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
CREATE TABLE "customer_branch_terms" (
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"credit_limit" numeric(18, 0),
	"payment_term_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_branch_terms_customer_id_branch_id_pk" PRIMARY KEY("customer_id","branch_id")
);
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost_sent" numeric(18, 4) NOT NULL,
	"shipping_share" numeric(18, 0) DEFAULT '0' NOT NULL,
	"unit_cost_received" numeric(18, 4),
	CONSTRAINT "stock_transfer_items_qty_pos" CHECK ("stock_transfer_items"."qty" > 0)
);
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'in_transit' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"goods_value" numeric(18, 0) NOT NULL,
	"shipping_fee" numeric(18, 0) DEFAULT '0' NOT NULL,
	"shipping_paid_by" "shipping_payer" DEFAULT 'sender' NOT NULL,
	"debt_amount" numeric(18, 0),
	"note" text,
	"created_by" uuid,
	"received_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_transfers_branches_differ" CHECK ("stock_transfers"."from_branch_id" <> "stock_transfers"."to_branch_id"),
	CONSTRAINT "stock_transfers_fee_nonneg" CHECK ("stock_transfers"."shipping_fee" >= 0)
);
DROP INDEX "price_book_items_product_idx";DROP INDEX "debt_ledger_party_idx";ALTER TABLE "price_book_items" ADD COLUMN "branch_id" uuid NOT NULL;ALTER TABLE "price_book_items" DROP CONSTRAINT "price_book_items_price_book_id_product_id_pk";ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_price_book_id_branch_id_product_id_pk" PRIMARY KEY("price_book_id","branch_id","product_id");ALTER TABLE "customers" ADD COLUMN "linked_branch_id" uuid;ALTER TABLE "suppliers" ADD COLUMN "linked_branch_id" uuid;ALTER TABLE "stocks" ADD COLUMN "cost_price" numeric(18, 4) DEFAULT '0' NOT NULL;ALTER TABLE "stocks" ADD COLUMN "last_purchase_price" numeric(18, 4);ALTER TABLE "stocks" ADD COLUMN "min_stock" numeric(14, 3);ALTER TABLE "stocks" ADD COLUMN "max_stock" numeric(14, 3);ALTER TABLE "stocks" ADD COLUMN "location" text;ALTER TABLE "debt_ledger" ADD COLUMN "branch_id" uuid NOT NULL;ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;CREATE INDEX "user_branches_branch_idx" ON "user_branches" USING btree ("branch_id");CREATE INDEX "stock_transfer_items_transfer_idx" ON "stock_transfer_items" USING btree ("transfer_id");CREATE INDEX "stock_transfer_items_product_idx" ON "stock_transfer_items" USING btree ("product_id");CREATE INDEX "stock_transfers_from_idx" ON "stock_transfers" USING btree ("from_branch_id","sent_at");CREATE INDEX "stock_transfers_to_idx" ON "stock_transfers" USING btree ("to_branch_id","sent_at");CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers" USING btree ("status");ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_branch_id_branches_id_fk" FOREIGN KEY ("linked_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_linked_branch_id_branches_id_fk" FOREIGN KEY ("linked_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;ALTER TABLE "debt_ledger" ADD CONSTRAINT "debt_ledger_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;CREATE INDEX "price_book_items_branch_product_idx" ON "price_book_items" USING btree ("branch_id","product_id");CREATE INDEX "debt_ledger_branch_idx" ON "debt_ledger" USING btree ("branch_id","occurred_at");CREATE INDEX "debt_ledger_party_idx" ON "debt_ledger" USING btree ("party_type","party_id","branch_id","occurred_at");ALTER TABLE "products" DROP COLUMN "base_price";ALTER TABLE "products" DROP COLUMN "cost_price";ALTER TABLE "products" DROP COLUMN "last_purchase_price";ALTER TABLE "products" DROP COLUMN "min_stock";ALTER TABLE "products" DROP COLUMN "max_stock";ALTER TABLE "products" DROP COLUMN "location";ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_branch_unique" UNIQUE("linked_branch_id");ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_linked_branch_unique" UNIQUE("linked_branch_id");
-- ===== 0007_bo_han_muc_chung.sql =====
ALTER TABLE "customers" DROP COLUMN "credit_limit";ALTER TABLE "customers" DROP COLUMN "payment_term_days";
-- ===== 0008_refresh_token_revoke_reason.sql =====
ALTER TABLE "refresh_tokens" ADD COLUMN "revoke_reason" text;
-- ===== 0009_chi_nhanh_mac_dinh_ha_noi.sql =====
-- Chủ dự án chốt (04/11/2026): chi nhánh mặc định là Hà Nội (trước đó tạm đặt Sài Gòn).
-- Chỉ ảnh hưởng CSDL đã seed; CSDL mới do seed tạo sẵn đúng. Bỏ cờ cũ trước vì chỉ mục duy nhất một chi nhánh mặc định.
UPDATE "branches" SET "is_default" = false WHERE "code" = 'SG' AND "is_default" = true;UPDATE "branches" SET "is_default" = true WHERE "code" = 'HN' AND NOT EXISTS (SELECT 1 FROM "branches" WHERE "is_default" = true);

-- ===== 0010_nha_cung_cap_nhom.sql =====
ALTER TABLE "suppliers" ADD COLUMN "group_name" text;
-- ===== 0011_ten_dang_nhap_khong_phan_biet_hoa_thuong.sql =====
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" USING btree (lower("username"));
-- ===== 0012_so_cai_chi_them.sql =====
-- Sổ cái chỉ-thêm do CSDL ép (không chỉ là quy ước trong mã).
-- stock_movements, debt_ledger: cấm UPDATE, DELETE, TRUNCATE. Muốn điều chỉnh hãy THÊM bút toán đảo.
-- cash_transactions: cấm DELETE, TRUNCATE; UPDATE chỉ cho phép (a) hủy phiếu (completed -> cancelled kèm
--   cancelled_at, cancel_reason) và (b) sửa ghi chú; mọi trường tiền/đối tượng/thời điểm là bất biến, và phiếu đã
--   hủy không sửa nữa.
-- Lưu ý: người có quyền chủ bảng/siêu quản trị vẫn có thể ALTER TABLE ... DISABLE TRIGGER; lớp này chặn mã viết sai
--   và câu SQL sửa tay vô ý, không chặn người cố tình. Mọi lần tắt phải được ghi nhận và có người duyệt.
CREATE FUNCTION "forbid_ledger_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là sổ cái chỉ-thêm: không được % bản ghi. Muốn điều chỉnh hãy thêm bút toán đảo.',
    TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'LG001';
END;
$$;CREATE FUNCTION "guard_cash_transaction_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu quỹ % đã hủy, không được sửa nữa.', OLD.code USING ERRCODE = 'LG001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'cancelled_at', 'cancel_reason', 'note', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'cancelled_at', 'cancel_reason', 'note', 'updated_at']) THEN
    RAISE EXCEPTION 'Phiếu quỹ % chỉ được hủy hoặc sửa ghi chú; không được đổi số tiền, quỹ, danh mục, đối tượng hay thời điểm.', OLD.code
      USING ERRCODE = 'LG001';
  END IF;
  RETURN NEW;
END;
$$;CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();CREATE TRIGGER "debt_ledger_append_only" BEFORE UPDATE OR DELETE ON "debt_ledger" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();CREATE TRIGGER "debt_ledger_no_truncate" BEFORE TRUNCATE ON "debt_ledger" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();CREATE TRIGGER "cash_transactions_no_delete" BEFORE DELETE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();CREATE TRIGGER "cash_transactions_guard_update" BEFORE UPDATE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION "guard_cash_transaction_update"();CREATE TRIGGER "cash_transactions_no_truncate" BEFORE TRUNCATE ON "cash_transactions" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();

-- ===== 0013_nhat_ky_request_id_chi_nhanh.sql =====
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;ALTER TABLE "audit_logs" ADD COLUMN "branch_id" uuid;ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;CREATE INDEX "audit_logs_request_idx" ON "audit_logs" USING btree ("request_id");
-- ===== 0014_nhom_hang_ten_duy_nhat.sql =====
CREATE UNIQUE INDEX "categories_sibling_name_unique" ON "categories" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),f_search_text("name")) WHERE "categories"."deleted_at" is null;
-- ===== 0015_hang_hoa_ma_khong_phan_biet_hoa_thuong.sql =====
CREATE UNIQUE INDEX "products_code_lower_unique" ON "products" USING btree (lower("code"));
-- ===== 0016_mat_khau_doi_luc.sql =====
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;
-- ===== 0017_dang_nhap_google.sql =====
ALTER TYPE "public"."user_role" ADD VALUE 'pending';CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;CREATE UNIQUE INDEX "user_identities_provider_subject_unique" ON "user_identities" USING btree ("provider","provider_subject");CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");
-- ===== 0018_loai_hang_combo.sql =====
CREATE TYPE "public"."product_type" AS ENUM('goods', 'combo');CREATE TABLE "product_components" (
	"combo_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_components_combo_id_component_id_pk" PRIMARY KEY("combo_id","component_id"),
	CONSTRAINT "product_components_qty_positive" CHECK ("product_components"."qty" > 0),
	CONSTRAINT "product_components_not_self" CHECK ("product_components"."combo_id" <> "product_components"."component_id")
);
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_combo_id_products_id_fk" FOREIGN KEY ("combo_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;CREATE INDEX "product_components_component_idx" ON "product_components" USING btree ("component_id");ALTER TABLE "products" DROP COLUMN "unit";ALTER TABLE "products" DROP COLUMN "weight_g";ALTER TABLE "products" DROP COLUMN "is_sellable";ALTER TABLE "invoice_items" DROP COLUMN "unit";ALTER TABLE "products" ADD COLUMN "product_type" "product_type" DEFAULT 'goods' NOT NULL;CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type");

-- ===== 0019_bo_gia_ban.sql =====
ALTER TABLE "price_book_items" DISABLE ROW LEVEL SECURITY;ALTER TABLE "price_books" DISABLE ROW LEVEL SECURITY;DROP TABLE "price_book_items" CASCADE;DROP TABLE "price_books" CASCADE;ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_default_price_book_id_price_books_id_fk";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_price_book_id_price_books_id_fk";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_price_book_id_price_books_id_fk";
DROP INDEX IF EXISTS "customers_price_book_idx";ALTER TABLE "customers" DROP COLUMN "default_price_book_id";ALTER TABLE "invoices" DROP COLUMN "price_book_id";ALTER TABLE "orders" DROP COLUMN "price_book_id";DELETE FROM "role_permissions" WHERE "permission_code" = 'price.edit';

-- ===== 0020_che_do_nhap_excel.sql =====
CREATE TYPE "public"."import_mode" AS ENUM('overwrite', 'add');ALTER TABLE "import_jobs" ADD COLUMN "mode" "import_mode" DEFAULT 'overwrite' NOT NULL;