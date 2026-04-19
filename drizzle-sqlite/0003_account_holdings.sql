CREATE TABLE `account_holdings` (
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
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK("weight_bps" >= 0 AND "weight_bps" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_holdings_acct_snap_ticker_idx` ON `account_holdings` (`performance_account_id`,`snapshot_id`,`ticker`);
--> statement-breakpoint
CREATE INDEX `account_holdings_perf_acct_idx` ON `account_holdings` (`performance_account_id`);
--> statement-breakpoint
CREATE INDEX `account_holdings_snapshot_idx` ON `account_holdings` (`snapshot_id`);
--> statement-breakpoint
CREATE INDEX `account_holdings_asset_class_idx` ON `account_holdings` (`asset_class_id`);
