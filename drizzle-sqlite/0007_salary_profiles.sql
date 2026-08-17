CREATE TABLE `salary_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`salary_overrides` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_profiles_name_unique` ON `salary_profiles` (`name`);--> statement-breakpoint
-- Temporary link column (NOT part of the Drizzle schema) used only to carry
-- the contribution_profiles.id each backfilled Salary Profile came from, so
-- the pins below can be repointed. Dropped at the end of this migration.
ALTER TABLE `salary_profiles` ADD `source_contribution_profile_id` integer;--> statement-breakpoint
-- Salary overrides used to live on contribution_profiles. Split them out into
-- a matching Salary Profile per contribution profile that actually carried
-- one, so today's paired behavior is preserved on upgrade. Names are unique
-- on both tables, so copying the name across is collision-safe.
INSERT INTO `salary_profiles` (`name`, `description`, `salary_overrides`, `source_contribution_profile_id`)
SELECT `name`, `description`, `salary_overrides`, `id`
FROM `contribution_profiles`
WHERE `salary_overrides` IS NOT NULL AND `salary_overrides` <> '{}';--> statement-breakpoint
ALTER TABLE `scenarios` ADD `salary_profile_id` integer REFERENCES salary_profiles(id);--> statement-breakpoint
-- Plan pin: a Plan that pinned a Contribution Profile carrying salary
-- overrides now also pins the Salary Profile split out of it.
UPDATE `scenarios` SET `salary_profile_id` = (
	SELECT sp.`id` FROM `salary_profiles` sp
	WHERE sp.`source_contribution_profile_id` = `scenarios`.`contribution_profile_id`
);--> statement-breakpoint
ALTER TABLE `retirement_salary_overrides` ADD `salary_profile_id` integer REFERENCES salary_profiles(id);--> statement-breakpoint
-- Retirement profile-switch rows: same repointing.
UPDATE `retirement_salary_overrides` SET `salary_profile_id` = (
	SELECT sp.`id` FROM `salary_profiles` sp
	WHERE sp.`source_contribution_profile_id` = `retirement_salary_overrides`.`contribution_profile_id`
);--> statement-breakpoint
ALTER TABLE `budget_profiles` ADD `column_salary_profile_ids` text;--> statement-breakpoint
-- Budget-column pin: build a same-length array where each entry is the
-- Salary Profile split out of that column's Contribution Profile (JSON null
-- when the column had no contribution profile, or its profile carried no
-- salary overrides). json_each yields elements in array order and
-- json_group_array preserves it, so column order is stable.
UPDATE `budget_profiles` SET `column_salary_profile_ids` = (
	SELECT json_group_array(
		(SELECT sp.`id` FROM `salary_profiles` sp
		 WHERE sp.`source_contribution_profile_id` = e.value)
	)
	FROM json_each(`budget_profiles`.`column_contribution_profile_ids`) e
)
WHERE `column_contribution_profile_ids` IS NOT NULL
	AND json_valid(`column_contribution_profile_ids`)
	AND json_array_length(`column_contribution_profile_ids`) > 0;--> statement-breakpoint
CREATE INDEX `retirement_salary_overrides_contribution_profile_id_idx` ON `retirement_salary_overrides` (`contribution_profile_id`);--> statement-breakpoint
CREATE INDEX `retirement_salary_overrides_salary_profile_id_idx` ON `retirement_salary_overrides` (`salary_profile_id`);--> statement-breakpoint
CREATE INDEX `scenarios_salary_profile_id_idx` ON `scenarios` (`salary_profile_id`);--> statement-breakpoint
ALTER TABLE `salary_profiles` DROP COLUMN `source_contribution_profile_id`;--> statement-breakpoint
ALTER TABLE `contribution_profiles` DROP COLUMN `salary_overrides`;
