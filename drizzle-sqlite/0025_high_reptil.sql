CREATE TABLE `roth_basis` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performance_account_id` integer NOT NULL,
	`owner_person_id` integer NOT NULL,
	`contribution_basis` text DEFAULT '0' NOT NULL,
	`conversion_basis` text DEFAULT '0' NOT NULL,
	`latest_conversion_year` integer,
	`as_of_date` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roth_basis_account_owner_idx` ON `roth_basis` (`performance_account_id`,`owner_person_id`);--> statement-breakpoint
CREATE INDEX `roth_basis_owner_person_id_idx` ON `roth_basis` (`owner_person_id`);--> statement-breakpoint
ALTER TABLE `performance_accounts` ADD `separation_date` text;
