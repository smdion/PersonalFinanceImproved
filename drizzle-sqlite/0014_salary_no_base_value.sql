-- Phase 2: jobs become pure structure — no base salary/bonus value of
-- their own. See drizzle/0014_salary_no_base_value.sql (Postgres) for the
-- full rationale — this is the SQLite mirror, using json_patch (RFC 7396
-- merge-patch semantics) instead of Postgres's `||` jsonb-concat, and
-- json_group_object/json_each instead of jsonb_object_agg/jsonb_each.

-- 1. Every job is guaranteed a salary_changes row AT OR BEFORE its
-- start_date — see drizzle/0014_salary_no_base_value.sql (Postgres) for
-- why "has any row" isn't sufficient.
INSERT INTO `salary_changes` (`job_id`, `effective_date`, `new_salary`, `notes`)
SELECT j.`id`, j.`start_date`, j.`annual_salary`, 'Backfilled starting salary (Phase 2 migration)'
FROM `jobs` j
WHERE NOT EXISTS (
	SELECT 1 FROM `salary_changes` sc
	WHERE sc.`job_id` = j.`id` AND sc.`effective_date` <= j.`start_date`
);--> statement-breakpoint

-- 2. Every Salary Profile gets every REAL job's CURRENT bonus terms
-- backfilled into its salaries map, gaps-only per field — an existing pin
-- is never overwritten (the CASE branches below re-apply the existing
-- value whenever one is already present, so json_patch is a no-op for that
-- field). Speculative jobs are excluded — see drizzle/0014_salary_no_base_value.sql
-- (Postgres) for why a neutral pin there breaks getById's job-selection logic.
UPDATE `salary_profiles`
SET `salaries` = json((
	SELECT COALESCE(
		json_group_object(
			j.`id`,
			json_patch(
				COALESCE(json_extract(`salary_profiles`.`salaries`, '$."' || j.`id` || '"'), '{}'),
				json_object(
					'bonusPercent',
					COALESCE(
						json_extract(`salary_profiles`.`salaries`, '$."' || j.`id` || '".bonusPercent'),
						CAST(j.`bonus_percent` AS REAL)
					),
					'bonusMultiplier',
					COALESCE(
						json_extract(`salary_profiles`.`salaries`, '$."' || j.`id` || '".bonusMultiplier'),
						CAST(j.`bonus_multiplier` AS REAL)
					),
					'monthsInBonusYear',
					COALESCE(
						json_extract(`salary_profiles`.`salaries`, '$."' || j.`id` || '".monthsInBonusYear'),
						j.`months_in_bonus_year`
					)
				)
			)
		),
		'{}'
	)
	FROM `jobs` j
	WHERE j.`is_speculative` = 0
));--> statement-breakpoint

-- 3. Backfill job_bonus_overrides for every (job, year) that doesn't
-- already have one — see drizzle/0014_salary_no_base_value.sql (Postgres)
-- for the full rationale. SQLite has no generate_series/LATERAL, so years
-- are enumerated via a recursive CTE spanning every job's earliest start
-- through today, then filtered down to each job's own active range.
INSERT INTO `job_bonus_overrides` (`job_id`, `year`, `override_amount`, `notes`)
WITH RECURSIVE all_years(year) AS (
	SELECT CAST(strftime('%Y', (SELECT MIN(`start_date`) FROM `jobs`)) AS INTEGER)
	UNION ALL
	SELECT year + 1 FROM all_years WHERE year < CAST(strftime('%Y', 'now') AS INTEGER)
)
SELECT
	j.`id`,
	ay.year,
	ROUND(
		(
			SELECT sc.`new_salary`
			FROM `salary_changes` sc
			WHERE sc.`job_id` = j.`id` AND sc.`effective_date` <= (ay.year || '-12-31')
			ORDER BY sc.`effective_date` DESC
			LIMIT 1
		) * j.`bonus_percent` * j.`bonus_multiplier` * (j.`months_in_bonus_year` / 12.0),
		2
	),
	'Backfilled from formula (Phase 2 migration)'
FROM `jobs` j
JOIN all_years ay
	ON ay.year >= CAST(strftime('%Y', j.`start_date`) AS INTEGER)
	AND ay.year <= CAST(strftime('%Y', COALESCE(j.`end_date`, 'now')) AS INTEGER)
WHERE j.`bonus_percent` > 0
	AND NOT EXISTS (
		SELECT 1 FROM `job_bonus_overrides` jbo
		WHERE jbo.`job_id` = j.`id` AND jbo.`year` = ay.year
	)
	AND EXISTS (
		SELECT 1 FROM `salary_changes` sc
		WHERE sc.`job_id` = j.`id` AND sc.`effective_date` <= (ay.year || '-12-31')
	);--> statement-breakpoint

-- 4. A job carries no salary/bonus of its own from here on.
ALTER TABLE `jobs` DROP COLUMN `annual_salary`;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `bonus_percent`;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `bonus_multiplier`;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `months_in_bonus_year`;
