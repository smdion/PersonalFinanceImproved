-- A speculative job is a permanent, auto-provisioned peg for Salary Profiles
-- to pin what-if scenarios against. See
-- drizzle/0013_speculative_jobs.sql (Postgres) for the full rationale —
-- this is the SQLite mirror.

ALTER TABLE `jobs` ADD `is_speculative` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_is_speculative_idx` ON `jobs` (`is_speculative`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_one_speculative_per_person_idx` ON `jobs` (`person_id`) WHERE "jobs"."is_speculative" = true;--> statement-breakpoint

INSERT INTO `jobs` (
	`person_id`, `employer_name`, `annual_salary`, `pay_period`, `pay_week`,
	`start_date`, `w4_filing_status`, `include_bonus_in_contributions`,
	`is_speculative`
)
SELECT
	p.`id`, 'Speculative (What-If Planning)', '0', 'biweekly', 'na',
	CURRENT_DATE, 'Single', 0, 1
FROM `people` p
WHERE NOT EXISTS (
	SELECT 1 FROM `jobs` j
	WHERE j.`person_id` = p.`id` AND j.`is_speculative` = 1
);
