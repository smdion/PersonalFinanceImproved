-- A speculative job is a permanent, auto-provisioned peg for Salary Profiles
-- to pin what-if scenarios against (e.g. "moving to Chicago in 5 years") —
-- never a real job, and always excluded from "active job" logic everywhere
-- that means "this person's real, live job" (see findActiveJob/
-- filterActiveJobs in lib/pure/profiles.ts).
--
-- 1. Add the column + a partial unique index enforcing exactly one
--    speculative job per person as a DB-level invariant.
-- 2. Backfill: give every EXISTING person one, using the same fixed
--    placeholder values settings/paycheck.ts's people.create uses going
--    forward. The NOT EXISTS guard (plus the unique index as a backstop)
--    makes this idempotent — safe to re-run without creating duplicates.

ALTER TABLE "jobs" ADD COLUMN "is_speculative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_is_speculative_idx" ON "jobs" USING btree ("is_speculative");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_speculative_per_person_idx" ON "jobs" USING btree ("person_id") WHERE "jobs"."is_speculative" = true;--> statement-breakpoint

INSERT INTO "jobs" (
	"person_id", "employer_name", "annual_salary", "pay_period", "pay_week",
	"start_date", "w4_filing_status", "include_bonus_in_contributions",
	"is_speculative"
)
SELECT
	p."id", 'Speculative (What-If Planning)', '0', 'biweekly', 'na',
	CURRENT_DATE, 'Single', false, true
FROM "people" p
WHERE NOT EXISTS (
	SELECT 1 FROM "jobs" j
	WHERE j."person_id" = p."id" AND j."is_speculative" = true
);
