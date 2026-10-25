ALTER TABLE `account_performance` ADD `note` text;--> statement-breakpoint
ALTER TABLE `account_performance` ADD `estimated_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_performance` ADD `accepted_checks` text DEFAULT '{}' NOT NULL;