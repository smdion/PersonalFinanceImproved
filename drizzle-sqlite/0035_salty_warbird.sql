CREATE TABLE `budget_item_category_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_item_id` integer NOT NULL,
	`service` text NOT NULL,
	`category_id` text NOT NULL,
	`category_name` text,
	`last_synced_at` integer,
	`sync_direction` text,
	FOREIGN KEY (`budget_item_id`) REFERENCES `budget_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_item_category_links_budget_item_id_idx` ON `budget_item_category_links` (`budget_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_item_category_links_item_service_idx` ON `budget_item_category_links` (`budget_item_id`,`service`);--> statement-breakpoint
CREATE TABLE `savings_goal_category_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`savings_goal_id` integer NOT NULL,
	`service` text NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	`category_id` text NOT NULL,
	`category_name` text,
	`last_synced_at` integer,
	FOREIGN KEY (`savings_goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_goal_category_links_savings_goal_id_idx` ON `savings_goal_category_links` (`savings_goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goal_category_links_goal_service_role_idx` ON `savings_goal_category_links` (`savings_goal_id`,`service`,`role`);