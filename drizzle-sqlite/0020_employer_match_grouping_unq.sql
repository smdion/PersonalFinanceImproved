-- SQLite twin of drizzle/0020_employer_match_grouping_unq.sql (Postgres) —
-- see that file's header for the full rationale, including the pre-flight
-- dedupe added on review. SQLite supports partial indexes and window
-- functions the same way Postgres does, so this constraint (and its
-- dedupe) is enforced identically on both dialects (unlike some earlier
-- self-referencing-FK migrations, which SQLite can't express at all).
WITH job_dupes AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY `job_id`, `account_type`, `parent_category`
			ORDER BY id
		) AS rn
	FROM `contribution_accounts`
	WHERE `employer_match_type` <> 'none'
		AND `job_id` IS NOT NULL
		AND `is_active` = 1
)
UPDATE `contribution_accounts`
SET `employer_match_type` = 'none',
	`employer_match_value` = NULL,
	`employer_max_match_pct` = NULL
WHERE id IN (SELECT id FROM job_dupes WHERE rn > 1);--> statement-breakpoint

WITH person_dupes AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY `person_id`, `account_type`, `parent_category`
			ORDER BY id
		) AS rn
	FROM `contribution_accounts`
	WHERE `employer_match_type` <> 'none'
		AND `job_id` IS NULL
		AND `is_active` = 1
)
UPDATE `contribution_accounts`
SET `employer_match_type` = 'none',
	`employer_match_value` = NULL,
	`employer_max_match_pct` = NULL
WHERE id IN (SELECT id FROM person_dupes WHERE rn > 1);--> statement-breakpoint

CREATE UNIQUE INDEX `contribution_accounts_job_match_unq` ON `contribution_accounts` (`job_id`,`account_type`,`parent_category`) WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NOT NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_accounts_person_match_unq` ON `contribution_accounts` (`person_id`,`account_type`,`parent_category`) WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NULL AND "contribution_accounts"."is_active" = true;
