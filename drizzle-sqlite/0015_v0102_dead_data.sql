-- holding_observations loses performance_account_id: nothing writes it
-- (SimpleFIN ingest is the only writer and sets it null), so every row has a
-- SimpleFIN account. A row that doesn't stops the migration (NOT NULL) and
-- nothing changes. Settings no version of Ledgr reads go. Restore does the
-- same to an older backup (lib/db/v0102-dead-data.ts). Safe to re-run.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_holding_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simplefin_account_id` integer NOT NULL,
	`security_id` integer NOT NULL,
	`balance_date` integer,
	`as_of` text NOT NULL,
	`shares` text NOT NULL,
	`reported_market_value` text,
	`avg_cost_per_share` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simplefin_account_id`) REFERENCES `simplefin_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_holding_observations`("id", "simplefin_account_id", "security_id", "balance_date", "as_of", "shares", "reported_market_value", "avg_cost_per_share", "source", "created_at") SELECT "id", "simplefin_account_id", "security_id", "balance_date", "as_of", "shares", "reported_market_value", "avg_cost_per_share", "source", "created_at" FROM `holding_observations`;--> statement-breakpoint
DROP TABLE `holding_observations`;--> statement-breakpoint
ALTER TABLE `__new_holding_observations` RENAME TO `holding_observations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_simplefin_report_idx` ON `holding_observations` (`simplefin_account_id`,`security_id`,`balance_date`) WHERE "holding_observations"."simplefin_account_id" IS NOT NULL AND "holding_observations"."balance_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_simplefin_idx` ON `holding_observations` (`simplefin_account_id`,`security_id`,`as_of`) WHERE "holding_observations"."simplefin_account_id" IS NOT NULL AND "holding_observations"."balance_date" IS NULL;--> statement-breakpoint
CREATE INDEX `holding_observations_security_idx` ON `holding_observations` (`security_id`);--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` IN (
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
