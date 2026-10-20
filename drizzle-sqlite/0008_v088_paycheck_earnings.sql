CREATE TABLE `paycheck_earnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`earning_name` text NOT NULL,
	`is_cash` integer DEFAULT true NOT NULL,
	`federal_taxable` integer DEFAULT true NOT NULL,
	`fica_taxable` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paycheck_earnings_job_id_idx` ON `paycheck_earnings` (`job_id`);