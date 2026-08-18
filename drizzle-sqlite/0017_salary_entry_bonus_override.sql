-- Backfill bonusOverride: null into every existing Salary Profile entry
-- that predates the field. SQLite twin of
-- drizzle/0017_salary_entry_bonus_override.sql (Postgres) — see that
-- file's header for the full rationale.
--
-- json_type(value, '$.bonusOverride') returns NULL only when the KEY is
-- absent (as opposed to json_extract, which also returns NULL when the
-- key is present with a JSON null value) — that distinction is what makes
-- the WHERE clause here idempotent.
UPDATE `salary_profiles`
SET `salaries` = (
	SELECT json_group_object(
		key,
		CASE
			WHEN json_type(value, '$.bonusOverride') IS NULL
				THEN json_set(value, '$.bonusOverride', json('null'))
			ELSE json(value)
		END
	)
	FROM json_each(`salary_profiles`.`salaries`)
)
WHERE EXISTS (
	SELECT 1
	FROM json_each(`salary_profiles`.`salaries`) AS already
	WHERE json_type(already.value, '$.bonusOverride') IS NULL
);
