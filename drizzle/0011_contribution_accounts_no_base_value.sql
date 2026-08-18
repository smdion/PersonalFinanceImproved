-- Contribution accounts stop carrying their own contributionValue/
-- contributionMethod. An account is purely structural (what it IS); the
-- actual contribution amount/method is ALWAYS a Contribution Profile's
-- active-field entry from here on, never a fallback column on the account
-- row. There is no more "falls through to the account's own live value" —
-- applyContribActiveFields no longer spreads the base row.
--
-- Two steps, in order, so no numeric drift occurs:
-- 1. Backfill: give every existing profile an explicit contributionValue/
--    contributionMethod for every account it doesn't already customize,
--    using that account's current live value. Only fills what's MISSING —
--    a profile that already sets its own contributionValue for an account
--    (or, like a real household profile, only one of the two fields) keeps
--    its existing entry untouched and only gets the missing field added.
-- 2. Drop the two columns.

-- 1. Backfill every profile x account pair.
UPDATE "contribution_profiles" cp
SET "contribution_active_fields" = jsonb_set(
	cp."contribution_active_fields",
	'{contributionAccounts}',
	(
		SELECT jsonb_object_agg(
			ca.id::text,
			COALESCE(
				cp."contribution_active_fields" -> 'contributionAccounts' -> ca.id::text,
				'{}'::jsonb
			) || jsonb_strip_nulls(jsonb_build_object(
				'contributionValue',
				CASE
					WHEN (cp."contribution_active_fields" -> 'contributionAccounts' -> ca.id::text -> 'contributionValue') IS NULL
					THEN to_jsonb(ca.contribution_value::text)
				END,
				'contributionMethod',
				CASE
					WHEN (cp."contribution_active_fields" -> 'contributionAccounts' -> ca.id::text -> 'contributionMethod') IS NULL
					THEN to_jsonb(ca.contribution_method)
				END
			))
		)
		FROM "contribution_accounts" ca
	)
);--> statement-breakpoint

-- 2. Drop now-dead columns.
ALTER TABLE "contribution_accounts" DROP COLUMN "contribution_method";--> statement-breakpoint
ALTER TABLE "contribution_accounts" DROP COLUMN "contribution_value";
