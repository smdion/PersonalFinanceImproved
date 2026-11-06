-- holding_observations loses performance_account_id: nothing writes it
-- (SimpleFIN ingest is the only writer and sets it null), so every row has a
-- SimpleFIN account. A row that doesn't stops the migration (NOT NULL) and
-- nothing changes. Settings no version of Ledgr reads go. Restore does the
-- same to an older backup (lib/db/v0102-dead-data.ts). Safe to re-run.
ALTER TABLE "holding_observations" DROP CONSTRAINT IF EXISTS "holding_observations_one_account_check";--> statement-breakpoint
ALTER TABLE "holding_observations" DROP CONSTRAINT IF EXISTS "holding_observations_performance_account_id_performance_accounts_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "holding_observations_manual_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "holding_observations_perf_account_idx";--> statement-breakpoint
ALTER TABLE "holding_observations" ALTER COLUMN "simplefin_account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holding_observations" DROP COLUMN IF EXISTS "performance_account_id";--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" IN (
  'dave_ramsey_benchmarks',
  'default_budget_tier_index',
  'include_home_growth_in_networth',
  'lt_brokerage_annual_contribution_increase',
  'match_income_threshold',
  'match_income_threshold_inflation',
  'money_guy_wealth_targets',
  'retirement_target_contribution_rate',
  'use_3yr_salary_average',
  'wealth_score_start_year'
);
