-- Stage A (see .claude/plans, "One rule for every profile"): retirement_settings.filing_status
-- becomes NOT NULL. build-engine-payload.ts's job-facts fallback tier
-- (settings.filingStatus ?? job.w4FilingStatus ?? "MFJ") stays in place until every
-- household is confirmed backfilled, but no new row can be inserted without an explicit
-- value from here on (see retirement.ts's retirementSettings.upsert, which now resolves
-- "auto" requests to a concrete value before writing, the same way this backfill does).

-- 1. Every row missing a filing status gets the OWNING person's own active,
-- non-speculative job's W-4 filing status, or 'MFJ' if that person currently
-- has no such job (matches the app's own existing read-time fallback order).
UPDATE "retirement_settings" rs
SET "filing_status" = COALESCE(
	(
		SELECT j."w4_filing_status"
		FROM "jobs" j
		WHERE j."person_id" = rs."person_id"
			AND j."end_date" IS NULL
			AND j."is_speculative" = false
		ORDER BY j."id"
		LIMIT 1
	),
	'MFJ'
)
WHERE rs."filing_status" IS NULL;--> statement-breakpoint

-- 2. Column is reliably non-null for every household from here on.
ALTER TABLE "retirement_settings" ALTER COLUMN "filing_status" SET NOT NULL;
