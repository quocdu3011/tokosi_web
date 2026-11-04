ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_categories" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "cash_categories" ADD CONSTRAINT "cash_categories_code_unique" UNIQUE("code");