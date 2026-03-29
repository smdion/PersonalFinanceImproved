CREATE TABLE `projection_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`override_type` text NOT NULL,
	`overrides` text NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_overrides_type_idx` ON `projection_overrides` (`override_type`);
