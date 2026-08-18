-- R19 Phase 1: "override" -> "active"/"inactive" terminology for
-- Contribution Profiles. See drizzle/0010_contribution_active_fields.sql
-- (Postgres) for the full rationale — this is the SQLite mirror.
--
-- Two steps: (1) rename the column itself — a pure rename, doesn't touch
-- stored bytes; (2) rewrite the nested `displayNameOverride` JSON key to
-- `displayNameActive` inside every profile's `contributionAccounts` map,
-- via SQLite's JSON1 functions (json_each/json_group_object/json_set/
-- json_remove) — hand-verified against a seeded row (see
-- tests/db/contribution-active-fields-migration.test.ts) since SQLite's
-- JSON functions have different type-coercion behavior than Postgres's.

-- 1. Column rename.
ALTER TABLE `contribution_profiles` RENAME COLUMN `contribution_overrides` TO `contribution_active_fields`;--> statement-breakpoint

-- 2. Rewrite the persisted `displayNameOverride` key to `displayNameActive`
--    inside each account entry of contributionAccounts. json_group_object
--    over json_each rebuilds the map with the key renamed wherever present;
--    entries without the key pass through unchanged. Every json()-wrapped
--    argument marks its result as JSON (not a string scalar) so json_set
--    nests it correctly rather than storing an escaped string.
UPDATE `contribution_profiles`
SET `contribution_active_fields` = json_set(
	`contribution_active_fields`,
	'$.contributionAccounts',
	json(COALESCE(
		(
			SELECT json_group_object(
				je.key,
				json(
					CASE WHEN json_extract(je.value, '$.displayNameOverride') IS NOT NULL
						THEN json_set(
							json_remove(je.value, '$.displayNameOverride'),
							'$.displayNameActive',
							json_extract(je.value, '$.displayNameOverride')
						)
						ELSE je.value
					END
				)
			)
			FROM json_each(json_extract(`contribution_active_fields`, '$.contributionAccounts')) je
		),
		json_extract(`contribution_active_fields`, '$.contributionAccounts'),
		'{}'
	))
)
WHERE json_extract(`contribution_active_fields`, '$.contributionAccounts') IS NOT NULL;
