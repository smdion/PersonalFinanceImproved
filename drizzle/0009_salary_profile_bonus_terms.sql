-- Re-encode Salary Profile entries, and move bonus TERMS into them.
--
-- Two changes, both to JSON payloads only — no DDL, no column added or
-- dropped. Migration 0008 introduced the {mode:...} discriminator; this
-- replaces it with a presence encoding and is otherwise a no-op on the same
-- data, so 0008 → 0009 composes cleanly on a database that has only ever
-- seen the old shape.
--
-- 1. salary_profiles.salaries: drop the `mode` discriminator.
--       {mode:"job"}               -> {}          (pins nothing)
--       {mode:"fixed", salary: N}  -> {salary: N} (pins salary, keeps bonus)
--    PRESENCE OF A FIELD IS NOW THE PIN SIGNAL. This is meaning-preserving
--    in the only direction that matters: every existing pin survives as a
--    `salary` field, and every follow-the-job entry becomes an entry that
--    pins nothing, which is what it always meant.
--
--    Note the deliberate change of MEANING for a pinned person even though
--    the stored number is unchanged: {mode:"fixed"} used to make the app
--    drop that person's bonus entirely, because a flat pin replaced their
--    whole compensation. {salary: N} pins only the salary and leaves the
--    bonus terms resolving live off the job record. That is the intent the
--    UI always presented (the profile editor showed the bonus the whole
--    time) and the reason the old encoding produced two disagreeing
--    numbers. Pinned people's total compensation will therefore INCREASE by
--    their live bonus after this migration — that is the bug being fixed,
--    not a regression.
--
--    Entries are rebuilt key by key rather than patched, so anything that
--    is neither shape (hand-edited rows, future keys) is dropped rather
--    than half-migrated into an entry that pins something unintended.
--
-- 2. contribution_profiles.contribution_overrides: strip the bonus AMOUNT
--    terms out of every job override. bonusPercent / bonusMultiplier /
--    monthsInBonusYear now live on the Salary Profile entry, alongside
--    salary, because "how big is the bonus" is the same category of fact as
--    "how big is the salary".
--
--    This is a pure key strip with NO data carried across, which is only
--    safe because no such key exists. Verified against dev, prod, demo and
--    the legacy dev database before writing this: zero job overrides carry
--    any of the three. There is deliberately no automatic mapping — a
--    Contribution Profile and a Salary Profile are independent, unrelated
--    pins, so there is no correct answer to "which Salary Profile should
--    this contribution profile's bonus override land in". Had any row
--    carried one, this migration would not have been written; a human would
--    have had to place it.
--
--    include401kInBonus, includeBonusInContributions, employerName,
--    bonusMonth and bonusDayOfMonth all stay — they are about how
--    contributions are computed FROM a bonus, or about when it is paid,
--    not about how big it is.

-- 1. Re-encode salary_profiles.salaries.
UPDATE "salary_profiles"
SET "salaries" = COALESCE(
	(
		SELECT jsonb_object_agg(entry."key", entry."value")
		FROM (
			SELECT
				e."key" AS "key",
				CASE
					-- Already in the new shape (no discriminator): leave it
					-- exactly as found. This is what makes the statement
					-- idempotent — without it a second run would see no
					-- mode:'fixed' and blank every pin it had just written.
					WHEN NOT (e."value" ? 'mode') THEN e."value"
					WHEN e."value" ->> 'mode' = 'fixed'
						AND jsonb_typeof(e."value" -> 'salary') = 'number'
						THEN jsonb_build_object('salary', e."value" -> 'salary')
					ELSE '{}'::jsonb
				END AS "value"
			FROM jsonb_each("salary_profiles"."salaries") e
			WHERE jsonb_typeof(e."value") = 'object'
		) entry
	),
	'{}'::jsonb
)
WHERE jsonb_typeof("salaries") = 'object';--> statement-breakpoint

-- 2. Strip the moved bonus terms from every contribution profile's job
--    overrides. Rebuilds the `jobs` sub-object per job id; anything not in
--    `jobs` (i.e. contributionAccounts) is left byte-for-byte alone.
UPDATE "contribution_profiles"
SET "contribution_overrides" = jsonb_set(
	"contribution_overrides",
	'{jobs}',
	COALESCE(
		(
			SELECT jsonb_object_agg(j."key", j."value" - 'bonusPercent' - 'bonusMultiplier' - 'monthsInBonusYear')
			FROM jsonb_each("contribution_profiles"."contribution_overrides" -> 'jobs') j
			WHERE jsonb_typeof(j."value") = 'object'
		),
		'{}'::jsonb
	)
)
WHERE jsonb_typeof("contribution_overrides" -> 'jobs') = 'object';
