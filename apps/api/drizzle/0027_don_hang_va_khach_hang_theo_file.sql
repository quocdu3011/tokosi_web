ALTER TABLE "customer_invoice_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "customer_invoice_profiles" CASCADE;--> statement-breakpoint
ALTER TABLE "sales_returns" DROP CONSTRAINT "sales_returns_refund_account_id_cash_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "facebook";--> statement-breakpoint
ALTER TABLE "invoice_items" DROP COLUMN "list_price";--> statement-breakpoint
ALTER TABLE "invoice_items" DROP COLUMN "is_gift";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "ship_name";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "ship_phone";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "ship_address";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "list_price";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "is_gift";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "deposit_amount";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "package_count";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "weight_g";--> statement-breakpoint
ALTER TABLE "sales_returns" DROP COLUMN "settlement";--> statement-breakpoint
ALTER TABLE "sales_returns" DROP COLUMN "refund_account_id";--> statement-breakpoint
DROP TYPE "public"."customer_type";--> statement-breakpoint
DROP TYPE "public"."return_settlement";--> statement-breakpoint
CREATE TYPE "public"."customer_price_level" AS ENUM('new', 'medium', 'large', 'vip');--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"warehouse_location" text,
	"warehouse_count" integer,
	"warehouse_area" text,
	"warehouse_photo_url" text,
	"competitors" text,
	"sales_methods" text[],
	"scale" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"visited_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "price_level" "customer_price_level" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "new_since" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "acquisition_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_address" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_visits_uq" ON "customer_visits" USING btree ("customer_id","visited_on");

ALTER TABLE "sales_return_items" RENAME COLUMN "restock_cost" TO "restock_price";--> statement-breakpoint
ALTER TABLE "sales_return_items" RENAME COLUMN "reason" TO "note";--> statement-breakpoint
DELETE FROM "role_permissions" WHERE "permission_code" = 'price.override';
