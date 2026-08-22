-- Moves extraPaycheckRouting off `jobs.extra_paycheck_routing` and onto the
-- Salary Profile entry that already owns pay schedule/W-4/bonus-timing
-- (see salaryEntrySchema in json-schemas.ts) — this was supposed to move in
-- 0022_salary_profile_full_shape.sql alongside those other fields but was
-- deferred a session. It's the same category of fact as the
-- include401kInBonus/includeBonusInContributions flags already on this
-- entry: a comp-layer routing decision, not a job identity fact, and
-- leaving it on `jobs` violated the same "complete profile, no external
-- silent default" principle that motivated the rest of Stage B.
--
-- Backfill-then-drop in one file, same precedent as 0022/0014 — there is no
-- safe intermediate state to deploy between the schema change and its
-- backfill, since salaryEntrySchema's `.strict()` can't parse an entry
-- missing the new required field once the app code ships.
--
-- Backfill decision (verified against dev_ledgr's real data before writing
-- this file — see the session's report):
--
--   Exactly one Salary Profile exists ("YNAB Salary", id 1) and it already
--   has entries for both jobs (12, 13) that carry live extra_paycheck_routing
--   data on `jobs` today. Gaps-only, curation-preserving backfill — same
--   rule as 0022's salary_profiles backfill: only touch entries a profile
--   ALREADY has (via the jsonb_each/JOIN below), never synthesize a new
--   entry for a job the profile doesn't mention. Every touched entry gets
--   `extraPaycheckRouting` set to that job's current
--   jobs.extra_paycheck_routing value, or JSON null when the job has none —
--   the field must be present on every entry (salaryEntrySchema requires it
--   unconditionally), so "no routing configured" has to be an explicit null,
--   not an absent key.
-- LEFT JOIN, not JOIN: an entry can outlive its job (settings/paycheck.ts's
-- job-delete path doesn't prune salary_profiles.salaries), and an inner
-- join would silently drop that entry from the rebuilt object — on
-- Postgres, jsonb_object_agg over an all-orphan profile returns NULL
-- against a NOT NULL column and the migration aborts; the SQLite twin
-- would instead silently wipe such a profile to '{}' with no error at
-- all. Safe here specifically because the only field being written is
-- nullable: an orphaned entry's missing job just means
-- COALESCE(...,'null'::jsonb) → JSON null, the correct "no routing"
-- value under extraPaycheckRoutingSchema's `.nullable()`.
UPDATE "salary_profiles" sp
SET "salaries" = (
	SELECT jsonb_object_agg(
		entry.key,
		entry.value || jsonb_build_object(
			'extraPaycheckRouting',
			COALESCE(j."extra_paycheck_routing", 'null'::jsonb)
		)
	)
	FROM jsonb_each(sp."salaries") AS entry(key, value)
	LEFT JOIN "jobs" j ON j."id"::text = entry.key
)
WHERE sp."salaries" != '{}'::jsonb;--> statement-breakpoint

-- Only now: drop the column that moved to salary_profiles.salaries.
ALTER TABLE "jobs" DROP COLUMN "extra_paycheck_routing";
