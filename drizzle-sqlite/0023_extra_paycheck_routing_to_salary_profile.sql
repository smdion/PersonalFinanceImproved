-- Hand-written SQLite twin of
-- drizzle/0023_extra_paycheck_routing_to_salary_profile.sql — see that file
-- for the full rationale. Same gaps-only, curation-preserving backfill
-- (json_set, not json_patch — a JSON null value is a real, legitimate
-- "no routing configured" state here, and json_patch's RFC7396 merge-patch
-- would delete a null leaf instead of setting it, same lesson as 0022),
-- then the standard table-rebuild to drop the column (no ALTER TABLE DROP
-- COLUMN in this repo's SQLite migration convention — see 0021/0022).

-- LEFT JOIN, not JOIN — same reason as the Postgres file: an entry can
-- outlive its job, and dropping it here would silently wipe an all-orphan
-- profile to '{}' with no error (unlike Postgres, where the NOT NULL
-- constraint on salaries would at least abort the migration loudly).
-- CAST(j.`id` AS TEXT) = je.key, not CAST(je.key AS INTEGER) = j.`id` —
-- SQLite's numeric CAST is lenient (e.g. CAST('012abc' AS INTEGER) = 12,
-- CAST('foo' AS INTEGER) = 0), so comparing as text is what actually
-- matches the Postgres file's `j."id"::text = entry.key` semantics exactly.
UPDATE `salary_profiles`
SET `salaries` = (
	SELECT json_group_object(
		je.key,
		json_set(
			je.value,
			'$.extraPaycheckRouting',
			json(COALESCE(j.`extra_paycheck_routing`, 'null'))
		)
	)
	FROM json_each(salary_profiles.`salaries`) AS je
	LEFT JOIN `jobs` j ON CAST(j.`id` AS TEXT) = je.key
)
WHERE `salaries` != '{}';--> statement-breakpoint

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`employer_name` text NOT NULL,
	`title` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`is_speculative` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_jobs`(
	"id", "person_id", "employer_name", "title", "start_date", "end_date",
	"is_speculative"
)
SELECT
	"id", "person_id", "employer_name", "title", "start_date", "end_date",
	"is_speculative"
FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_person_id_idx` ON `jobs` (`person_id`);--> statement-breakpoint
CREATE INDEX `jobs_is_speculative_idx` ON `jobs` (`is_speculative`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_one_speculative_per_person_idx` ON `jobs` (`person_id`) WHERE "jobs"."is_speculative" = true;--> statement-breakpoint
PRAGMA foreign_keys=ON;
