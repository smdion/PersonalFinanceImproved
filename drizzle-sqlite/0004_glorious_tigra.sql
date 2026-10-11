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
CREATE TABLE `investment_transaction_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution_contains` text NOT NULL,
	`description_contains` text NOT NULL,
	`sign` text,
	`kind` text NOT NULL,
	`review_when` text,
	`max_fraction_of_balance` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`sample_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
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
	`kind_override_source` text,
	`voided_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simplefin_account_id`) REFERENCES `simplefin_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_transactions_external_idx` ON `investment_transactions` (`simplefin_account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `investment_transactions_account_posted_idx` ON `investment_transactions` (`simplefin_account_id`,`posted`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text,
	`source_symbol` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`institution` text,
	`source_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_ticker_idx` ON `securities` (`ticker`) WHERE "securities"."ticker" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `securities_untickered_identity_idx` ON `securities` (`institution`,`source_description`) WHERE "securities"."ticker" IS NULL;--> statement-breakpoint
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
CREATE INDEX `sync_request_log_service_requested_idx` ON `sync_request_log` (`service`,`requested_at`);