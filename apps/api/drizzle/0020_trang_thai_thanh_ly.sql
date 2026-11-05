CREATE TYPE "public"."liquidation_status" AS ENUM('normal', 'clearance', 'disabled', 'high_stock', 'priority_stock');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "liquidation_status" "liquidation_status" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_liquidation_idx" ON "products" USING btree ("liquidation_status");--> statement-breakpoint
ALTER TABLE "stocks" DROP COLUMN "min_stock";--> statement-breakpoint
ALTER TABLE "stocks" DROP COLUMN "max_stock";--> statement-breakpoint
ALTER TABLE "stocks" DROP COLUMN "location";