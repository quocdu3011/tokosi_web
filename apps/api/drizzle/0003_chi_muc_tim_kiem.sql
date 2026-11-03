DROP INDEX "products_name_idx";--> statement-breakpoint
DROP INDEX "customers_name_idx";--> statement-breakpoint
DROP INDEX "suppliers_name_idx";--> statement-breakpoint
CREATE INDEX "products_search_trgm" ON "products" USING gin (f_search_text("code" || ' ' || "name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_search_trgm" ON "customers" USING gin (f_search_text("code" || ' ' || "name" || ' ' || coalesce("phone", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "suppliers_search_trgm" ON "suppliers" USING gin (f_search_text("code" || ' ' || "name" || ' ' || coalesce("phone", '')) gin_trgm_ops);