CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 0) NOT NULL,
	CONSTRAINT "purchase_order_items_qty_pos" CHECK ("purchase_order_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"ordered_by" uuid,
	"total" numeric(18, 0) NOT NULL,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD COLUMN "returned_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_ordered_by_users_id_fk" FOREIGN KEY ("ordered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_product_idx" ON "purchase_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","ordered_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_branch_idx" ON "purchase_orders" USING btree ("branch_id","ordered_at");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("purchase_order_id");
--> statement-breakpoint
ALTER TABLE "purchase_returns" DROP CONSTRAINT "purchase_returns_refund_account_id_cash_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "supplier_invoice_no";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "po_ref";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "subtotal";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "discount";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "paid_amount";--> statement-breakpoint
ALTER TABLE "purchase_returns" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "purchase_returns" DROP COLUMN "settlement";--> statement-breakpoint
ALTER TABLE "purchase_returns" DROP COLUMN "refund_account_id";
