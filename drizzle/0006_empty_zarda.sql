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
ALTER TABLE "asset_class_params" ADD COLUMN "composition_bucket" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sec_series_id" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sec_class_id" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "facts_series_id" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "facts_class_id" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "facts_series_name" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "facts_basis" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "standin_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "facts_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "security_facts" ADD CONSTRAINT "security_facts_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sec_filing_cache_series_idx" ON "sec_filing_cache" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_facts_identity_idx" ON "security_facts" USING btree ("security_id","source","as_of");--> statement-breakpoint
CREATE INDEX "security_facts_security_idx" ON "security_facts" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_class_params_composition_bucket_idx" ON "asset_class_params" USING btree ("composition_bucket") WHERE "asset_class_params"."composition_bucket" IS NOT NULL;--> statement-breakpoint
-- Best-effort: link the standard asset class names to composition buckets.
-- Households with other names link them on the Benchmarks page.
UPDATE "asset_class_params" SET "composition_bucket" = CASE "name" WHEN 'US Equities' THEN 'us_equity' WHEN 'International Equities' THEN 'intl_equity' WHEN 'US Bonds' THEN 'us_bond' WHEN 'International Bonds' THEN 'intl_bond' WHEN 'TIPS' THEN 'tips' WHEN 'Cash' THEN 'cash' END WHERE "composition_bucket" IS NULL AND "name" IN ('US Equities', 'International Equities', 'US Bonds', 'International Bonds', 'TIPS', 'Cash');