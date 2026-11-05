ALTER TABLE "price_book_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_books" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "price_book_items" CASCADE;--> statement-breakpoint
DROP TABLE "price_books" CASCADE;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_default_price_book_id_price_books_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_price_book_id_price_books_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_price_book_id_price_books_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "customers_price_book_idx";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "default_price_book_id";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "price_book_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "price_book_id";--> statement-breakpoint
DELETE FROM "role_permissions" WHERE "permission_code" = 'price.edit';
