-- Phase 2: jobs become pure structure — no base salary/bonus value of
-- their own. salary_changes (a dated ledger of real raises) becomes the
-- ONLY salary source; bonus terms only ever resolve from a Salary Profile
-- pin. See server/helpers/salary.ts's getCurrentSalary/resolveBonusTerms
-- docblocks for the resolution contract this backfill exists to preserve.

-- 1. Every job is guaranteed a salary_changes row AT OR BEFORE its
-- start_date before its annual_salary column disappears — preserves the
-- exact resolved value at every date the job already produced. A job
-- with raises recorded but none covering its true start (e.g. only
-- post-start raises were ever entered) still needs this: getCurrentSalary
-- resolves to 0 for any asOfDate before the earliest row, which would
-- silently zero out its actual starting salary otherwise. Jobs that
-- already have a row at or before start_date are untouched.
INSERT INTO "salary_changes" ("job_id", "effective_date", "new_salary", "notes")
SELECT j."id", j."start_date", j."annual_salary", 'Backfilled starting salary (Phase 2 migration)'
FROM "jobs" j
WHERE NOT EXISTS (
	SELECT 1 FROM "salary_changes" sc
	WHERE sc."job_id" = j."id" AND sc."effective_date" <= j."start_date"
);--> statement-breakpoint

-- 2. Every Salary Profile gets every REAL job's CURRENT bonus terms
-- backfilled into its salaries map, gaps-only per field — an existing pin
-- (on this field, for this job, in this profile) is never overwritten. This
-- freezes today's formula-implied bonus terms into an explicit,
-- later-editable pin so no number visibly changes the moment the live job
-- columns disappear. Speculative jobs (the auto-provisioned What-If peg,
-- see jobs.is_speculative) are excluded: a neutral {bonusPercent:0,
-- bonusMultiplier:1, monthsInBonusYear:12} pin still counts as "pinned" to
-- salaryProfile.getById's job-selection logic, which would make a
-- freshly-provisioned speculative job (sorted most-recent-first) outrank a
-- real job that started years ago as the row's displayed job.
WITH job_bonus_defaults AS (
	SELECT
		"id" AS job_id,
		jsonb_build_object(
			'bonusPercent', "bonus_percent"::float8,
			'bonusMultiplier', "bonus_multiplier"::float8,
			'monthsInBonusYear', "months_in_bonus_year"
		) AS defaults
	FROM "jobs"
	WHERE "is_speculative" = false
),
merged AS (
	SELECT
		sp."id" AS profile_id,
		jsonb_object_agg(
			jbd.job_id::text,
			COALESCE(sp."salaries" -> jbd.job_id::text, '{}'::jsonb) || (
				jbd.defaults - COALESCE(
					(
						SELECT array_agg(key)
						FROM jsonb_object_keys(COALESCE(sp."salaries" -> jbd.job_id::text, '{}'::jsonb)) AS key
					),
					ARRAY[]::text[]
				)
			)
		) AS new_salaries
	FROM "salary_profiles" sp
	CROSS JOIN job_bonus_defaults jbd
	GROUP BY sp."id"
)
UPDATE "salary_profiles" sp
SET "salaries" = m."new_salaries"
FROM merged m
WHERE sp."id" = m."profile_id";--> statement-breakpoint

-- 3. Backfill job_bonus_overrides for every (job, year) — from the job's
-- start year through its end year (or the current year, if still active) —
-- that doesn't already have a row, computed from that year's resolved
-- salary (most recent salary_changes at or before that year-end) and the
-- job's current bonus formula terms. This freezes today's formula-implied
-- history into transparent, later-editable per-year facts, matching
-- historical.ts's override-only reconstruction (no formula fallback once
-- the job columns are gone — see that file's per-year loop). Skipped for
-- jobs with no bonus percent at all — nothing to reconstruct, and $0 rows
-- for every non-bonus job/year would just be clutter (historical.ts already
-- reports 0 for a year with no override row).
INSERT INTO "job_bonus_overrides" ("job_id", "year", "override_amount", "notes")
SELECT
	j."id",
	y."year",
	ROUND(
		(
			SELECT sc."new_salary"
			FROM "salary_changes" sc
			WHERE sc."job_id" = j."id" AND sc."effective_date" <= make_date(y."year", 12, 31)
			ORDER BY sc."effective_date" DESC
			LIMIT 1
		) * j."bonus_percent" * j."bonus_multiplier" * (j."months_in_bonus_year"::numeric / 12),
		2
	),
	'Backfilled from formula (Phase 2 migration)'
FROM "jobs" j
CROSS JOIN LATERAL generate_series(
	EXTRACT(YEAR FROM j."start_date")::int,
	EXTRACT(YEAR FROM COALESCE(j."end_date", CURRENT_DATE))::int
) AS y("year")
WHERE j."bonus_percent" > 0
	AND NOT EXISTS (
		SELECT 1 FROM "job_bonus_overrides" jbo
		WHERE jbo."job_id" = j."id" AND jbo."year" = y."year"
	)
	AND EXISTS (
		SELECT 1 FROM "salary_changes" sc
		WHERE sc."job_id" = j."id" AND sc."effective_date" <= make_date(y."year", 12, 31)
	);--> statement-breakpoint

-- 4. A job carries no salary/bonus of its own from here on.
ALTER TABLE "jobs" DROP COLUMN "annual_salary";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "bonus_percent";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "bonus_multiplier";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "months_in_bonus_year";
