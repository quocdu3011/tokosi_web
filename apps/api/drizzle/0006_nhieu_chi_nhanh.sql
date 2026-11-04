CREATE TYPE "public"."shipping_payer" AS ENUM('sender', 'receiver');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('in_transit', 'received', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'transfer';--> statement-breakpoint
ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_out';--> statement-breakpoint
ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_in';--> statement-breakpoint
ALTER TYPE "public"."stock_ref_type" ADD VALUE 'transfer_cancel';--> statement-breakpoint
CREATE TABLE "user_branches" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "customer_branch_terms" (
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"credit_limit" numeric(18, 0),
	"payment_term_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_branch_terms_customer_id_branch_id_pk" PRIMARY KEY("customer_id","branch_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
DROP INDEX "price_book_items_product_idx";--> statement-breakpoint
DROP INDEX "debt_ledger_party_idx";--> statement-breakpoint
ALTER TABLE "price_book_items" ADD COLUMN "branch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "price_book_items" DROP CONSTRAINT "price_book_items_price_book_id_product_id_pk";--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_price_book_id_branch_id_product_id_pk" PRIMARY KEY("price_book_id","branch_id","product_id");--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "linked_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "linked_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "cost_price" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "last_purchase_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "min_stock" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "max_stock" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "debt_ledger" ADD COLUMN "branch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_branches_branch_idx" ON "user_branches" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_items_transfer_idx" ON "stock_transfer_items" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_items_product_idx" ON "stock_transfer_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_from_idx" ON "stock_transfers" USING btree ("from_branch_id","sent_at");--> statement-breakpoint
CREATE INDEX "stock_transfers_to_idx" ON "stock_transfers" USING btree ("to_branch_id","sent_at");--> statement-breakpoint
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers" USING btree ("status");--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_branch_id_branches_id_fk" FOREIGN KEY ("linked_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_linked_branch_id_branches_id_fk" FOREIGN KEY ("linked_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_ledger" ADD CONSTRAINT "debt_ledger_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_book_items_branch_product_idx" ON "price_book_items" USING btree ("branch_id","product_id");--> statement-breakpoint
CREATE INDEX "debt_ledger_branch_idx" ON "debt_ledger" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "debt_ledger_party_idx" ON "debt_ledger" USING btree ("party_type","party_id","branch_id","occurred_at");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "base_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "cost_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "last_purchase_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "min_stock";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "max_stock";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "location";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_branch_unique" UNIQUE("linked_branch_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_linked_branch_unique" UNIQUE("linked_branch_id");