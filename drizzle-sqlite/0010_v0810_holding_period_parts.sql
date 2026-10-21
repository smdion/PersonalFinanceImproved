DROP INDEX `holding_periods_account_start_idx`;--> statement-breakpoint
ALTER TABLE `holding_periods` ADD `sub_key` text;--> statement-breakpoint
CREATE INDEX `holding_periods_account_part_start_idx` ON `holding_periods` (`performance_account_id`,`sub_key`,`start_date`);