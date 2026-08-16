CREATE TABLE `savings_goal_profile_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`budget_profile_id` integer NOT NULL,
	`allocation_percent` text,
	`monthly_contribution` text,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_profile_id`) REFERENCES `budget_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goal_profile_alloc_goal_profile_idx` ON `savings_goal_profile_allocations` (`goal_id`,`budget_profile_id`);