CREATE TABLE `budget_income_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`month_date` text NOT NULL,
	`amount` text NOT NULL,
	`source` text DEFAULT 'rule' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_income_adjustments_job_month_idx` ON `budget_income_adjustments` (`job_id`,`month_date`);