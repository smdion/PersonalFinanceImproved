PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_performance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`institution` text NOT NULL,
	`account_label` text NOT NULL,
	`owner_person_id` integer,
	`beginning_balance` text NOT NULL,
	`total_contributions` text NOT NULL,
	`yearly_gain_loss` text NOT NULL,
	`ending_balance` text NOT NULL,
	`annual_return_pct` text,
	`employer_contributions` text DEFAULT '0' NOT NULL,
	`fees` text DEFAULT '0' NOT NULL,
	`distributions` text DEFAULT '0' NOT NULL,
	`rollovers` text DEFAULT '0' NOT NULL,
	`parent_category` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_finalized` integer DEFAULT false NOT NULL,
	`performance_account_id` integer NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_account_performance`("id", "year", "institution", "account_label", "owner_person_id", "beginning_balance", "total_contributions", "yearly_gain_loss", "ending_balance", "annual_return_pct", "employer_contributions", "fees", "distributions", "rollovers", "parent_category", "is_active", "is_finalized", "performance_account_id") SELECT "id", "year", "institution", "account_label", "owner_person_id", "beginning_balance", "total_contributions", "yearly_gain_loss", "ending_balance", "annual_return_pct", "employer_contributions", "fees", "distributions", "rollovers", "parent_category", "is_active", "is_finalized", "performance_account_id" FROM `account_performance`;--> statement-breakpoint
DROP TABLE `account_performance`;--> statement-breakpoint
ALTER TABLE `__new_account_performance` RENAME TO `account_performance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `account_perf_year_inst_label_owner_idx` ON `account_performance` (`year`,`institution`,`account_label`,`owner_person_id`);--> statement-breakpoint
CREATE INDEX `account_performance_owner_id_idx` ON `account_performance` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `account_performance_perf_acct_idx` ON `account_performance` (`performance_account_id`);--> statement-breakpoint
CREATE INDEX `account_performance_is_active_idx` ON `account_performance` (`is_active`);--> statement-breakpoint
CREATE TABLE `__new_net_worth_annual` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year_end_date` text NOT NULL,
	`gross_income` text DEFAULT '0' NOT NULL,
	`combined_agi` text DEFAULT '0' NOT NULL,
	`ssa_earnings` text,
	`effective_tax_rate` text,
	`taxes_paid` text,
	`cash` text DEFAULT '0' NOT NULL,
	`house_value` text DEFAULT '0' NOT NULL,
	`retirement_total` text DEFAULT '0' NOT NULL,
	`hsa` text DEFAULT '0' NOT NULL,
	`lt_brokerage` text DEFAULT '0' NOT NULL,
	`espp` text DEFAULT '0' NOT NULL,
	`r_brokerage` text DEFAULT '0' NOT NULL,
	`other_assets` text DEFAULT '0' NOT NULL,
	`mortgage_balance` text DEFAULT '0' NOT NULL,
	`other_liabilities` text DEFAULT '0' NOT NULL,
	`tax_free_total` text DEFAULT '0' NOT NULL,
	`tax_deferred_total` text DEFAULT '0' NOT NULL,
	`portfolio_total` text DEFAULT '0' NOT NULL,
	`home_improvements_cumulative` text DEFAULT '0' NOT NULL,
	`property_taxes` text,
	`portfolio_by_tax_location` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_net_worth_annual`("id", "year_end_date", "gross_income", "combined_agi", "ssa_earnings", "effective_tax_rate", "taxes_paid", "cash", "house_value", "retirement_total", "hsa", "lt_brokerage", "espp", "r_brokerage", "other_assets", "mortgage_balance", "other_liabilities", "tax_free_total", "tax_deferred_total", "portfolio_total", "home_improvements_cumulative", "property_taxes", "portfolio_by_tax_location") SELECT "id", "year_end_date", "gross_income", "combined_agi", "ssa_earnings", "effective_tax_rate", "taxes_paid", "cash", "house_value", "retirement_total", "hsa", "lt_brokerage", "espp", "r_brokerage", "other_assets", "mortgage_balance", "other_liabilities", "tax_free_total", "tax_deferred_total", "portfolio_total", "home_improvements_cumulative", "property_taxes", "portfolio_by_tax_location" FROM `net_worth_annual`;--> statement-breakpoint
DROP TABLE `net_worth_annual`;--> statement-breakpoint
ALTER TABLE `__new_net_worth_annual` RENAME TO `net_worth_annual`;--> statement-breakpoint
CREATE UNIQUE INDEX `net_worth_annual_year_end_date_unique` ON `net_worth_annual` (`year_end_date`);