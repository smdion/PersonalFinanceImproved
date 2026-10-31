-- Tiingo daily closes kept in the database (re-fetchable; not backed up):
-- each close is fetched once, so a restart or a rate limit loses nothing.
CREATE TABLE `market_closes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`close` text NOT NULL,
	`div_cash` text DEFAULT '0' NOT NULL,
	`split_factor` text DEFAULT '1' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_closes_ticker_date_idx` ON `market_closes` (`ticker`,`date`);