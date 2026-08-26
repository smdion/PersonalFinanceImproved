ALTER TABLE `roth_basis` RENAME TO `account_basis`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_basis` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performance_account_id` integer NOT NULL,
	`owner_person_id` integer NOT NULL,
	`year` integer NOT NULL,
	`contribution_basis` text DEFAULT '0' NOT NULL,
	`conversion_basis` text DEFAULT '0' NOT NULL,
	`latest_conversion_year` integer,
	`is_finalized` integer DEFAULT false NOT NULL,
	`is_seeded` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text,
	FOREIGN KEY (`performance_account_id`) REFERENCES `performance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_account_basis`("id", "performance_account_id", "owner_person_id", "year", "contribution_basis", "conversion_basis", "latest_conversion_year", "is_finalized", "is_seeded", "updated_at", "notes") SELECT "id", "performance_account_id", "owner_person_id", "year", "contribution_basis", "conversion_basis", "latest_conversion_year", "is_finalized", "is_seeded", "updated_at", "notes" FROM `account_basis`;--> statement-breakpoint
DROP TABLE `account_basis`;--> statement-breakpoint
ALTER TABLE `__new_account_basis` RENAME TO `account_basis`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `account_basis_account_owner_year_idx` ON `account_basis` (`performance_account_id`,`owner_person_id`,`year`);--> statement-breakpoint
CREATE INDEX `account_basis_owner_person_id_idx` ON `account_basis` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `account_basis_year_idx` ON `account_basis` (`year`);