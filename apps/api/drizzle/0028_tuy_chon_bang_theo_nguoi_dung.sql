CREATE TABLE "user_table_prefs" (
	"user_id" uuid NOT NULL,
	"table_key" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_table_prefs_user_id_table_key_pk" PRIMARY KEY("user_id","table_key")
);
--> statement-breakpoint
ALTER TABLE "user_table_prefs" ADD CONSTRAINT "user_table_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;