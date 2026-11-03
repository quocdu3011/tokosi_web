CREATE TYPE "public"."permission_scope" AS ENUM('all', 'own');--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "user_role" NOT NULL,
	"permission_code" text NOT NULL,
	"scope" "permission_scope" DEFAULT 'all' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role");