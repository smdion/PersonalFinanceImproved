CREATE TABLE `account_performance` (
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
	`performance_account_id` integer,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_perf_year_inst_label_owner_idx` ON `account_performance` (`year`,`institution`,`account_label`,`owner_person_id`);--> statement-breakpoint
CREATE INDEX `account_performance_owner_id_idx` ON `account_performance` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `account_performance_perf_acct_idx` ON `account_performance` (`performance_account_id`);--> statement-breakpoint
CREATE INDEX `account_performance_is_active_idx` ON `account_performance` (`is_active`);--> statement-breakpoint
CREATE TABLE `annual_performance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`beginning_balance` text NOT NULL,
	`total_contributions` text NOT NULL,
	`yearly_gain_loss` text NOT NULL,
	`ending_balance` text NOT NULL,
	`annual_return_pct` text,
	`employer_contributions` text DEFAULT '0' NOT NULL,
	`distributions` text DEFAULT '0' NOT NULL,
	`fees` text DEFAULT '0' NOT NULL,
	`rollovers` text DEFAULT '0' NOT NULL,
	`lifetime_gains` text NOT NULL,
	`lifetime_contributions` text NOT NULL,
	`lifetime_match` text NOT NULL,
	`is_current_year` integer DEFAULT false NOT NULL,
	`is_finalized` integer DEFAULT false NOT NULL,
	CONSTRAINT "annual_perf_finalized_not_current" CHECK(NOT ("annual_performance"."is_finalized" AND "annual_performance"."is_current_year"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annual_performance_year_cat_idx` ON `annual_performance` (`year`,`category`);--> statement-breakpoint
CREATE TABLE `api_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`config` text NOT NULL,
	`account_mappings` text,
	`skipped_category_ids` text,
	`linked_profile_id` integer,
	`linked_column_index` integer,
	`server_knowledge` integer,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_connections_service_unique` ON `api_connections` (`service`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_key_unique` ON `app_settings` (`key`);--> statement-breakpoint
CREATE TABLE `asset_class_correlations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_a_id` integer NOT NULL,
	`class_b_id` integer NOT NULL,
	`correlation` text NOT NULL,
	FOREIGN KEY (`class_a_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_b_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_class_correlations_pair_idx` ON `asset_class_correlations` (`class_a_id`,`class_b_id`);--> statement-breakpoint
CREATE INDEX `asset_class_correlations_class_a_idx` ON `asset_class_correlations` (`class_a_id`);--> statement-breakpoint
CREATE INDEX `asset_class_correlations_class_b_idx` ON `asset_class_correlations` (`class_b_id`);--> statement-breakpoint
CREATE TABLE `asset_class_params` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mean_return` text NOT NULL,
	`std_dev` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_class_params_name_unique` ON `asset_class_params` (`name`);--> statement-breakpoint
CREATE INDEX `asset_class_params_is_active_idx` ON `asset_class_params` (`is_active`);--> statement-breakpoint
CREATE TABLE `brokerage_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`target_amount` text NOT NULL,
	`target_year` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brokerage_goals_is_active_idx` ON `brokerage_goals` (`is_active`);--> statement-breakpoint
CREATE TABLE `brokerage_planned_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`is_recurring` integer DEFAULT false NOT NULL,
	`recurrence_months` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `brokerage_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `brokerage_planned_tx_goal_id_idx` ON `brokerage_planned_transactions` (`goal_id`);--> statement-breakpoint
CREATE TABLE `budget_api_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`cache_key` text NOT NULL,
	`data` text NOT NULL,
	`server_knowledge` integer,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_api_cache_service_key_idx` ON `budget_api_cache` (`service`,`cache_key`);--> statement-breakpoint
CREATE TABLE `budget_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`category` text NOT NULL,
	`subcategory` text NOT NULL,
	`amounts` text NOT NULL,
	`api_category_name` text,
	`api_category_id` text,
	`api_last_synced_at` integer,
	`api_sync_direction` text DEFAULT 'pull',
	`contribution_account_id` integer,
	`is_essential` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `budget_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contribution_account_id`) REFERENCES `contribution_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `budget_items_profile_id_idx` ON `budget_items` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_items_profile_cat_sub_idx` ON `budget_items` (`profile_id`,`category`,`subcategory`);--> statement-breakpoint
CREATE TABLE `budget_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`column_labels` text NOT NULL,
	`column_months` text,
	`column_contribution_profile_ids` text,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_profiles_name_unique` ON `budget_profiles` (`name`);--> statement-breakpoint
CREATE INDEX `budget_profiles_is_active_idx` ON `budget_profiles` (`is_active`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`record_id` integer NOT NULL,
	`field_name` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_by` text NOT NULL,
	`changed_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_table_record_idx` ON `change_log` (`table_name`,`record_id`);--> statement-breakpoint
CREATE INDEX `change_log_changed_at_idx` ON `change_log` (`changed_at`);--> statement-breakpoint
CREATE TABLE `contribution_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`person_id` integer NOT NULL,
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
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contribution_accounts_parent_cat_check" CHECK(parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE INDEX `contribution_accounts_job_id_idx` ON `contribution_accounts` (`job_id`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_person_id_idx` ON `contribution_accounts` (`person_id`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_acct_type_idx` ON `contribution_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_parent_cat_idx` ON `contribution_accounts` (`parent_category`);--> statement-breakpoint
CREATE INDEX `contribution_accounts_is_active_idx` ON `contribution_accounts` (`is_active`);--> statement-breakpoint
CREATE TABLE `contribution_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`limit_type` text NOT NULL,
	`value` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_limits_year_type_idx` ON `contribution_limits` (`tax_year`,`limit_type`);--> statement-breakpoint
CREATE TABLE `contribution_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`salary_overrides` text DEFAULT '{}' NOT NULL,
	`contribution_overrides` text DEFAULT '{}' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_profiles_name_unique` ON `contribution_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `glide_path_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`age` integer NOT NULL,
	`asset_class_id` integer NOT NULL,
	`allocation` text NOT NULL,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `glide_path_age_class_idx` ON `glide_path_allocations` (`age`,`asset_class_id`);--> statement-breakpoint
CREATE INDEX `glide_path_asset_class_idx` ON `glide_path_allocations` (`asset_class_id`);--> statement-breakpoint
CREATE TABLE `historical_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`field` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `historical_notes_year_field_idx` ON `historical_notes` (`year`,`field`);--> statement-breakpoint
CREATE TABLE `home_improvement_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`description` text NOT NULL,
	`cost` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `irmaa_brackets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_status` text NOT NULL,
	`brackets` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `irmaa_brackets_year_status_idx` ON `irmaa_brackets` (`tax_year`,`filing_status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`employer_name` text NOT NULL,
	`title` text,
	`annual_salary` text NOT NULL,
	`pay_period` text NOT NULL,
	`pay_week` text NOT NULL,
	`start_date` text NOT NULL,
	`anchor_pay_date` text,
	`end_date` text,
	`bonus_percent` text DEFAULT '0' NOT NULL,
	`bonus_multiplier` text DEFAULT '1.0' NOT NULL,
	`months_in_bonus_year` integer DEFAULT 12 NOT NULL,
	`include_401k_in_bonus` integer DEFAULT false NOT NULL,
	`include_bonus_in_contributions` integer DEFAULT true NOT NULL,
	`bonus_override` text,
	`bonus_month` integer,
	`bonus_day_of_month` integer,
	`w4_filing_status` text NOT NULL,
	`w4_box2c_checked` integer DEFAULT false NOT NULL,
	`additional_fed_withholding` text DEFAULT '0' NOT NULL,
	`budget_periods_per_month` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `jobs_person_id_idx` ON `jobs` (`person_id`);--> statement-breakpoint
CREATE TABLE `local_admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_admins_email_unique` ON `local_admins` (`email`);--> statement-breakpoint
CREATE TABLE `ltcg_brackets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_status` text NOT NULL,
	`brackets` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ltcg_brackets_year_status_idx` ON `ltcg_brackets` (`tax_year`,`filing_status`);--> statement-breakpoint
CREATE TABLE `mc_preset_glide_paths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preset_id` integer NOT NULL,
	`age` integer NOT NULL,
	`asset_class_id` integer NOT NULL,
	`allocation` text NOT NULL,
	FOREIGN KEY (`preset_id`) REFERENCES `mc_presets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mc_preset_gp_idx` ON `mc_preset_glide_paths` (`preset_id`,`age`,`asset_class_id`);--> statement-breakpoint
CREATE INDEX `mc_preset_gp_preset_idx` ON `mc_preset_glide_paths` (`preset_id`);--> statement-breakpoint
CREATE TABLE `mc_preset_return_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preset_id` integer NOT NULL,
	`asset_class_id` integer NOT NULL,
	`mean_return` text NOT NULL,
	FOREIGN KEY (`preset_id`) REFERENCES `mc_presets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_class_params`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mc_preset_ro_idx` ON `mc_preset_return_overrides` (`preset_id`,`asset_class_id`);--> statement-breakpoint
CREATE TABLE `mc_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`return_multiplier` text DEFAULT '1.000000' NOT NULL,
	`vol_multiplier` text DEFAULT '1.000000' NOT NULL,
	`inflation_mean` text DEFAULT '0.025000' NOT NULL,
	`inflation_std_dev` text DEFAULT '0.012000' NOT NULL,
	`default_trials` integer DEFAULT 5000 NOT NULL,
	`return_clamp_min` text DEFAULT '-0.500000' NOT NULL,
	`return_clamp_max` text DEFAULT '1.000000' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mc_presets_key_unique` ON `mc_presets` (`key`);--> statement-breakpoint
CREATE INDEX `mc_presets_is_active_idx` ON `mc_presets` (`is_active`);--> statement-breakpoint
CREATE TABLE `mc_user_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`simulations` integer DEFAULT 1000 NOT NULL,
	`return_mean` text NOT NULL,
	`return_std_dev` text NOT NULL,
	`inflation_mean` text NOT NULL,
	`inflation_std_dev` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mortgage_extra_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`payment_date` text,
	`start_date` text,
	`end_date` text,
	`amount` text NOT NULL,
	`is_actual` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`loan_id`) REFERENCES `mortgage_loans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "date_pattern_check" CHECK((payment_date IS NOT NULL AND start_date IS NULL AND end_date IS NULL) OR (payment_date IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `mortgage_extra_payments_loan_id_idx` ON `mortgage_extra_payments` (`loan_id`);--> statement-breakpoint
CREATE TABLE `mortgage_loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`refinanced_from_id` integer,
	`paid_off_date` text,
	`principal_and_interest` text NOT NULL,
	`pmi` text DEFAULT '0' NOT NULL,
	`insurance_and_taxes` text DEFAULT '0' NOT NULL,
	`total_escrow` text DEFAULT '0' NOT NULL,
	`interest_rate` text NOT NULL,
	`term_years` integer NOT NULL,
	`original_loan_amount` text NOT NULL,
	`first_payment_date` text NOT NULL,
	`property_value_purchase` text NOT NULL,
	`property_value_estimated` text,
	`use_purchase_or_estimated` text DEFAULT 'purchase' NOT NULL,
	`api_balance` text,
	`api_balance_date` text
);
--> statement-breakpoint
CREATE INDEX `mortgage_loans_is_active_idx` ON `mortgage_loans` (`is_active`);--> statement-breakpoint
CREATE TABLE `mortgage_what_if_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer,
	`label` text NOT NULL,
	`extra_monthly_principal` text NOT NULL,
	`extra_one_time_payment` text DEFAULT '0' NOT NULL,
	`refinance_rate` text,
	`refinance_term` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `mortgage_loans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mortgage_what_if_loan_id_idx` ON `mortgage_what_if_scenarios` (`loan_id`);--> statement-breakpoint
CREATE TABLE `net_worth_annual` (
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
	`property_taxes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `net_worth_annual_year_end_date_unique` ON `net_worth_annual` (`year_end_date`);--> statement-breakpoint
CREATE TABLE `other_asset_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`year` integer NOT NULL,
	`value` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `other_asset_items_name_year_idx` ON `other_asset_items` (`name`,`year`);--> statement-breakpoint
CREATE TABLE `paycheck_deductions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`deduction_name` text NOT NULL,
	`amount_per_period` text NOT NULL,
	`is_pretax` integer NOT NULL,
	`fica_exempt` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paycheck_deductions_job_id_idx` ON `paycheck_deductions` (`job_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`is_primary_user` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `performance_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution` text NOT NULL,
	`account_type` text NOT NULL,
	`sub_type` text,
	`label` text,
	`account_label` text NOT NULL,
	`display_name` text,
	`owner_person_id` integer,
	`ownership_type` text NOT NULL,
	`retirement_behavior` text DEFAULT 'stops_at_owner_retirement' NOT NULL,
	`contribution_scaling` text DEFAULT 'scales_with_salary' NOT NULL,
	`cost_basis` text DEFAULT '0' NOT NULL,
	`parent_category` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "performance_accounts_parent_cat_check" CHECK(parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `performance_accounts_inst_type_idx` ON `performance_accounts` (`institution`,`account_type`,`sub_type`,`label`,`owner_person_id`);--> statement-breakpoint
CREATE INDEX `idx_perf_accounts_inst_label` ON `performance_accounts` (`institution`,`account_label`);--> statement-breakpoint
CREATE INDEX `performance_accounts_category_idx` ON `performance_accounts` (`parent_category`);--> statement-breakpoint
CREATE INDEX `performance_accounts_is_active_idx` ON `performance_accounts` (`is_active`);--> statement-breakpoint
CREATE TABLE `portfolio_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`institution` text NOT NULL,
	`tax_type` text NOT NULL,
	`amount` text NOT NULL,
	`account_type` text NOT NULL,
	`sub_type` text,
	`label` text,
	`parent_category` text DEFAULT 'Retirement' NOT NULL,
	`owner_person_id` integer,
	`performance_account_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `portfolio_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "portfolio_accounts_parent_cat_check" CHECK(parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE INDEX `portfolio_accounts_snapshot_id_idx` ON `portfolio_accounts` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `portfolio_accounts_owner_id_idx` ON `portfolio_accounts` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_accounts_owner` ON `portfolio_accounts` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `portfolio_accounts_perf_acct_idx` ON `portfolio_accounts` (`performance_account_id`);--> statement-breakpoint
CREATE INDEX `portfolio_accounts_acct_type_idx` ON `portfolio_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX `portfolio_accounts_parent_cat_idx` ON `portfolio_accounts` (`parent_category`);--> statement-breakpoint
CREATE INDEX `portfolio_accounts_is_active_idx` ON `portfolio_accounts` (`is_active`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_snapshots_snapshot_date_unique` ON `portfolio_snapshots` (`snapshot_date`);--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_date_idx` ON `portfolio_snapshots` (`snapshot_date`);--> statement-breakpoint
CREATE TABLE `projection_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`override_type` text NOT NULL,
	`overrides` text NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_overrides_type_idx` ON `projection_overrides` (`override_type`);--> statement-breakpoint
CREATE TABLE `property_taxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`year` integer NOT NULL,
	`assessed_value` text,
	`tax_amount` text NOT NULL,
	`note` text,
	FOREIGN KEY (`loan_id`) REFERENCES `mortgage_loans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_taxes_loan_year_idx` ON `property_taxes` (`loan_id`,`year`);--> statement-breakpoint
CREATE TABLE `relocation_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`params` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retirement_budget_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`projection_year` integer NOT NULL,
	`override_monthly_budget` text NOT NULL,
	`notes` text,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_budget_overrides_person_year_idx` ON `retirement_budget_overrides` (`person_id`,`projection_year`);--> statement-breakpoint
CREATE INDEX `retirement_budget_overrides_person_id_idx` ON `retirement_budget_overrides` (`person_id`);--> statement-breakpoint
CREATE TABLE `retirement_salary_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`projection_year` integer NOT NULL,
	`override_salary` text NOT NULL,
	`contribution_profile_id` integer,
	`notes` text,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contribution_profile_id`) REFERENCES `contribution_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_salary_overrides_person_year_idx` ON `retirement_salary_overrides` (`person_id`,`projection_year`);--> statement-breakpoint
CREATE INDEX `retirement_salary_overrides_person_id_idx` ON `retirement_salary_overrides` (`person_id`);--> statement-breakpoint
CREATE TABLE `retirement_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`withdrawal_rate` text NOT NULL,
	`target_annual_income` text NOT NULL,
	`annual_inflation` text NOT NULL,
	`distribution_tax_rate_traditional` text DEFAULT '0.22' NOT NULL,
	`distribution_tax_rate_roth` text DEFAULT '0' NOT NULL,
	`distribution_tax_rate_hsa` text DEFAULT '0' NOT NULL,
	`distribution_tax_rate_brokerage` text DEFAULT '0.15' NOT NULL,
	`is_lt_brokerage_enabled` integer DEFAULT true NOT NULL,
	`lt_brokerage_annual_contribution` text DEFAULT '0' NOT NULL,
	`is_selected` integer DEFAULT false NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `retirement_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`retirement_age` integer NOT NULL,
	`end_age` integer NOT NULL,
	`return_after_retirement` text NOT NULL,
	`annual_inflation` text NOT NULL,
	`post_retirement_inflation` text,
	`salary_annual_increase` text NOT NULL,
	`salary_cap` text,
	`raises_during_retirement` integer DEFAULT false NOT NULL,
	`withdrawal_rate` text DEFAULT '0.04' NOT NULL,
	`tax_multiplier` text DEFAULT '1.0' NOT NULL,
	`gross_up_for_taxes` integer DEFAULT true NOT NULL,
	`roth_bracket_target` text DEFAULT '0.12',
	`social_security_monthly` text DEFAULT '2500' NOT NULL,
	`ss_start_age` integer DEFAULT 67 NOT NULL,
	`enable_roth_conversions` integer DEFAULT false NOT NULL,
	`roth_conversion_target` text,
	`withdrawal_strategy` text DEFAULT 'fixed' NOT NULL,
	`gk_upper_guardrail` text DEFAULT '0.80',
	`gk_lower_guardrail` text DEFAULT '1.20',
	`gk_increase_pct` text DEFAULT '0.10',
	`gk_decrease_pct` text DEFAULT '0.10',
	`gk_skip_inflation_after_loss` integer DEFAULT true NOT NULL,
	`sd_annual_decline_rate` text DEFAULT '0.02',
	`cp_withdrawal_percent` text DEFAULT '0.05',
	`cp_floor_percent` text DEFAULT '0.90',
	`en_withdrawal_percent` text DEFAULT '0.05',
	`en_rolling_years` integer DEFAULT 10,
	`en_floor_percent` text DEFAULT '0.90',
	`vd_base_percent` text DEFAULT '0.05',
	`vd_ceiling_percent` text DEFAULT '0.05',
	`vd_floor_percent` text DEFAULT '0.025',
	`rmd_multiplier` text DEFAULT '1.0',
	`enable_irmaa_awareness` integer DEFAULT false NOT NULL,
	`enable_aca_awareness` integer DEFAULT false NOT NULL,
	`household_size` integer DEFAULT 2 NOT NULL,
	`filing_status` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_settings_person_id_unique` ON `retirement_settings` (`person_id`);--> statement-breakpoint
CREATE INDEX `retirement_settings_person_id_idx` ON `retirement_settings` (`person_id`);--> statement-breakpoint
CREATE TABLE `return_rate_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`age` integer NOT NULL,
	`rate_of_return` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `return_rate_table_age_unique` ON `return_rate_table` (`age`);--> statement-breakpoint
CREATE TABLE `salary_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`new_salary` text NOT NULL,
	`raise_percent` text,
	`notes` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `salary_changes_job_id_idx` ON `salary_changes` (`job_id`);--> statement-breakpoint
CREATE TABLE `savings_allocation_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`month_date` text NOT NULL,
	`amount` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_alloc_override_goal_month_idx` ON `savings_allocation_overrides` (`goal_id`,`month_date`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_goal_id` integer,
	`target_amount` text,
	`target_months` integer,
	`target_date` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_emergency_fund` integer DEFAULT false NOT NULL,
	`api_category_id` text,
	`api_category_name` text,
	`is_api_sync_enabled` integer DEFAULT false NOT NULL,
	`reimbursement_api_category_id` text,
	`target_mode` text DEFAULT 'fixed' NOT NULL,
	`monthly_contribution` text DEFAULT '0' NOT NULL,
	`allocation_percent` text,
	CONSTRAINT "savings_goals_target_mode_check" CHECK(target_mode IN ('fixed', 'ongoing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goals_name_unique` ON `savings_goals` (`name`);--> statement-breakpoint
CREATE INDEX `savings_goals_is_active_idx` ON `savings_goals` (`is_active`);--> statement-breakpoint
CREATE TABLE `savings_monthly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`month_date` text NOT NULL,
	`balance` text NOT NULL,
	`deposit_or_withdrawal` text,
	`notes` text,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_monthly_goal_id_idx` ON `savings_monthly` (`goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `savings_monthly_goal_month_idx` ON `savings_monthly` (`goal_id`,`month_date`);--> statement-breakpoint
CREATE TABLE `savings_planned_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`is_recurring` integer DEFAULT false NOT NULL,
	`recurrence_months` integer,
	`transfer_pair_id` text,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_planned_tx_goal_id_idx` ON `savings_planned_transactions` (`goal_id`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`overrides` text DEFAULT '{}' NOT NULL,
	`is_baseline` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `self_loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_goal_id` integer NOT NULL,
	`to_goal_id` integer,
	`amount` text NOT NULL,
	`loan_date` text NOT NULL,
	`repaid_amount` text DEFAULT '0' NOT NULL,
	`repaid_date` text,
	FOREIGN KEY (`from_goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `self_loans_from_goal_id_idx` ON `self_loans` (`from_goal_id`);--> statement-breakpoint
CREATE INDEX `self_loans_to_goal_id_idx` ON `self_loans` (`to_goal_id`);--> statement-breakpoint
CREATE TABLE `state_version_tables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`row_count` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `state_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `state_version_tables_version_id_idx` ON `state_version_tables` (`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `state_version_tables_version_table_idx` ON `state_version_tables` (`version_id`,`table_name`);--> statement-breakpoint
CREATE TABLE `state_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`version_type` text NOT NULL,
	`schema_version` text NOT NULL,
	`table_count` integer NOT NULL,
	`total_rows` integer NOT NULL,
	`size_estimate_bytes` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `state_versions_created_at_idx` ON `state_versions` (`created_at`);--> statement-breakpoint
CREATE TABLE `tax_brackets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_status` text NOT NULL,
	`w4_checkbox` integer NOT NULL,
	`brackets` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_brackets_year_status_checkbox_idx` ON `tax_brackets` (`tax_year`,`filing_status`,`w4_checkbox`);