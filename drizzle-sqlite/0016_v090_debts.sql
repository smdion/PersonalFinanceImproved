CREATE TABLE `debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`owner_person_id` integer,
	`balance` text NOT NULL,
	`balance_as_of` text NOT NULL,
	`original_amount` text,
	`interest_rate` text,
	`monthly_payment` text,
	`opened_date` text,
	`paid_off_date` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `debts_owner_person_id_idx` ON `debts` (`owner_person_id`);