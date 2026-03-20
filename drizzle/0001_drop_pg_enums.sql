ALTER TABLE "api_connections" ALTER COLUMN "last_synced_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brokerage_goals" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brokerage_goals" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "budget_api_cache" ALTER COLUMN "service" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "budget_api_cache" ALTER COLUMN "fetched_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_api_cache" ALTER COLUMN "fetched_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "budget_items" ALTER COLUMN "api_last_synced_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_items" ALTER COLUMN "api_sync_direction" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "budget_items" ALTER COLUMN "api_sync_direction" SET DEFAULT 'pull';--> statement-breakpoint
ALTER TABLE "budget_profiles" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_profiles" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "change_log" ALTER COLUMN "changed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "change_log" ALTER COLUMN "changed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "tax_treatment" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "contribution_method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "employer_match_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "employer_match_tax_treatment" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "employer_match_tax_treatment" SET DEFAULT 'pre_tax';--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "hsa_coverage_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "ownership" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "ownership" SET DEFAULT 'individual';--> statement-breakpoint
ALTER TABLE "contribution_profiles" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contribution_profiles" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "pay_period" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "pay_week" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "w4_filing_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "performance_accounts" ALTER COLUMN "ownership_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "performance_accounts" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "performance_accounts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ALTER COLUMN "tax_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "relocation_scenarios" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relocation_scenarios" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "relocation_scenarios" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relocation_scenarios" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "state_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "state_versions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tax_brackets" ALTER COLUMN "filing_status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."account_ownership_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."api_sync_direction_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."budget_api_service_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."contribution_method_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employer_match_type_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."hsa_coverage_type_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."match_tax_treatment_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."pay_period_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."pay_week_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."portfolio_tax_type_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tax_treatment_enum" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."w4_filing_status_enum" CASCADE;