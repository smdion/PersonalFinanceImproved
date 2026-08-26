CREATE TABLE "roth_basis" (
	"id" serial PRIMARY KEY NOT NULL,
	"performance_account_id" integer NOT NULL,
	"owner_person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"contribution_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"conversion_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"latest_conversion_year" integer,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "performance_accounts" ADD COLUMN "separation_date" date;--> statement-breakpoint
ALTER TABLE "roth_basis" ADD CONSTRAINT "roth_basis_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roth_basis" ADD CONSTRAINT "roth_basis_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roth_basis_account_owner_year_idx" ON "roth_basis" USING btree ("performance_account_id","owner_person_id","year");--> statement-breakpoint
CREATE INDEX "roth_basis_owner_person_id_idx" ON "roth_basis" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "roth_basis_year_idx" ON "roth_basis" USING btree ("year");
