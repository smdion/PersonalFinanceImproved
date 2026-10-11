CREATE TABLE `sec_filing_cache` (
	`accession` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`period_end` text NOT NULL,
	`us_equity_pct` text,
	`intl_equity_pct` text,
	`us_bond_pct` text,
	`intl_bond_pct` text,
	`tips_pct` text,
	`cash_pct` text,
	`other_pct` text,
	`coverage` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sec_filing_cache_series_idx` ON `sec_filing_cache` (`series_id`);--> statement-breakpoint
CREATE TABLE `security_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`security_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`sec_series_id` text,
	`accession` text,
	`expense_ratio` text,
	`us_equity_pct` text,
	`intl_equity_pct` text,
	`us_bond_pct` text,
	`intl_bond_pct` text,
	`tips_pct` text,
	`cash_pct` text,
	`other_pct` text,
	`coverage` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_facts_identity_idx` ON `security_facts` (`security_id`,`source`,`as_of`);--> statement-breakpoint
CREATE INDEX `security_facts_security_idx` ON `security_facts` (`security_id`);--> statement-breakpoint
ALTER TABLE `asset_class_params` ADD `composition_bucket` text;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_class_params_composition_bucket_idx` ON `asset_class_params` (`composition_bucket`) WHERE "asset_class_params"."composition_bucket" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `securities` ADD `sec_series_id` text;--> statement-breakpoint
ALTER TABLE `securities` ADD `sec_class_id` text;--> statement-breakpoint
ALTER TABLE `securities` ADD `facts_series_id` text;--> statement-breakpoint
ALTER TABLE `securities` ADD `facts_class_id` text;--> statement-breakpoint
ALTER TABLE `securities` ADD `facts_basis` text;--> statement-breakpoint
ALTER TABLE `securities` ADD `standin_confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `securities` ADD `facts_checked_at` integer;--> statement-breakpoint
-- Best-effort: link the standard asset class names to composition buckets.
-- Households with other names link them on the Benchmarks page.
UPDATE "asset_class_params" SET "composition_bucket" = CASE "name" WHEN 'US Equities' THEN 'us_equity' WHEN 'International Equities' THEN 'intl_equity' WHEN 'US Bonds' THEN 'us_bond' WHEN 'International Bonds' THEN 'intl_bond' WHEN 'TIPS' THEN 'tips' WHEN 'Cash' THEN 'cash' END WHERE "composition_bucket" IS NULL AND "name" IN ('US Equities', 'International Equities', 'US Bonds', 'International Bonds', 'TIPS', 'Cash');