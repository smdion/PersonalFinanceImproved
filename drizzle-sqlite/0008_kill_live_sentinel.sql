-- Kill the "Live" sentinel. SQLite twin of drizzle/0008_kill_live_sentinel.sql
-- — see that file's header for the full rationale, including which columns'
-- NULLs mean "use Live" (backfilled here) and which mean "pins nothing"
-- (deliberately untouched: scenarios.*, retirement_salary_overrides.*,
-- budget_profiles.column_*_profile_ids).

-- 1. salary_profiles.salary_overrides -> salaries (rename only; reshaped next).
ALTER TABLE `salary_profiles` RENAME COLUMN `salary_overrides` TO `salaries`;--> statement-breakpoint

-- 2. Reshape every existing profile's map from the old sparse
--    Record<personId, number> into the new complete
--    Record<personId, {mode:"job"} | {mode:"fixed", salary}>. json_object()
--    values keep their JSON subtype through json_group_object, so these nest
--    as objects rather than being re-quoted as strings.
--
-- IDEMPOTENCY GUARD: see drizzle/0008_kill_live_sentinel.sql (Postgres) for
-- the full rationale. The pre-0008 shape stores a bare NUMBER per pinned
-- person; every shape this migration or a later one produces stores an
-- OBJECT instead, so a bare-number value (or an empty map) is the only
-- safe trigger to re-run — checking whether keys resolve to a person
-- would wrongly re-trigger on later, job-keyed shapes.
UPDATE `salary_profiles`
SET `salaries` = COALESCE(
	(
		SELECT json_group_object(
			CAST(p.`id` AS TEXT),
			CASE
				WHEN json_extract(`salary_profiles`.`salaries`, '$."' || p.`id` || '"') IS NOT NULL
					THEN json_object('mode', 'fixed', 'salary', json_extract(`salary_profiles`.`salaries`, '$."' || p.`id` || '"'))
				ELSE json_object('mode', 'job')
			END
		)
		FROM `people` p
	),
	'{}'
)
WHERE `salary_profiles`.`salaries` = '{}'
	OR EXISTS (
		SELECT 1
		FROM json_each(`salary_profiles`.`salaries`) AS already
		WHERE json_type(already.value) IN ('integer', 'real')
	);--> statement-breakpoint

-- 3. Seed the ordinary profile that replaces the synthetic "Live" entry:
--    every person follows their job record. `name` is unique, so pick the
--    first free candidate; if all are taken the NOT NULL constraint fails
--    loudly rather than silently skipping the seed.
INSERT INTO `salary_profiles` (`name`, `description`, `salaries`)
SELECT
	(
		SELECT c.candidate FROM (
			          SELECT 'Current' AS candidate, 1 AS ord
			UNION ALL SELECT 'Current (2)', 2
			UNION ALL SELECT 'Current (3)', 3
			UNION ALL SELECT 'Current (4)', 4
			UNION ALL SELECT 'Current (5)', 5
		) c
		WHERE NOT EXISTS (
			SELECT 1 FROM `salary_profiles` existing WHERE existing.`name` = c.candidate
		)
		ORDER BY c.ord
		LIMIT 1
	),
	'Every salary follows its job record',
	COALESCE(
		(SELECT json_group_object(CAST(p.`id` AS TEXT), json_object('mode', 'job')) FROM `people` p),
		'{}'
	);--> statement-breakpoint

-- 4. Point app_settings.active_salary_profile_id at the row just seeded
--    (highest id — nothing else inserts into this table in between) wherever
--    it is currently absent, JSON null, or the old 0 sentinel. An existing
--    real id is left alone. Stored as TEXT: the column is a json-mode text
--    column, so the value has to round-trip through JSON.parse.
INSERT INTO `app_settings` (`key`, `value`)
VALUES ('active_salary_profile_id', CAST((SELECT MAX(`id`) FROM `salary_profiles`) AS TEXT))
ON CONFLICT(`key`) DO UPDATE
	SET `value` = excluded.`value`
	WHERE `app_settings`.`value` IS NULL
		OR `app_settings`.`value` = 'null'
		OR `app_settings`.`value` = '0';--> statement-breakpoint

-- 5. Contribution Profiles: do NOT insert alongside existing rows — the
--    former is_default row already carries the right contents and the right
--    id. Seed one ONLY when the table is empty (a fresh install).
INSERT INTO `contribution_profiles` (`name`, `description`, `contribution_overrides`)
SELECT 'Current', 'Contribution settings as they stand', '{}'
WHERE NOT EXISTS (SELECT 1 FROM `contribution_profiles`);--> statement-breakpoint

-- 6. Point app_settings.active_contrib_profile_id at the former default row
--    (falling back to the oldest profile when none was flagged). Must run
--    before the DROP COLUMN below, which is what this ORDER BY reads.
INSERT INTO `app_settings` (`key`, `value`)
VALUES (
	'active_contrib_profile_id',
	CAST((
		SELECT `id` FROM `contribution_profiles`
		ORDER BY `is_default` DESC, `created_at` ASC, `id` ASC
		LIMIT 1
	) AS TEXT)
)
ON CONFLICT(`key`) DO UPDATE
	SET `value` = excluded.`value`
	WHERE `app_settings`.`value` IS NULL
		OR `app_settings`.`value` = 'null'
		OR `app_settings`.`value` = '0';--> statement-breakpoint

-- 7. The flag itself. Every former-default row survives as an ordinary,
--    renamable, editable profile.
ALTER TABLE `contribution_profiles` DROP COLUMN `is_default`;
