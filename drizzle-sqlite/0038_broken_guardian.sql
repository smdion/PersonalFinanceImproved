CREATE TABLE `fpl_by_household` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`amounts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fpl_by_household_year_idx` ON `fpl_by_household` (`tax_year`);--> statement-breakpoint
CREATE TABLE `tax_params` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source` text,
	`notes` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_params_year_idx` ON `tax_params` (`tax_year`);--> statement-breakpoint
ALTER TABLE `retirement_profiles` ADD `tax_params_year` integer;