CREATE TABLE `holding_period_weights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_period_id` integer NOT NULL,
	`security_id` integer NOT NULL,
	`weight` text NOT NULL,
	FOREIGN KEY (`holding_period_id`) REFERENCES `holding_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_period_weights_period_security_idx` ON `holding_period_weights` (`holding_period_id`,`security_id`);--> statement-breakpoint
CREATE INDEX `holding_period_weights_security_idx` ON `holding_period_weights` (`security_id`);--> statement-breakpoint
CREATE TABLE `holding_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performance_account_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`basis` text NOT NULL,
	`fit_quality` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `holding_periods_account_start_idx` ON `holding_periods` (`performance_account_id`,`start_date`);