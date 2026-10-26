ALTER TABLE `utility_reading` ADD `source` text;--> statement-breakpoint
ALTER TABLE `utility_service` ADD `budget_api_category_id` text;--> statement-breakpoint
ALTER TABLE `utility_service` ADD `billing_lag_months` integer DEFAULT 0 NOT NULL;