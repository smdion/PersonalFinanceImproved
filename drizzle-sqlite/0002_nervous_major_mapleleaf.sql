CREATE TABLE `utility_reading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`cost` text NOT NULL,
	`usage` text,
	`note` text,
	FOREIGN KEY (`service_id`) REFERENCES `utility_service`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utility_reading_service_year_month_idx` ON `utility_reading` (`service_id`,`year`,`month`);--> statement-breakpoint
CREATE TABLE `utility_service` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`provider_name` text NOT NULL,
	`usage_unit` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utility_service_kind_idx` ON `utility_service` (`kind`);