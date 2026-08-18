-- Contribution accounts stop carrying their own contributionValue/
-- contributionMethod. See drizzle/0011_contribution_accounts_no_base_value.sql
-- (Postgres) for the full rationale — this is the SQLite mirror, using
-- json_patch (RFC 7396 merge-patch semantics: keys present with a real value
-- override, keys omitted from the patch leave the existing value untouched)
-- instead of Postgres's `||` jsonb-concat + jsonb_strip_nulls.

-- 1. Backfill every profile x account pair.
UPDATE `contribution_profiles`
SET `contribution_active_fields` = json_set(
	`contribution_active_fields`,
	'$.contributionAccounts',
	json(COALESCE(
		(
			SELECT json_group_object(
				ca.id,
				json_patch(
					COALESCE(
						json_extract(`contribution_active_fields`, '$.contributionAccounts.' || ca.id),
						'{}'
					),
					CASE
						WHEN json_extract(`contribution_active_fields`, '$.contributionAccounts.' || ca.id || '.contributionValue') IS NULL
						 AND json_extract(`contribution_active_fields`, '$.contributionAccounts.' || ca.id || '.contributionMethod') IS NULL
						THEN json_object('contributionValue', ca.contribution_value, 'contributionMethod', ca.contribution_method)
						WHEN json_extract(`contribution_active_fields`, '$.contributionAccounts.' || ca.id || '.contributionValue') IS NULL
						THEN json_object('contributionValue', ca.contribution_value)
						WHEN json_extract(`contribution_active_fields`, '$.contributionAccounts.' || ca.id || '.contributionMethod') IS NULL
						THEN json_object('contributionMethod', ca.contribution_method)
						ELSE json_object()
					END
				)
			)
			FROM `contribution_accounts` ca
		),
		'{}'
	))
);--> statement-breakpoint

-- 2. Drop now-dead columns.
ALTER TABLE `contribution_accounts` DROP COLUMN `contribution_method`;--> statement-breakpoint
ALTER TABLE `contribution_accounts` DROP COLUMN `contribution_value`;
