-- Hand-written SQLite twin of drizzle/0021_retirement_filing_status_backfill.sql —
-- SQLite has no ALTER COLUMN, so making filing_status NOT NULL requires the
-- standard table-rebuild pattern (create __new table with the constraint,
-- copy data with the same backfill the Postgres migration applies, drop the
-- old table, rename). See that file's comment for the governing plan/rule.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_retirement_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`retirement_age` integer NOT NULL,
	`end_age` integer NOT NULL,
	`return_after_retirement` text NOT NULL,
	`annual_inflation` text NOT NULL,
	`post_retirement_inflation` text,
	`salary_annual_increase` text NOT NULL,
	`salary_cap` text,
	`raises_during_retirement` integer DEFAULT false NOT NULL,
	`withdrawal_rate` text DEFAULT '0.04' NOT NULL,
	`tax_multiplier` text DEFAULT '1.0' NOT NULL,
	`gross_up_for_taxes` integer DEFAULT true NOT NULL,
	`roth_bracket_target` text DEFAULT '0.12',
	`social_security_monthly` text DEFAULT '2500' NOT NULL,
	`ss_start_age` integer DEFAULT 67 NOT NULL,
	`enable_roth_conversions` integer DEFAULT false NOT NULL,
	`roth_conversion_target` text,
	`withdrawal_strategy` text DEFAULT 'fixed' NOT NULL,
	`gk_upper_guardrail` text DEFAULT '0.80',
	`gk_lower_guardrail` text DEFAULT '1.20',
	`gk_increase_pct` text DEFAULT '0.10',
	`gk_decrease_pct` text DEFAULT '0.10',
	`gk_skip_inflation_after_loss` integer DEFAULT true NOT NULL,
	`sd_annual_decline_rate` text DEFAULT '0.02',
	`cp_withdrawal_percent` text DEFAULT '0.05',
	`cp_floor_percent` text DEFAULT '0.90',
	`en_withdrawal_percent` text DEFAULT '0.05',
	`en_rolling_years` integer DEFAULT 10,
	`en_floor_percent` text DEFAULT '0.90',
	`vd_base_percent` text DEFAULT '0.05',
	`vd_ceiling_percent` text DEFAULT '0.05',
	`vd_floor_percent` text DEFAULT '0.025',
	`rmd_multiplier` text DEFAULT '1.0',
	`enable_irmaa_awareness` integer DEFAULT false NOT NULL,
	`enable_aca_awareness` integer DEFAULT false NOT NULL,
	`household_size` integer DEFAULT 2 NOT NULL,
	`filing_status` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_retirement_settings`(
	"id", "person_id", "retirement_age", "end_age", "return_after_retirement",
	"annual_inflation", "post_retirement_inflation", "salary_annual_increase",
	"salary_cap", "raises_during_retirement", "withdrawal_rate", "tax_multiplier",
	"gross_up_for_taxes", "roth_bracket_target", "social_security_monthly",
	"ss_start_age", "enable_roth_conversions", "roth_conversion_target",
	"withdrawal_strategy", "gk_upper_guardrail", "gk_lower_guardrail",
	"gk_increase_pct", "gk_decrease_pct", "gk_skip_inflation_after_loss",
	"sd_annual_decline_rate", "cp_withdrawal_percent", "cp_floor_percent",
	"en_withdrawal_percent", "en_rolling_years", "en_floor_percent",
	"vd_base_percent", "vd_ceiling_percent", "vd_floor_percent", "rmd_multiplier",
	"enable_irmaa_awareness", "enable_aca_awareness", "household_size", "filing_status"
)
SELECT
	"id", "person_id", "retirement_age", "end_age", "return_after_retirement",
	"annual_inflation", "post_retirement_inflation", "salary_annual_increase",
	"salary_cap", "raises_during_retirement", "withdrawal_rate", "tax_multiplier",
	"gross_up_for_taxes", "roth_bracket_target", "social_security_monthly",
	"ss_start_age", "enable_roth_conversions", "roth_conversion_target",
	"withdrawal_strategy", "gk_upper_guardrail", "gk_lower_guardrail",
	"gk_increase_pct", "gk_decrease_pct", "gk_skip_inflation_after_loss",
	"sd_annual_decline_rate", "cp_withdrawal_percent", "cp_floor_percent",
	"en_withdrawal_percent", "en_rolling_years", "en_floor_percent",
	"vd_base_percent", "vd_ceiling_percent", "vd_floor_percent", "rmd_multiplier",
	"enable_irmaa_awareness", "enable_aca_awareness", "household_size",
	COALESCE(
		"filing_status",
		(
			SELECT j."w4_filing_status"
			FROM "jobs" j
			WHERE j."person_id" = "retirement_settings"."person_id"
				AND j."end_date" IS NULL
				AND j."is_speculative" = 0
			ORDER BY j."id"
			LIMIT 1
		),
		'MFJ'
	)
FROM `retirement_settings`;--> statement-breakpoint
DROP TABLE `retirement_settings`;--> statement-breakpoint
ALTER TABLE `__new_retirement_settings` RENAME TO `retirement_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_settings_person_id_unique` ON `retirement_settings` (`person_id`);--> statement-breakpoint
CREATE INDEX `retirement_settings_person_id_idx` ON `retirement_settings` (`person_id`);
