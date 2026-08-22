-- Employer match grouping fix (server/helpers/contribution.ts,
-- computeGroupedEmployerMatch): a real employer match cap applies to a
-- physical account's COMBINED contribution, not each Roth/Traditional
-- split separately. The new grouped computation requires exactly one
-- "winning" row per (job/person, accountType, parentCategory) group to
-- carry real match config — two independently-configured siblings is an
-- ambiguous data state the app throws on rather than silently guessing
-- at. These two partial unique indexes (job-linked accounts, and the
-- jobless-fallback-to-person case every caller already resolves the same
-- way) stop that ambiguous state from being written in the first place,
-- rather than relying on the app-level throw alone.
--
-- Pre-flight dedupe (added on review — the indexes below abort the whole
-- migration if any environment's real data already has two independently
-- match-configured siblings in one group, which is exactly the "ambiguous
-- state" this header describes as something that predates this fix, not
-- something it prevents from ever having existed). Deterministic,
-- lowest-id-wins: for every duplicate group, keep the earliest-created
-- row's match config and demote every other row in the group to
-- 'none' — the same "one winning row" invariant the index enforces going
-- forward, just applied once to existing data first. This is a real,
-- lossy data decision (an admin later needs to review which row should
-- have actually kept the match), not a computed default; flagged here
-- rather than silently guessed at differently per row.
WITH job_dupes AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY "job_id", "account_type", "parent_category"
			ORDER BY id
		) AS rn
	FROM "contribution_accounts"
	WHERE "employer_match_type" <> 'none'
		AND "job_id" IS NOT NULL
		AND "is_active" = true
)
UPDATE "contribution_accounts" ca
SET "employer_match_type" = 'none',
	"employer_match_value" = NULL,
	"employer_max_match_pct" = NULL
FROM job_dupes jd
WHERE ca.id = jd.id AND jd.rn > 1;--> statement-breakpoint

WITH person_dupes AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY "person_id", "account_type", "parent_category"
			ORDER BY id
		) AS rn
	FROM "contribution_accounts"
	WHERE "employer_match_type" <> 'none'
		AND "job_id" IS NULL
		AND "is_active" = true
)
UPDATE "contribution_accounts" ca
SET "employer_match_type" = 'none',
	"employer_match_value" = NULL,
	"employer_max_match_pct" = NULL
FROM person_dupes pd
WHERE ca.id = pd.id AND pd.rn > 1;--> statement-breakpoint

CREATE UNIQUE INDEX "contribution_accounts_job_match_unq" ON "contribution_accounts" USING btree ("job_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NOT NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_accounts_person_match_unq" ON "contribution_accounts" USING btree ("person_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NULL AND "contribution_accounts"."is_active" = true;
