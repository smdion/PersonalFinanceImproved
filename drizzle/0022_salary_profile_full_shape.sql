-- Stage B: Salary Profile entries grow from 5 fields to the full 16-field
-- shape — pay schedule (payPeriod/payWeek/anchorPayDate/
-- budgetPeriodsPerMonth), W-4 elections (w4FilingStatus/w4Box2cChecked/
-- additionalFedWithholding), and bonus pay date/flags (bonusMonth/
-- bonusDayOfMonth/include401kInBonus/includeBonusInContributions) all move
-- off `jobs` and into salary_profiles.salaries's per-job entry — the same
-- axis salary/bonus terms already live on (see salaryEntrySchema in
-- json-schemas.ts). The Contribution Profile's `jobs` active-fields bucket
-- (which used to own employerName/bonus-date/bonus-flags overrides) is
-- deleted wholesale — no profile-override path for employerName any more,
-- an accepted feature reduction (see RULES.md's Salary Profile layer
-- section). `paycheck_deductions.amount_per_period` also drops — a
-- deduction's dollar amount now resolves ONLY via a Contribution Profile's
-- `deductions` active-field entry, mirroring how contributionValue already
-- works for contribution accounts (no base-value fallback).
--
-- Backfill-then-drop in one file, same precedent as
-- drizzle/0014_salary_no_base_value.sql — there is no safe intermediate
-- state to deploy between the schema change and its backfill, since
-- salaryEntrySchema's `.strict()` can't parse an old partial entry.
--
-- Backfill decisions below are human-reviewed against the real row counts
-- (see the plan's Ground Rules), not an automated blanket rule:
--
-- 1. salary_profiles.salaries: a profile with ANY existing entries is
--    treated as deliberately curated and left untouched (e.g. a profile
--    that intentionally models only a subset of jobs). Only a profile with
--    ZERO entries gets every non-speculative job's raw column values
--    synthesized into a complete entry. Ended (non-active) jobs missing an
--    entry have no live calculation impact either way — findActiveJob/
--    filterActiveJobs already exclude them everywhere — so this is a
--    visibility/completeness backfill, not a load-bearing one. The
--    synthesized entry's salary/bonusPercent/bonusMultiplier/
--    monthsInBonusYear/bonusOverride have no raw source left on `jobs`
--    (Phase 2's 0014 migration already removed those columns) — synthesized
--    as the neutral "profile says nothing about compensation for this job"
--    values (0/0/1/12/null), same meaning as a job absent from the profile
--    entirely, everywhere else in this codebase.
-- 2. paycheck_deductions → Contribution Profile deductions bucket: gaps-only
--    per deduction id, into EVERY Contribution Profile (unlike salary
--    profiles, there's no existing-entries curation signal here — the
--    `deductions` bucket is brand new to every profile, so every profile
--    gets every deduction's live amount as its starting point, still
--    editable afterward like every other active field).
-- 3. jobs.extra_paycheck_routing: gaps-only backfill of payPeriod/
--    anchorPayDate into the routing blob — mostly redundant after Stage A's
--    snapshot-at-save-time change, but load-bearing for any row saved
--    before that shipped.
-- 4. retirement_settings.filing_status backfill is Stage A's job, already
--    done and NOT NULL (drizzle/0021) — nothing left to do here.

-- 1a. Backfill zero-entry Salary Profiles only (see decision 1 above).
-- COALESCE guards a DB with a profile but zero non-speculative jobs
-- (fresh install, some test fixtures) — jsonb_object_agg over an empty set
-- is NULL, and salaries is NOT NULL.
UPDATE "salary_profiles" sp
SET "salaries" = COALESCE(
	(
		SELECT jsonb_object_agg(
			j."id"::text,
			jsonb_build_object(
				'salary', 0,
				'bonusPercent', 0,
				'bonusMultiplier', 1,
				'monthsInBonusYear', 12,
				'bonusOverride', NULL,
				'payPeriod', j."pay_period",
				'payWeek', j."pay_week",
				'anchorPayDate', j."anchor_pay_date",
				'budgetPeriodsPerMonth', j."budget_periods_per_month"::float8,
				'w4FilingStatus', j."w4_filing_status",
				'w4Box2cChecked', j."w4_box2c_checked",
				'additionalFedWithholding', j."additional_fed_withholding"::float8,
				'bonusMonth', j."bonus_month",
				'bonusDayOfMonth', j."bonus_day_of_month",
				'include401kInBonus', j."include_401k_in_bonus",
				'includeBonusInContributions', j."include_bonus_in_contributions"
			)
		)
		FROM "jobs" j
		WHERE j."is_speculative" = false
	),
	'{}'::jsonb
)
WHERE sp."salaries" = '{}'::jsonb;--> statement-breakpoint

-- 1b. Non-empty profiles: salaryEntrySchema is `.strict()` with all 16
-- fields required — an existing entry left in the old 5-field shape fails
-- to parse the instant this migration commits, and by then the raw `jobs`
-- columns it would need are gone. Upgrade every EXISTING entry (by job id
-- already present in this profile's map) to the full shape; do NOT add
-- entries for jobs this profile doesn't already mention — that's the real
-- curation signal (see decision 1), preserved here by only ever touching
-- keys already present via the `jsonb_each`/JOIN. `||` on jsonb is a
-- shallow merge with the right operand winning on key conflict, but none of
-- these 11 keys can already exist on a pre-Stage-B entry (the old schema
-- was `.strict()` too), so this is a pure additive merge, not an overwrite.
UPDATE "salary_profiles" sp
SET "salaries" = (
	SELECT jsonb_object_agg(
		entry.key,
		entry.value || jsonb_build_object(
			'payPeriod', j."pay_period",
			'payWeek', j."pay_week",
			'anchorPayDate', j."anchor_pay_date",
			'budgetPeriodsPerMonth', j."budget_periods_per_month"::float8,
			'w4FilingStatus', j."w4_filing_status",
			'w4Box2cChecked', j."w4_box2c_checked",
			'additionalFedWithholding', j."additional_fed_withholding"::float8,
			'bonusMonth', j."bonus_month",
			'bonusDayOfMonth', j."bonus_day_of_month",
			'include401kInBonus', j."include_401k_in_bonus",
			'includeBonusInContributions', j."include_bonus_in_contributions"
		)
	)
	FROM jsonb_each(sp."salaries") AS entry(key, value)
	JOIN "jobs" j ON j."id"::text = entry.key
)
WHERE sp."salaries" != '{}'::jsonb;--> statement-breakpoint

-- 2. Backfill paycheck_deductions into every Contribution Profile's
-- deductions bucket, gaps-only per deduction id (see decision 2 above) —
-- same gaps-only merge idiom as 0014's job_bonus_defaults backfill.
WITH deduction_defaults AS (
	SELECT
		cp."id" AS profile_id,
		jsonb_object_agg(
			d."id"::text,
			jsonb_build_object('amountPerPeriod', d."amount_per_period"::text)
		) AS defaults
	FROM "contribution_profiles" cp
	CROSS JOIN "paycheck_deductions" d
	GROUP BY cp."id"
),
merged AS (
	SELECT
		dd.profile_id,
		jsonb_set(
			cp."contribution_active_fields",
			'{deductions}',
			COALESCE(cp."contribution_active_fields" -> 'deductions', '{}'::jsonb) || (
				dd.defaults - COALESCE(
					(
						SELECT array_agg(key)
						FROM jsonb_object_keys(
							COALESCE(cp."contribution_active_fields" -> 'deductions', '{}'::jsonb)
						) AS key
					),
					ARRAY[]::text[]
				)
			),
			true
		) AS new_active_fields
	FROM deduction_defaults dd
	JOIN "contribution_profiles" cp ON cp."id" = dd.profile_id
)
UPDATE "contribution_profiles" cp
SET "contribution_active_fields" = m."new_active_fields"
FROM merged m
WHERE cp."id" = m.profile_id;--> statement-breakpoint

-- 2b. Cleanup: strip any leftover `jobs` key from contribution_active_fields
-- — the bucket no longer exists in the app schema (contributionActiveFieldsSchema
-- in json-schemas.ts), so a stale key here would just be inert dead weight.
UPDATE "contribution_profiles"
SET "contribution_active_fields" = "contribution_active_fields" - 'jobs'
WHERE "contribution_active_fields" ? 'jobs';--> statement-breakpoint

-- 3. Backfill payPeriod/anchorPayDate into every existing
-- extra_paycheck_routing blob, gaps-only (see decision 3 above).
UPDATE "jobs" j
SET "extra_paycheck_routing" = j."extra_paycheck_routing" || (
	jsonb_build_object('payPeriod', j."pay_period", 'anchorPayDate', j."anchor_pay_date")
	- COALESCE(
			(
				SELECT array_agg(key)
				FROM jsonb_object_keys(j."extra_paycheck_routing") AS key
				WHERE key IN ('payPeriod', 'anchorPayDate')
			),
			ARRAY[]::text[]
		)
)
WHERE j."extra_paycheck_routing" IS NOT NULL;--> statement-breakpoint

-- 5. Only now: drop the columns that moved to salary_profiles.salaries.
ALTER TABLE "jobs" DROP COLUMN "pay_period";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "pay_week";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "anchor_pay_date";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "include_401k_in_bonus";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "include_bonus_in_contributions";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "bonus_month";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "bonus_day_of_month";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "w4_filing_status";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "w4_box2c_checked";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "additional_fed_withholding";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "budget_periods_per_month";--> statement-breakpoint
ALTER TABLE "paycheck_deductions" DROP COLUMN "amount_per_period";
