-- R19 Phase 1: "override" -> "active"/"inactive" terminology for
-- Contribution Profiles. A profile is its own complete world, not a delta
-- against a "live" truth: each field is either ACTIVE (this profile has its
-- own value for it) or INACTIVE (nothing set here, so the account's/job's
-- own real value applies) — matching the existing account-level `isActive`
-- checkbox. "Override" implied the wrong mental model; renamed accordingly.
--
-- Two steps: (1) rename the column itself — a pure rename, doesn't touch
-- stored bytes; (2) rewrite the nested `displayNameOverride` JSON key to
-- `displayNameActive` inside every profile's `contributionAccounts` map —
-- this DOES touch stored bytes, so it's scoped tightly to just that one key
-- and leaves every other value (including `isActive`, `contributionMethod`,
-- `contributionValue`) byte-for-byte untouched.

-- 1. Column rename.
ALTER TABLE "contribution_profiles" RENAME COLUMN "contribution_overrides" TO "contribution_active_fields";--> statement-breakpoint

-- 2. Rewrite the persisted `displayNameOverride` key to `displayNameActive`
--    inside each account entry of contributionAccounts. jsonb_object_agg
--    over jsonb_each rebuilds the map with the key renamed wherever present;
--    entries without the key pass through unchanged. No-op (COALESCE to the
--    existing value) when contributionAccounts is absent/empty.
UPDATE "contribution_profiles"
SET "contribution_active_fields" = jsonb_set(
	"contribution_active_fields",
	'{contributionAccounts}',
	COALESCE(
		(
			SELECT jsonb_object_agg(
				key,
				CASE WHEN value ? 'displayNameOverride'
					THEN (value - 'displayNameOverride')
						|| jsonb_build_object('displayNameActive', value -> 'displayNameOverride')
					ELSE value
				END
			)
			FROM jsonb_each("contribution_active_fields" -> 'contributionAccounts')
		),
		"contribution_active_fields" -> 'contributionAccounts',
		'{}'::jsonb
	)
)
WHERE "contribution_active_fields" -> 'contributionAccounts' IS NOT NULL;
