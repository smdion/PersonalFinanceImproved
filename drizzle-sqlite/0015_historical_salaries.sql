CREATE TABLE `historical_salaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`year` integer NOT NULL,
	`salary` text NOT NULL,
	`bonus` text DEFAULT '0' NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `historical_salaries_person_year_idx` ON `historical_salaries` (`person_id`,`year`);