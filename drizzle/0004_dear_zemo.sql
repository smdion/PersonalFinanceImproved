CREATE TABLE "simplefin_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_account_id" text NOT NULL,
	"org_name" text NOT NULL,
	"account_name" text NOT NULL,
	"last_balance" numeric(14, 2) NOT NULL,
	"is_included" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simplefin_accounts_external_account_id_unique" UNIQUE("external_account_id")
);
--> statement-breakpoint
CREATE INDEX "simplefin_accounts_org_name_idx" ON "simplefin_accounts" USING btree ("org_name","account_name");