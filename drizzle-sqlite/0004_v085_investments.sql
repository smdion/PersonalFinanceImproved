CREATE TABLE `asset_class_buckets` (
	`bucket` text PRIMARY KEY NOT NULL,
	`asset_class_id` integer NOT NULL,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_class_buckets_class_idx` ON `asset_class_buckets` (`asset_class_id`);--> statement-breakpoint
CREATE TABLE `holding_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simplefin_account_id` integer,
	`performance_account_id` integer,
	`security_id` integer NOT NULL,
	`balance_date` integer,
	`as_of` text NOT NULL,
	`shares` text NOT NULL,
	`reported_market_value` text,
	`avg_cost_per_share` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simplefin_account_id`) REFERENCES `simplefin_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_simplefin_idx` ON `holding_observations` (`simplefin_account_id`,`security_id`,`as_of`) WHERE "holding_observations"."simplefin_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_manual_idx` ON `holding_observations` (`performance_account_id`,`security_id`,`as_of`) WHERE "holding_observations"."performance_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `holding_observations_security_idx` ON `holding_observations` (`security_id`);--> statement-breakpoint
CREATE INDEX `holding_observations_perf_account_idx` ON `holding_observations` (`performance_account_id`);--> statement-breakpoint
CREATE TABLE `investment_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simplefin_account_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`posted` text NOT NULL,
	`transacted` text,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	`kind_override` text,
	`voided_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simplefin_account_id`) REFERENCES `simplefin_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_transactions_external_idx` ON `investment_transactions` (`simplefin_account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `investment_transactions_account_posted_idx` ON `investment_transactions` (`simplefin_account_id`,`posted`);--> statement-breakpoint
CREATE TABLE `sec_filing_cache` (
	`accession` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`period_end` text NOT NULL,
	`us_equity_pct` text,
	`intl_equity_pct` text,
	`us_bond_pct` text,
	`intl_bond_pct` text,
	`tips_pct` text,
	`cash_pct` text,
	`other_pct` text,
	`coverage` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sec_filing_cache_series_idx` ON `sec_filing_cache` (`series_id`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text,
	`source_symbol` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`institution` text,
	`source_description` text,
	`sec_series_id` text,
	`sec_class_id` text,
	`facts_series_id` text,
	`facts_class_id` text,
	`facts_series_name` text,
	`facts_basis` text,
	`standin_confirmed_at` integer,
	`standin_preview` text,
	`facts_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_ticker_idx` ON `securities` (`ticker`) WHERE "securities"."ticker" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `securities_untickered_identity_idx` ON `securities` (`institution`,`source_description`) WHERE "securities"."ticker" IS NULL;--> statement-breakpoint
CREATE TABLE `security_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`security_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`sec_series_id` text,
	`accession` text,
	`expense_ratio` text,
	`us_equity_pct` text,
	`intl_equity_pct` text,
	`us_bond_pct` text,
	`intl_bond_pct` text,
	`tips_pct` text,
	`cash_pct` text,
	`other_pct` text,
	`coverage` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_facts_identity_idx` ON `security_facts` (`security_id`,`source`,`as_of`);--> statement-breakpoint
CREATE INDEX `security_facts_security_idx` ON `security_facts` (`security_id`);--> statement-breakpoint
CREATE TABLE `simplefin_account_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simplefin_account_id` integer NOT NULL,
	`balance_date` integer NOT NULL,
	`balance` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simplefin_account_id`) REFERENCES `simplefin_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simplefin_account_balances_account_date_idx` ON `simplefin_account_balances` (`simplefin_account_id`,`balance_date`);--> statement-breakpoint
CREATE TABLE `sync_request_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`endpoint` text NOT NULL,
	`http_status` integer,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_request_log_service_requested_idx` ON `sync_request_log` (`service`,`requested_at`);--> statement-breakpoint
ALTER TABLE `simplefin_accounts` ADD `last_balance_date` integer;--> statement-breakpoint
ALTER TABLE `simplefin_accounts` ADD `linked_sub_key` text;--> statement-breakpoint
-- Best-effort: link the standard asset class names to the fund categories
-- they receive (only when nothing is linked yet). Households with other
-- names link them on the Benchmarks page.
INSERT OR IGNORE INTO `asset_class_buckets` (`bucket`, `asset_class_id`)
SELECT CASE `name` WHEN 'US Equities' THEN 'us_equity' WHEN 'International Equities' THEN 'intl_equity' WHEN 'US Bonds' THEN 'us_bond' WHEN 'International Bonds' THEN 'intl_bond' WHEN 'TIPS' THEN 'tips' WHEN 'Cash' THEN 'cash' END, `id`
FROM `asset_class_params`
WHERE `name` IN ('US Equities', 'International Equities', 'US Bonds', 'International Bonds', 'TIPS', 'Cash')
  AND NOT EXISTS (SELECT 1 FROM `asset_class_buckets`);
