ALTER TABLE `annual_performance` ADD `is_immutable` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `api_connections_linked_profile_id_idx` ON `api_connections` (`linked_profile_id`);--> statement-breakpoint
CREATE INDEX `budget_items_contribution_account_id_idx` ON `budget_items` (`contribution_account_id`);--> statement-breakpoint
-- Data backfill: see drizzle/0001_v5_schema_changes.sql for rationale.
UPDATE `annual_performance` SET `is_immutable` = 1 WHERE `is_finalized` = 1;
