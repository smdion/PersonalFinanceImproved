-- Backfill bonusOverride: null into every existing Salary Profile entry
-- that predates the field — see SalaryProfileEntry.bonusOverride's
-- docblock (server/helpers/salary.ts). An entry missing the key is
-- functionally "no override" already (resolveCompensation normalizes
-- the absent key to null on read); this migration just makes storage
-- match the strict schema so a future edit to any OTHER field on the
-- same entry doesn't fail validation for a field it never touched.
--
-- IDEMPOTENCY: the WHERE clause only fires when at least one entry in
-- the row is missing the key — once backfilled, replaying is a no-op.
UPDATE "salary_profiles" sp
SET "salaries" = (
	SELECT jsonb_object_agg(
		e.key,
		CASE
			WHEN e.value ? 'bonusOverride' THEN e.value
			ELSE e.value || jsonb_build_object('bonusOverride', 'null'::jsonb)
		END
	)
	FROM jsonb_each(sp."salaries") AS e
)
WHERE EXISTS (
	SELECT 1
	FROM jsonb_each(sp."salaries") AS already
	WHERE NOT (already.value ? 'bonusOverride')
);
