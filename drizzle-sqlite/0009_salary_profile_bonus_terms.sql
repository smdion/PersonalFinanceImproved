-- Re-encode Salary Profile entries, and move bonus TERMS into them.
-- SQLite twin of drizzle/0009_salary_profile_bonus_terms.sql — see that
-- file's header for the full rationale, including why the bonus-term strip
-- carries no data across (no row anywhere has one) and why a pinned
-- person's total compensation deliberately gains their live bonus.

-- 1. Re-encode salary_profiles.salaries: drop the `mode` discriminator.
--       {mode:"job"}               -> {}          (pins nothing)
--       {mode:"fixed", salary: N}  -> {salary: N} (pins salary, keeps bonus)
--    json_object() values keep their JSON subtype through json_group_object,
--    so these nest as objects rather than being re-quoted as strings — same
--    reason 0008 built its entries this way.
UPDATE `salary_profiles`
SET `salaries` = COALESCE(
	(
		SELECT json_group_object(
			e.`key`,
			CASE
				-- Already in the new shape (no discriminator): leave it
				-- exactly as found. This is what makes the statement
				-- idempotent — without it a second run would see no
				-- mode:'fixed' and blank every pin it had just written.
				WHEN json_type(e.`value`, '$.mode') IS NULL THEN json(e.`value`)
				WHEN json_extract(e.`value`, '$.mode') = 'fixed'
					AND json_type(e.`value`, '$.salary') IN ('integer', 'real')
					THEN json_object('salary', json_extract(e.`value`, '$.salary'))
				ELSE json_object()
			END
		)
		FROM json_each(`salary_profiles`.`salaries`) e
		WHERE e.`type` = 'object'
	),
	'{}'
)
WHERE json_valid(`salaries`) AND json_type(`salaries`) = 'object';--> statement-breakpoint

-- 2. Strip the moved bonus terms from every contribution profile's job
--    overrides. Rebuilds the `jobs` sub-object per job id; anything not in
--    `jobs` (i.e. contributionAccounts) is left alone.
UPDATE `contribution_profiles`
SET `contribution_overrides` = json_set(
	`contribution_overrides`,
	'$.jobs',
	COALESCE(
		(
			SELECT json_group_object(
				j.`key`,
				json_remove(j.`value`, '$.bonusPercent', '$.bonusMultiplier', '$.monthsInBonusYear')
			)
			FROM json_each(`contribution_profiles`.`contribution_overrides`, '$.jobs') j
			WHERE j.`type` = 'object'
		),
		json_object()
	)
)
WHERE json_valid(`contribution_overrides`)
	AND json_type(`contribution_overrides`, '$.jobs') = 'object';
