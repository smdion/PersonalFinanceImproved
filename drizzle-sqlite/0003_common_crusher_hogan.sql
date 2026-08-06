CREATE TABLE `simplefin_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`total_balance` text NOT NULL,
	`account_count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simplefin_balance_snapshots_snapshot_date_unique` ON `simplefin_balance_snapshots` (`snapshot_date`);--> statement-breakpoint
CREATE INDEX `simplefin_balance_snapshots_date_idx` ON `simplefin_balance_snapshots` (`snapshot_date`);