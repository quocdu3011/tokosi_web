CREATE TYPE "public"."product_type" AS ENUM('goods', 'combo');--> statement-breakpoint
CREATE TABLE "product_components" (
	"combo_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_components_combo_id_component_id_pk" PRIMARY KEY("combo_id","component_id"),
	CONSTRAINT "product_components_qty_positive" CHECK ("product_components"."qty" > 0),
	CONSTRAINT "product_components_not_self" CHECK ("product_components"."combo_id" <> "product_components"."component_id")
);
--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_combo_id_products_id_fk" FOREIGN KEY ("combo_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_components_component_idx" ON "product_components" USING btree ("component_id");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "weight_g";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "is_sellable";--> statement-breakpoint
ALTER TABLE "invoice_items" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_type" "product_type" DEFAULT 'goods' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type");
