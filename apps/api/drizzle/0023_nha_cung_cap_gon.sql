DROP INDEX "suppliers_kind_idx";--> statement-breakpoint
DROP INDEX "suppliers_search_trgm";--> statement-breakpoint
CREATE INDEX "suppliers_search_trgm" ON "suppliers" USING gin (f_search_text("code" || ' ' || "name" || ' ' || coalesce("group_name", '')) gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "tax_code";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "note";--> statement-breakpoint
DROP TYPE "public"."supplier_kind";
--> statement-breakpoint
CREATE TABLE "supplier_branch_history" (
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"purchase_total" numeric(18, 0) DEFAULT '0' NOT NULL,
	"purchase_net" numeric(18, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "supplier_branch_history_supplier_id_branch_id_pk" PRIMARY KEY("supplier_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_branch_history" ADD CONSTRAINT "supplier_branch_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_branch_history" ADD CONSTRAINT "supplier_branch_history_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
