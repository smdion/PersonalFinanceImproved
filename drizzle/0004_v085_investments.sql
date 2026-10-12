CREATE TABLE "asset_class_buckets" (
	"bucket" text PRIMARY KEY NOT NULL,
	"asset_class_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer,
	"performance_account_id" integer,
	"security_id" integer NOT NULL,
	"balance_date" timestamp with time zone,
	"as_of" date NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"reported_market_value" numeric(14, 2),
	"avg_cost_per_share" numeric(20, 8),
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_observations_one_account_check" CHECK (("holding_observations"."simplefin_account_id" IS NULL) <> ("holding_observations"."performance_account_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"posted" date NOT NULL,
	"transacted" date,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"kind_override" text,
	"voided_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_filing_cache" (
	"accession" text PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"period_end" date NOT NULL,
	"us_equity_pct" numeric(12, 6),
	"intl_equity_pct" numeric(12, 6),
	"us_bond_pct" numeric(12, 6),
	"intl_bond_pct" numeric(12, 6),
	"tips_pct" numeric(12, 6),
	"cash_pct" numeric(12, 6),
	"other_pct" numeric(12, 6),
	"coverage" numeric(12, 6),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text,
	"source_symbol" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"institution" text,
	"source_description" text,
	"sec_series_id" text,
	"sec_class_id" text,
	"facts_series_id" text,
	"facts_class_id" text,
	"facts_series_name" text,
	"facts_basis" text,
	"standin_confirmed_at" timestamp with time zone,
	"standin_preview" jsonb,
	"facts_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"security_id" integer NOT NULL,
	"as_of" date NOT NULL,
	"source" text NOT NULL,
	"sec_series_id" text,
	"accession" text,
	"expense_ratio" numeric(12, 6),
	"us_equity_pct" numeric(12, 6),
	"intl_equity_pct" numeric(12, 6),
	"us_bond_pct" numeric(12, 6),
	"intl_bond_pct" numeric(12, 6),
	"tips_pct" numeric(12, 6),
	"cash_pct" numeric(12, 6),
	"other_pct" numeric(12, 6),
	"coverage" numeric(12, 6),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_facts_fraction_check" CHECK (("security_facts"."expense_ratio" IS NULL OR ("security_facts"."expense_ratio" >= 0 AND "security_facts"."expense_ratio" < 1))
        AND ("security_facts"."coverage" IS NULL OR ("security_facts"."coverage" >= 0 AND "security_facts"."coverage" <= 1)))
);
--> statement-breakpoint
CREATE TABLE "simplefin_account_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer NOT NULL,
	"balance_date" timestamp with time zone NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_request_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint" text NOT NULL,
	"http_status" integer,
	"outcome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simplefin_accounts" ADD COLUMN "last_balance_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "simplefin_accounts" ADD COLUMN "linked_sub_key" text;--> statement-breakpoint
ALTER TABLE "asset_class_buckets" ADD CONSTRAINT "asset_class_buckets_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_facts" ADD CONSTRAINT "security_facts_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_account_balances" ADD CONSTRAINT "simplefin_account_balances_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_class_buckets_class_idx" ON "asset_class_buckets" USING btree ("asset_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holding_observations_simplefin_idx" ON "holding_observations" USING btree ("simplefin_account_id","security_id","as_of") WHERE "holding_observations"."simplefin_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_observations_manual_idx" ON "holding_observations" USING btree ("performance_account_id","security_id","as_of") WHERE "holding_observations"."performance_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "holding_observations_security_idx" ON "holding_observations" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "holding_observations_perf_account_idx" ON "holding_observations" USING btree ("performance_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_transactions_external_idx" ON "investment_transactions" USING btree ("simplefin_account_id","external_id");--> statement-breakpoint
CREATE INDEX "investment_transactions_account_posted_idx" ON "investment_transactions" USING btree ("simplefin_account_id","posted");--> statement-breakpoint
CREATE INDEX "sec_filing_cache_series_idx" ON "sec_filing_cache" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_ticker_idx" ON "securities" USING btree ("ticker") WHERE "securities"."ticker" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "securities_untickered_identity_idx" ON "securities" USING btree ("institution","source_description") WHERE "securities"."ticker" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "security_facts_identity_idx" ON "security_facts" USING btree ("security_id","source","as_of");--> statement-breakpoint
CREATE INDEX "security_facts_security_idx" ON "security_facts" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "simplefin_account_balances_account_date_idx" ON "simplefin_account_balances" USING btree ("simplefin_account_id","balance_date");--> statement-breakpoint
CREATE INDEX "sync_request_log_service_requested_idx" ON "sync_request_log" USING btree ("service","requested_at");--> statement-breakpoint
-- Best-effort: link the standard asset class names to the fund categories
-- they receive (only when nothing is linked yet). Households with other
-- names link them on the Benchmarks page.
INSERT INTO "asset_class_buckets" ("bucket", "asset_class_id")
SELECT CASE "name" WHEN 'US Equities' THEN 'us_equity' WHEN 'International Equities' THEN 'intl_equity' WHEN 'US Bonds' THEN 'us_bond' WHEN 'International Bonds' THEN 'intl_bond' WHEN 'TIPS' THEN 'tips' WHEN 'Cash' THEN 'cash' END, "id"
FROM "asset_class_params"
WHERE "name" IN ('US Equities', 'International Equities', 'US Bonds', 'International Bonds', 'TIPS', 'Cash')
  AND NOT EXISTS (SELECT 1 FROM "asset_class_buckets")
ON CONFLICT ("bucket") DO NOTHING;
--> statement-breakpoint
-- Installs that ran pre-release v0.8.5 builds: drop what the release no
-- longer has (no-op everywhere else). A transaction kind a household fixed
-- by hand goes back to the built-in rules first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'investment_transactions' AND column_name = 'kind_override_source') THEN
    UPDATE "investment_transactions" SET "kind_override" = NULL WHERE "kind_override_source" = 'user';
    ALTER TABLE "investment_transactions" DROP COLUMN "kind_override_source";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "investment_transactions" DROP COLUMN IF EXISTS "source_split";
--> statement-breakpoint
DROP TABLE IF EXISTS "investment_transaction_rules";
--> statement-breakpoint
DROP INDEX IF EXISTS "asset_class_params_composition_bucket_idx";
--> statement-breakpoint
ALTER TABLE "asset_class_params" DROP COLUMN IF EXISTS "composition_bucket";
