-- Kill the "Live" sentinel.
--
-- Two things that used to be expressed as sentinels become real rows:
--   * Salary Profiles had no "no override" row — id 0 was synthesized by the
--     router. Now every profile is a real row whose `salaries` map holds an
--     ENTRY for every person: {mode:"job"} (follow the job record) or
--     {mode:"fixed", salary}. Only fixed entries ever pin a number.
--   * Contribution Profiles had an `is_default` flag marking an immutable
--     "Live" row. The flag is dropped; the row itself is KEPT, id and
--     contents intact, so every Plan pin / setting that already references
--     it stays valid.
--
-- NULL means two different things in this schema and this migration must not
-- collapse them:
--   * app_settings.active_salary_profile_id / active_contrib_profile_id:
--     null/absent/0 used to mean "use Live". Backfilled below to a real id;
--     after this migration these must never be null again.
--   * scenarios.salary_profile_id / .contribution_profile_id,
--     retirement_salary_overrides.salary_profile_id / .contribution_profile_id,
--     and the elements of budget_profiles.column_salary_profile_ids /
--     .column_contribution_profile_ids: null means "this Plan/column pins
--     NOTHING and falls through to whatever is globally active". Those are
--     deliberately left untouched — rewriting them to the seeded id would
--     silently convert "no pin" into "pinned to baseline" for every existing
--     Plan and budget column.
--
-- Order matters: every INSERT/UPDATE that reads is_default runs before the
-- DROP COLUMN at the end.

-- 1. salary_profiles.salary_overrides -> salaries (rename only; reshaped next).
ALTER TABLE "salary_profiles" RENAME COLUMN "salary_overrides" TO "salaries";--> statement-breakpoint

-- 2. Reshape every existing profile's map from the old sparse
--    Record<personId, number> into the new complete
--    Record<personId, {mode:"job"} | {mode:"fixed", salary}>. A person who
--    had an entry was explicitly pinned -> fixed; everyone else follows their
--    job. People with no rows at all (fresh DB) leave an empty map.
--
-- IDEMPOTENCY GUARD: this UPDATE reinterprets every key in `salaries` as a
-- personId and rebuilds the map from `people` — replaying it against a
-- database that has already moved past this shape (e.g. already rekeyed to
-- jobId by 0012, or already holding complete entries) would misread those
-- keys as personIds, find no pin for any of them, and silently collapse
-- every entry to {mode:"job"}, discarding real data with nothing to throw
-- (see 0012's identical guard and rationale — this is the same class of bug,
-- caught by the same squash-recovery blind-replay scenario). The WHERE
-- clause is a no-op once the data is no longer in the shape this statement
-- consumes: the pre-0008 shape is "old sparse Record<personId, number>" per
-- the comment above — a pinned entry's VALUE is a bare number. Every shape
-- this migration or any later one produces stores an OBJECT value instead
-- (this statement's own {mode:...}, 0009's {salary:...}, or a later
-- complete entry) — a bare-number value can only exist pre-migration, so
-- its presence (or an empty map) is the only safe trigger to run. Unlike
-- the first guard attempt, this does not depend on keys resolving to a
-- person — later shapes key by jobId, which would also fail that check and
-- wrongly re-trigger.
UPDATE "salary_profiles" sp
SET "salaries" = COALESCE(
	(
		SELECT jsonb_object_agg(
			p."id"::text,
			CASE
				WHEN sp."salaries" ? p."id"::text
					THEN jsonb_build_object('mode', 'fixed', 'salary', sp."salaries" -> p."id"::text)
				ELSE jsonb_build_object('mode', 'job')
			END
		)
		FROM "people" p
	),
	'{}'::jsonb
)
WHERE sp."salaries" = '{}'::jsonb
	OR EXISTS (
		SELECT 1
		FROM jsonb_each(sp."salaries") AS already(key, value)
		WHERE jsonb_typeof(already.value) = 'number'
	);--> statement-breakpoint

-- 3. Seed the ordinary profile that replaces the synthetic "Live" entry:
--    every person follows their job record. `name` is unique, so pick the
--    first free candidate. If all candidates are taken the NOT NULL
--    constraint fails loudly rather than silently skipping the seed.
--    4. Point app_settings.active_salary_profile_id at it wherever it is
--    currently absent, JSON null, or the old 0 sentinel. An existing real id
--    is left alone.
WITH seeded AS (
	INSERT INTO "salary_profiles" ("name", "description", "salaries")
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
				SELECT 1 FROM "salary_profiles" existing WHERE existing."name" = c.candidate
			)
			ORDER BY c.ord
			LIMIT 1
		),
		'Every salary follows its job record',
		COALESCE(
			(SELECT jsonb_object_agg(p."id"::text, jsonb_build_object('mode', 'job')) FROM "people" p),
			'{}'::jsonb
		)
	RETURNING "id"
)
INSERT INTO "app_settings" ("key", "value")
SELECT 'active_salary_profile_id', to_jsonb(seeded."id") FROM seeded
ON CONFLICT ("key") DO UPDATE
	SET "value" = EXCLUDED."value"
	WHERE jsonb_typeof("app_settings"."value") = 'null'
		OR "app_settings"."value" = to_jsonb(0);--> statement-breakpoint

-- 5. Contribution Profiles: do NOT insert alongside existing rows — the
--    former is_default row already carries the right contents and the right
--    id. Seed one ONLY when the table is empty (a fresh install, where the
--    synthetic id-0 row used to stand in), so the active-profile setting
--    always has a real row to name.
INSERT INTO "contribution_profiles" ("name", "description", "contribution_overrides")
SELECT 'Current', 'Contribution settings as they stand', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "contribution_profiles");--> statement-breakpoint

-- 6. Point app_settings.active_contrib_profile_id at the former default row
--    (falling back to the oldest profile when no row was flagged), on the
--    same absent/null/0 condition as the salary axis. Must run before the
--    DROP COLUMN below, which is what this ORDER BY reads.
INSERT INTO "app_settings" ("key", "value")
SELECT 'active_contrib_profile_id', to_jsonb(cp."id")
FROM (
	SELECT "id" FROM "contribution_profiles"
	ORDER BY "is_default" DESC, "created_at" ASC, "id" ASC
	LIMIT 1
) cp
ON CONFLICT ("key") DO UPDATE
	SET "value" = EXCLUDED."value"
	WHERE jsonb_typeof("app_settings"."value") = 'null'
		OR "app_settings"."value" = to_jsonb(0);--> statement-breakpoint

-- 7. The flag itself. Every former-default row survives as an ordinary,
--    renamable, editable profile.
ALTER TABLE "contribution_profiles" DROP COLUMN "is_default";
