ALTER TABLE `contribution_limits` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `contribution_limits` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `contribution_limits` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `fpl_by_household` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `fpl_by_household` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `fpl_by_household` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `irmaa_brackets` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `irmaa_brackets` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `irmaa_brackets` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `ltcg_brackets` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `ltcg_brackets` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `ltcg_brackets` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `tax_brackets` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `tax_brackets` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `tax_brackets` ADD `confirmed_at` integer;