ALTER TABLE "customers" DROP CONSTRAINT "customers_phone_unique";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "warnings" jsonb;--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_lower_unique" ON "customers" USING btree (lower("code"));--> statement-breakpoint
-- Khách hàng: mọi nhân viên xem được khách của người khác (bỏ phạm vi "chỉ của mình" ở customer.view)
UPDATE "role_permissions" SET "scope" = 'all' WHERE "permission_code" = 'customer.view';
