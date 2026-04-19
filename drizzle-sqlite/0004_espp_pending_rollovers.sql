CREATE TABLE `pending_rollovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_account_performance_id` integer NOT NULL,
	`destination_performance_account_id` integer NOT NULL,
	`amount` text NOT NULL,
	`sale_date` text NOT NULL,
	`sale_year` integer NOT NULL,
	`apply_year` integer NOT NULL,
	`notes` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (`source_account_performance_id`) REFERENCES `account_performance`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `pending_rollovers_source_idx` ON `pending_rollovers` (`source_account_performance_id`);
--> statement-breakpoint
CREATE INDEX `pending_rollovers_dest_idx` ON `pending_rollovers` (`destination_performance_account_id`);
--> statement-breakpoint
CREATE INDEX `pending_rollovers_sale_year_idx` ON `pending_rollovers` (`sale_year`);
--> statement-breakpoint
CREATE INDEX `pending_rollovers_confirmed_idx` ON `pending_rollovers` (`confirmed_at`);
