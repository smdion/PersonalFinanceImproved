CREATE TABLE IF NOT EXISTS `account_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performance_account_id` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`weight_bps` integer NOT NULL,
	`expense_ratio` text,
	`asset_class_id` integer,
	`asset_class_source` text DEFAULT 'manual' NOT NULL,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `portfolio_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `account_holdings_acct_snap_ticker_idx` ON `account_holdings` (`performance_account_id`,`snapshot_id`,`ticker`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_holdings_perf_acct_idx` ON `account_holdings` (`performance_account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_holdings_snapshot_idx` ON `account_holdings` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_holdings_asset_class_idx` ON `account_holdings` (`asset_class_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pending_rollovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_account_performance_id` integer NOT NULL,
	`destination_performance_account_id` integer NOT NULL,
	`amount` text NOT NULL,
	`sale_date` text NOT NULL,
	`sale_year` integer NOT NULL,
	`apply_year` integer NOT NULL,
	`notes` text,
	`confirmed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_account_performance_id`) REFERENCES `account_performance`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pending_rollovers_source_idx` ON `pending_rollovers` (`source_account_performance_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pending_rollovers_dest_idx` ON `pending_rollovers` (`destination_performance_account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pending_rollovers_sale_year_idx` ON `pending_rollovers` (`sale_year`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pending_rollovers_confirmed_idx` ON `pending_rollovers` (`confirmed_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `extra_paycheck_routing` text;--> statement-breakpoint
ALTER TABLE `savings_allocation_overrides` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `savings_planned_transactions` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `savings_planned_tx_source_idx` ON `savings_planned_transactions` (`source`);
