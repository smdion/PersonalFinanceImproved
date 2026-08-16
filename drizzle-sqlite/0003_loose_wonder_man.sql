PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_savings_goal_profile_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`budget_profile_id` integer NOT NULL,
	`allocation_percent` text,
	`monthly_contribution` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_profile_id`) REFERENCES `budget_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_savings_goal_profile_allocations`("id", "goal_id", "budget_profile_id", "allocation_percent", "monthly_contribution") SELECT "id", "goal_id", "budget_profile_id", "allocation_percent", "monthly_contribution" FROM `savings_goal_profile_allocations`;--> statement-breakpoint
DROP TABLE `savings_goal_profile_allocations`;--> statement-breakpoint
ALTER TABLE `__new_savings_goal_profile_allocations` RENAME TO `savings_goal_profile_allocations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goal_profile_alloc_goal_profile_idx` ON `savings_goal_profile_allocations` (`goal_id`,`budget_profile_id`);