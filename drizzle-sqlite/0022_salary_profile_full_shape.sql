-- Hand-written SQLite twin of drizzle/0022_salary_profile_full_shape.sql —
-- see that file for the full rationale and backfill decisions. SQLite has
-- no ALTER TABLE DROP COLUMN (well, it exists since 3.35 but this repo's
-- convention — see drizzle-sqlite/0021 — is the standard table-rebuild
-- pattern) and no jsonb/generate_series, so the JSONB-equivalent backfills
-- below use json_object/json_group_object/json_set/json_type instead of
-- the Postgres file's jsonb_build_object/jsonb_object_agg/`-` key-subtract
-- idiom. All JSON backfills run BEFORE the table rebuilds, while `jobs`
-- still has every raw column to read from.

-- 1a. Backfill zero-entry Salary Profiles only — same decision as the
-- Postgres file: a profile with ANY existing entries has its entries
-- upgraded in-place instead (see 1b), never new entries added.
-- json_group_object/json_object keep genuine JSON types (not quoted
-- strings) for numbers/booleans/null — see 0009's docblock for the same
-- idiom. Booleans are wrapped in json('true'/'false') so json_object emits
-- them as JSON booleans, not the quoted text SQLite would otherwise use
-- for a TEXT argument. COALESCE guards a DB with a profile but zero
-- non-speculative jobs — json_group_object over an empty set is already
-- '{}' in SQLite (unlike Postgres's NULL), but salaries is NOT NULL either
-- way, so this keeps both files' behavior visibly identical.
UPDATE `salary_profiles`
SET `salaries` = COALESCE((
	SELECT json_group_object(
		j.`id`,
		json_object(
			'salary', 0,
			'bonusPercent', 0,
			'bonusMultiplier', 1,
			'monthsInBonusYear', 12,
			'bonusOverride', NULL,
			'payPeriod', j.`pay_period`,
			'payWeek', j.`pay_week`,
			'anchorPayDate', j.`anchor_pay_date`,
			'budgetPeriodsPerMonth', CAST(j.`budget_periods_per_month` AS REAL),
			'w4FilingStatus', j.`w4_filing_status`,
			'w4Box2cChecked', json(CASE WHEN j.`w4_box2c_checked` THEN 'true' ELSE 'false' END),
			'additionalFedWithholding', CAST(j.`additional_fed_withholding` AS REAL),
			'bonusMonth', j.`bonus_month`,
			'bonusDayOfMonth', j.`bonus_day_of_month`,
			'include401kInBonus', json(CASE WHEN j.`include_401k_in_bonus` THEN 'true' ELSE 'false' END),
			'includeBonusInContributions', json(CASE WHEN j.`include_bonus_in_contributions` THEN 'true' ELSE 'false' END)
		)
	)
	FROM `jobs` j
	WHERE j.`is_speculative` = 0
), '{}')
WHERE `salaries` = '{}';--> statement-breakpoint

-- 1b. Non-empty profiles: salaryEntrySchema is `.strict()` with all 16
-- fields required — an existing entry left in the old 5-field shape fails
-- to parse the instant this migration commits, and by then the raw `jobs`
-- columns it would need are gone. Upgrade every EXISTING entry (by job id
-- already present in this profile's map) to the full shape via json_set
-- (NOT json_patch — json_patch is RFC7396 merge-patch, where a null value
-- means "delete this key"; anchorPayDate/bonusMonth/bonusDayOfMonth are
-- legitimately null and must survive as JSON null, not vanish). Do NOT add
-- entries for jobs this profile doesn't already mention — the JOIN only
-- ever touches keys already present in the map.
--
-- `CAST(j.\`id\` AS TEXT) = je.key`, not `j.\`id\` = CAST(je.key AS INTEGER)`
-- — SQLite's numeric CAST is lenient (CAST('foo' AS INTEGER) = 0,
-- CAST('012abc' AS INTEGER) = 12), so casting the JSON key to a number can
-- spuriously match a real job id for a malformed/legacy key and write that
-- job's pay schedule/W-4 elections into the wrong entry. Casting the job id
-- to text instead makes this an exact string comparison, matching the
-- Postgres twin's `j."id"::text = entry.key`.
--
-- COALESCE(..., '{}') guards the same all-orphan case as the Postgres
-- twin's fix: an entry can outlive its job (settings/paycheck.ts's
-- job-delete path doesn't prune salary_profiles.salaries), and every field
-- being written here is non-nullable in salaryEntrySchema, so an orphaned
-- entry can't be upgraded to a valid complete entry — it's correctly
-- dropped from the rebuilt object by the JOIN. Without the COALESCE,
-- json_group_object over zero surviving rows would silently wipe an
-- all-orphan profile to NULL with no error; wrapping it makes the
-- degenerate case an explicit, visible '{}' instead, matching step 1a.
UPDATE `salary_profiles`
SET `salaries` = COALESCE((
	SELECT json_group_object(
		je.key,
		json_set(
			je.value,
			'$.payPeriod', j.`pay_period`,
			'$.payWeek', j.`pay_week`,
			'$.anchorPayDate', j.`anchor_pay_date`,
			'$.budgetPeriodsPerMonth', CAST(j.`budget_periods_per_month` AS REAL),
			'$.w4FilingStatus', j.`w4_filing_status`,
			'$.w4Box2cChecked', json(CASE WHEN j.`w4_box2c_checked` THEN 'true' ELSE 'false' END),
			'$.additionalFedWithholding', CAST(j.`additional_fed_withholding` AS REAL),
			'$.bonusMonth', j.`bonus_month`,
			'$.bonusDayOfMonth', j.`bonus_day_of_month`,
			'$.include401kInBonus', json(CASE WHEN j.`include_401k_in_bonus` THEN 'true' ELSE 'false' END),
			'$.includeBonusInContributions', json(CASE WHEN j.`include_bonus_in_contributions` THEN 'true' ELSE 'false' END)
		)
	)
	FROM json_each(salary_profiles.`salaries`) AS je
	JOIN `jobs` j ON CAST(j.`id` AS TEXT) = je.key
), '{}')
WHERE `salaries` != '{}';--> statement-breakpoint

-- 2. Backfill paycheck_deductions into every Contribution Profile's
-- deductions bucket, gaps-only per deduction id. Filter defaults down to
-- only ids NOT already a key in the existing bucket first, then union via
-- json_patch — with no overlapping keys between the two sides, json_patch's
-- recursive-merge behavior never triggers, avoiding a subtle divergence
-- from the Postgres file's key-subtraction: an existing entry that's
-- present-but-empty (`{}` — legal, amountPerPeriod is `.optional()`) must
-- be left exactly as `{}`, not have a default merged into it, and
-- `json_patch(defaults, existing)` over the WHOLE bucket would do exactly
-- that (RFC7396 recurses into matching-key objects on both sides, so an
-- empty `existing["5"]` doesn't override `defaults["5"]`).
UPDATE `contribution_profiles`
SET `contribution_active_fields` = json_set(
	`contribution_active_fields`,
	'$.deductions',
	json_patch(
		COALESCE(json_extract(`contribution_active_fields`, '$.deductions'), '{}'),
		(
			SELECT COALESCE(
				json_group_object(
					d.`id`,
					json_object('amountPerPeriod', d.`amount_per_period`)
				),
				'{}'
			)
			FROM `paycheck_deductions` d
			WHERE d.`id` NOT IN (
				SELECT CAST(je.key AS INTEGER)
				FROM json_each(
					COALESCE(json_extract(`contribution_active_fields`, '$.deductions'), '{}')
				) AS je
			)
		)
	)
);--> statement-breakpoint

-- 2b. Cleanup: strip any leftover `jobs` key from contribution_active_fields
-- — the bucket no longer exists in the app schema.
UPDATE `contribution_profiles`
SET `contribution_active_fields` = json_remove(`contribution_active_fields`, '$.jobs')
WHERE json_type(`contribution_active_fields`, '$.jobs') IS NOT NULL;--> statement-breakpoint

-- 3. Backfill payPeriod/anchorPayDate into every existing
-- extra_paycheck_routing blob, gaps-only. Uses json_set (not json_patch)
-- specifically so an existing, genuine `anchorPayDate: null` (a complete,
-- already-snapshotted "no anchor" state) is preserved as-is rather than
-- being deleted by RFC7396 merge-patch's null-means-remove rule.
-- json_type(...) returns SQL NULL when the path is absent, but the text
-- 'null' when the path exists and holds JSON null — that distinction is
-- exactly "absent" vs "explicitly null" this backfill must respect.
UPDATE `jobs`
SET `extra_paycheck_routing` = json_set(
	json_set(
		`extra_paycheck_routing`,
		'$.payPeriod',
		CASE
			WHEN json_type(`extra_paycheck_routing`, '$.payPeriod') IS NULL THEN `pay_period`
			ELSE json_extract(`extra_paycheck_routing`, '$.payPeriod')
		END
	),
	'$.anchorPayDate',
	CASE
		WHEN json_type(`extra_paycheck_routing`, '$.anchorPayDate') IS NULL THEN `anchor_pay_date`
		ELSE json_extract(`extra_paycheck_routing`, '$.anchorPayDate')
	END
)
WHERE `extra_paycheck_routing` IS NOT NULL;--> statement-breakpoint

-- 4. Table rebuilds — SQLite has no DROP COLUMN in this repo's migration
-- convention (see drizzle-sqlite/0021's docblock). `jobs` loses 11 columns,
-- `paycheck_deductions` loses 1.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`employer_name` text NOT NULL,
	`title` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`extra_paycheck_routing` text,
	`is_speculative` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_jobs`(
	"id", "person_id", "employer_name", "title", "start_date", "end_date",
	"extra_paycheck_routing", "is_speculative"
)
SELECT
	"id", "person_id", "employer_name", "title", "start_date", "end_date",
	"extra_paycheck_routing", "is_speculative"
FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_person_id_idx` ON `jobs` (`person_id`);--> statement-breakpoint
CREATE INDEX `jobs_is_speculative_idx` ON `jobs` (`is_speculative`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_one_speculative_per_person_idx` ON `jobs` (`person_id`) WHERE "jobs"."is_speculative" = true;--> statement-breakpoint

CREATE TABLE `__new_paycheck_deductions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`deduction_name` text NOT NULL,
	`is_pretax` integer NOT NULL,
	`fica_exempt` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_paycheck_deductions`(
	"id", "job_id", "deduction_name", "is_pretax", "fica_exempt"
)
SELECT
	"id", "job_id", "deduction_name", "is_pretax", "fica_exempt"
FROM `paycheck_deductions`;--> statement-breakpoint
DROP TABLE `paycheck_deductions`;--> statement-breakpoint
ALTER TABLE `__new_paycheck_deductions` RENAME TO `paycheck_deductions`;--> statement-breakpoint
CREATE INDEX `paycheck_deductions_job_id_idx` ON `paycheck_deductions` (`job_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
