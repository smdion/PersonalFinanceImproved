CREATE TABLE `simplefin_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_account_id` text NOT NULL,
	`org_name` text NOT NULL,
	`account_name` text NOT NULL,
	`last_balance` text NOT NULL,
	`is_included` integer DEFAULT true NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simplefin_accounts_external_account_id_unique` ON `simplefin_accounts` (`external_account_id`);--> statement-breakpoint
CREATE INDEX `simplefin_accounts_org_name_idx` ON `simplefin_accounts` (`org_name`,`account_name`);