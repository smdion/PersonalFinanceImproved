CREATE TABLE `savings_planned_tx_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`planned_tx_id` integer NOT NULL,
	`occurrence_month` text NOT NULL,
	`settled_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`planned_tx_id`) REFERENCES `savings_planned_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_planned_tx_settlements_occurrence_idx` ON `savings_planned_tx_settlements` (`planned_tx_id`,`occurrence_month`);