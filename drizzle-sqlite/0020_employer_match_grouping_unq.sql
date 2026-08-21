-- SQLite twin of drizzle/0020_employer_match_grouping_unq.sql (Postgres) —
-- see that file's header for the full rationale. SQLite supports partial
-- indexes the same way Postgres does, so this constraint is enforced on
-- both dialects (unlike some earlier self-referencing-FK migrations,
-- which SQLite can't express at all).
CREATE UNIQUE INDEX `contribution_accounts_job_match_unq` ON `contribution_accounts` (`job_id`,`account_type`,`parent_category`) WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NOT NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_accounts_person_match_unq` ON `contribution_accounts` (`person_id`,`account_type`,`parent_category`) WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NULL AND "contribution_accounts"."is_active" = true;
