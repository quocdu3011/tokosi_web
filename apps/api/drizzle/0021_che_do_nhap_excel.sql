CREATE TYPE "public"."import_mode" AS ENUM('overwrite', 'add');--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "mode" "import_mode" DEFAULT 'overwrite' NOT NULL;