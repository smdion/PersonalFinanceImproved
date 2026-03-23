CREATE TABLE `irmaa_brackets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_status` text NOT NULL,
	`brackets` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `irmaa_brackets_year_status_idx` ON `irmaa_brackets` (`tax_year`,`filing_status`);--> statement-breakpoint
CREATE TABLE `ltcg_brackets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_status` text NOT NULL,
	`brackets` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ltcg_brackets_year_status_idx` ON `ltcg_brackets` (`tax_year`,`filing_status`);--> statement-breakpoint
ALTER TABLE `retirement_budget_overrides` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `retirement_budget_overrides` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `retirement_salary_overrides` ADD `contribution_profile_id` integer REFERENCES contribution_profiles(id);--> statement-breakpoint
ALTER TABLE `retirement_salary_overrides` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `retirement_salary_overrides` ADD `updated_by` text;