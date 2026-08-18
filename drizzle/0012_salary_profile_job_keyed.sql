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
);
