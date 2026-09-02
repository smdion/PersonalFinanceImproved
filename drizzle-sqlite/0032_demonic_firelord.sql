CREATE TABLE `retirement_profile_people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`retirement_age` integer NOT NULL,
	`end_age` integer NOT NULL,
	`social_security_monthly` text,
	`ss_start_age` integer,
	`rule_of_55_override` integer,
	`salary_annual_increase` text,
	FOREIGN KEY (`profile_id`) REFERENCES `retirement_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_profile_people_profile_person_unq` ON `retirement_profile_people` (`profile_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `retirement_profile_people_profile_id_idx` ON `retirement_profile_people` (`profile_id`);--> statement-breakpoint
CREATE INDEX `retirement_profile_people_person_id_idx` ON `retirement_profile_people` (`person_id`);--> statement-breakpoint
CREATE TABLE `retirement_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_profiles_name_unique` ON `retirement_profiles` (`name`);--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `profile_id` integer REFERENCES retirement_profiles(id);--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `distribution_tax_rate_traditional` text;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `distribution_tax_rate_roth` text;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `distribution_tax_rate_hsa` text;--> statement-breakpoint
ALTER TABLE `retirement_settings` ADD `distribution_tax_rate_brokerage` text;--> statement-breakpoint
CREATE INDEX `retirement_settings_profile_id_idx` ON `retirement_settings` (`profile_id`);--> statement-breakpoint
ALTER TABLE `scenarios` ADD `retirement_profile_id` integer REFERENCES retirement_profiles(id);--> statement-breakpoint
CREATE INDEX `scenarios_retirement_profile_id_idx` ON `scenarios` (`retirement_profile_id`);--> statement-breakpoint
-- ===========================================================================
-- Retirement Profiles — step A backfill (expand phase)
--
-- SQLite counterpart of drizzle/0032_curved_silhouette.sql. Same semantics,
-- rewritten for SQLite: no CROSS JOIN LATERAL (correlated scalar subqueries
-- instead) and no to_jsonb() (app_settings.value is text/json here, and a
-- bare number is already valid JSON).
--
-- Purely additive; nothing reads these yet. Step B switches the reads.
-- ===========================================================================

-- 1. One profile, "Current Plan", for households that already have settings.
INSERT INTO `retirement_profiles` (`name`, `description`)
SELECT
	'Current Plan',
	'Your existing retirement assumptions, carried over when Retirement Profiles were introduced.'
WHERE EXISTS (SELECT 1 FROM `retirement_settings`)
	AND NOT EXISTS (SELECT 1 FROM `retirement_profiles`);--> statement-breakpoint

-- 2. Point every existing settings row at it.
UPDATE `retirement_settings`
SET `profile_id` = (SELECT MIN(`id`) FROM `retirement_profiles`)
WHERE `profile_id` IS NULL
	AND EXISTS (SELECT 1 FROM `retirement_profiles`);--> statement-breakpoint

-- 3. Per-person rows (completeness invariant: one per person per profile).
--    A person with no retirement_settings row inherits the primary person's
--    values — exactly what the engine's `ps?.x ?? settings.x` fallback
--    resolves to today, so materialising it changes nothing and lets step B
--    delete that `??`. end_age stays per-person; the engine takes its own
--    max() at projectionEndAge.
INSERT INTO `retirement_profile_people` (
	`profile_id`, `person_id`, `retirement_age`, `end_age`,
	`social_security_monthly`, `ss_start_age`, `rule_of_55_override`,
	`salary_annual_increase`
)
SELECT
	(SELECT MIN(`id`) FROM `retirement_profiles`),
	p.`id`,
	COALESCE(own.`retirement_age`, prim.`retirement_age`),
	COALESCE(own.`end_age`, prim.`end_age`),
	COALESCE(own.`social_security_monthly`, prim.`social_security_monthly`),
	COALESCE(own.`ss_start_age`, prim.`ss_start_age`),
	COALESCE(own.`rule_of_55_override`, prim.`rule_of_55_override`),
	COALESCE(own.`salary_annual_increase`, prim.`salary_annual_increase`)
FROM `people` p
LEFT JOIN `retirement_settings` own ON own.`person_id` = p.`id`
-- The primary person's row, matching getPrimaryPerson(): is_primary_user
-- first, else the first person.
LEFT JOIN `retirement_settings` prim ON prim.`person_id` = (
	SELECT pp.`id` FROM `people` pp
	JOIN `retirement_settings` rs2 ON rs2.`person_id` = pp.`id`
	ORDER BY pp.`is_primary_user` DESC, pp.`id`
	LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM `retirement_profiles`)
	AND NOT EXISTS (SELECT 1 FROM `retirement_profile_people`);--> statement-breakpoint

-- 4. Distribution tax rates, relocated off retirement_scenarios.
--    NULL when no is_selected row exists — step B reads
--    `rate != null ? rate : 0`, matching today's `selectedScenario ? rate : 0`
--    exactly while keeping "absent" distinguishable from a deliberate 0%.
--    MIN(id) among selected rows makes a case deterministic that is currently
--    nondeterministic (the live read has no ORDER BY).
UPDATE `retirement_settings`
SET
	`distribution_tax_rate_traditional` = (
		SELECT `distribution_tax_rate_traditional` FROM `retirement_scenarios`
		WHERE `is_selected` = 1 ORDER BY `id` LIMIT 1
	),
	`distribution_tax_rate_roth` = (
		SELECT `distribution_tax_rate_roth` FROM `retirement_scenarios`
		WHERE `is_selected` = 1 ORDER BY `id` LIMIT 1
	),
	`distribution_tax_rate_hsa` = (
		SELECT `distribution_tax_rate_hsa` FROM `retirement_scenarios`
		WHERE `is_selected` = 1 ORDER BY `id` LIMIT 1
	),
	`distribution_tax_rate_brokerage` = (
		SELECT `distribution_tax_rate_brokerage` FROM `retirement_scenarios`
		WHERE `is_selected` = 1 ORDER BY `id` LIMIT 1
	)
WHERE `distribution_tax_rate_traditional` IS NULL
	AND EXISTS (SELECT 1 FROM `retirement_scenarios` WHERE `is_selected` = 1);--> statement-breakpoint

-- 5. Global active profile — the lowest tier of useEffectiveProfileId.
--    scenarios.retirement_profile_id stays NULL on purpose.
INSERT INTO `app_settings` (`key`, `value`)
SELECT 'active_retirement_profile_id', CAST((SELECT MIN(`id`) FROM `retirement_profiles`) AS TEXT)
WHERE EXISTS (SELECT 1 FROM `retirement_profiles`)
ON CONFLICT (`key`) DO NOTHING;
