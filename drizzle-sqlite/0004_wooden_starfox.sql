ALTER TABLE `scenarios` ADD `budget_profile_id` integer REFERENCES budget_profiles(id);--> statement-breakpoint
ALTER TABLE `scenarios` ADD `contribution_profile_id` integer REFERENCES contribution_profiles(id);--> statement-breakpoint
CREATE INDEX `scenarios_budget_profile_id_idx` ON `scenarios` (`budget_profile_id`);--> statement-breakpoint
CREATE INDEX `scenarios_contribution_profile_id_idx` ON `scenarios` (`contribution_profile_id`);