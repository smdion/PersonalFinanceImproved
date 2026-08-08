PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contribution_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`person_id` integer,
	`account_type` text NOT NULL,
	`sub_type` text,
	`label` text,
	`parent_category` text DEFAULT 'Retirement' NOT NULL,
	`tax_treatment` text NOT NULL,
	`contribution_method` text NOT NULL,
	`contribution_value` text NOT NULL,
	`employer_match_type` text NOT NULL,
	`employer_match_value` text,
	`employer_max_match_pct` text,
	`employer_match_tax_treatment` text DEFAULT 'pre_tax' NOT NULL,
	`hsa_coverage_type` text,
	`auto_maximize` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`ownership` text DEFAULT 'individual' NOT NULL,
	`performance_account_id` integer,
	`target_annual` text,
	`allocation_priority` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`is_payroll_deducted` integer,
	`prior_year_contrib_amount` text DEFAULT '0' NOT NULL,
	`prior_year_contrib_year` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_contribution_accounts`("id", "job_id", "person_id", "account_type", "sub_type", "label", "parent_category", "tax_treatment", "contribution_method", "contribution_value", "employer_match_type", "employer_match_value", "employer_max_match_pct", "employer_match_tax_treatment", "hsa_coverage_type", "auto_maximize", "is_active", "ownership", "performance_account_id", "target_annual", "allocation_priority", "notes", "is_payroll_deducted", "prior_year_contrib_amount", "prior_year_contrib_year") SELECT "id", "job_id", "person_id", "account_type", "sub_type", "label", "parent_category", "tax_treatment", "contribution_method", "contribution_value", "employer_match_type", "employer_match_value", "employer_max_match_pct", "employer_match_tax_treatment", "hsa_coverage_type", "auto_maximize", "is_active", "ownership", "performance_account_id", "target_annual", "allocation_priority", "notes", "is_payroll_deducted", "prior_year_contrib_amount", "prior_year_contrib_year" FROM `contribution_accounts`;--> statement-breakpoint
DROP TABLE `contribution_accounts`;--> statement-breakpoint
ALTER TABLE `__new_contribution_accounts` RENAME TO `contribution_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `contribution_accounts_job_id_idx` ON `contribution_accounts` (`job_id`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_person_id_idx` ON `contribution_accounts` (`person_id`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_acct_type_idx` ON `contribution_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_parent_cat_idx` ON `contribution_accounts` (`parent_category`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_is_active_idx` ON `contribution_accounts` (`is_active`);