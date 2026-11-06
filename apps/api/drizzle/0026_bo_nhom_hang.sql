-- Bỏ phân nhóm hàng hóa; giữ nguyên sản phẩm và chứng từ.
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_categories_id_fk";
--> statement-breakpoint
DROP INDEX "products_category_idx";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "category_id";
--> statement-breakpoint
DROP TABLE "categories";
