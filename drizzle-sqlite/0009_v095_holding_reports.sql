-- Keep every report's holdings: one row per (feed, fund, report time)
-- instead of per assumed day, so a feed a market day behind no longer
-- overwrites the day before. Existing rows already differ by report time
-- (as_of came from it), so the new unique index builds on any data.
DROP INDEX `holding_observations_simplefin_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_simplefin_report_idx` ON `holding_observations` (`simplefin_account_id`,`security_id`,`balance_date`) WHERE "holding_observations"."simplefin_account_id" IS NOT NULL AND "holding_observations"."balance_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_observations_simplefin_idx` ON `holding_observations` (`simplefin_account_id`,`security_id`,`as_of`) WHERE "holding_observations"."simplefin_account_id" IS NOT NULL AND "holding_observations"."balance_date" IS NULL;