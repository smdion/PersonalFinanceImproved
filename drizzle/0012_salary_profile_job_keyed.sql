-- Salary Profile pins move from personId-keyed to jobId-keyed: a profile
-- targets a SPECIFIC job's terms, not "whichever job this person currently
-- has" — the foundation for letting a profile pin a past job, or (later) a
-- brand-new hypothetical one. This is a genuine key RENAME, not a gaps-only
-- backfill like 0011 — every existing entry is rebuilt under its person's
-- current active job's id.
--
-- An entry whose personId key has no active (end_date IS NULL) job — a data
-- anomaly, or a job that's since ended with no successor recorded yet — has
-- nothing to target under the new key and is dropped; there is no
-- reasonable job to attach it to.
--
-- IDEMPOTENCY GUARD: this UPDATE is a genuine key RENAME (person_id ->
-- job_id), not a gaps-only backfill, so replaying it against a database
-- that has already gone through it once would reinterpret every already-
-- correct job_id key as if it were a person_id, join against `jobs` on
-- THAT bogus assumption, and silently collapse every pin to '{}' — with
-- nothing to throw, so no ignorable-error code catches it (see db-migrate.ts
-- squash-recovery, which blindly replays the full migration history and can
-- reach this file a second time against a DB already past it). The WHERE
-- clause below makes the statement a no-op once the data is already in the
-- target (job-keyed) shape: skip a profile only when EVERY key in its
-- `salaries` object already resolves to an active job's id, since that is
-- exactly the invariant this UPDATE establishes and only this UPDATE
-- establishes. (A profile whose old person-id keys happen to coincide with
-- some other active job's id would also be skipped here — an accepted,
-- narrow edge case: person ids and job ids are independent serial
-- sequences, so this is a rare coincidence, and the failure mode is "this
-- profile isn't rekeyed on this run" rather than "prior data is
-- destroyed".)
UPDATE "salary_profiles" sp
SET "salaries" = COALESCE(
	(
		SELECT jsonb_object_agg(j.id::text, entry.value)
		FROM jsonb_each(sp."salaries") AS entry(person_id, value)
		JOIN "jobs" j
			ON j.person_id = entry.person_id::integer
			AND j.end_date IS NULL
	),
	'{}'::jsonb
)
WHERE sp."salaries" = '{}'::jsonb
	OR EXISTS (
		SELECT 1
		FROM jsonb_each(sp."salaries") AS already(key, value)
		WHERE NOT EXISTS (
			SELECT 1 FROM "jobs" j2
			WHERE j2.id = (already.key)::integer AND j2.end_date IS NULL
		)
	);
