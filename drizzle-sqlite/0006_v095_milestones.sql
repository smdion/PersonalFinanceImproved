ALTER TABLE `debts` ADD `purchase_price` text;--> statement-breakpoint
ALTER TABLE `debts` ADD `term_months` integer;--> statement-breakpoint
ALTER TABLE `debts` ADD `api_balance` text;--> statement-breakpoint
ALTER TABLE `debts` ADD `api_balance_date` text;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `vpw_cap` text;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `vpw_end_age` integer;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `cp_ss_in_amount` integer;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `en_ss_in_amount` integer;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `vd_ss_in_amount` integer;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `rmd_ss_in_amount` integer;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `vpw_ss_in_amount` integer;--> statement-breakpoint
-- Existing profiles keep today's projections (see drizzle/0006). Guarded
-- so a re-run never undoes a household's own choice (any switch set).
UPDATE `retirement_settings` SET `cp_ss_in_amount` = 1, `en_ss_in_amount` = 1, `vd_ss_in_amount` = 1, `rmd_ss_in_amount` = 1 WHERE `cp_ss_in_amount` IS NULL AND `en_ss_in_amount` IS NULL AND `vd_ss_in_amount` IS NULL AND `rmd_ss_in_amount` IS NULL AND `vpw_ss_in_amount` IS NULL;
