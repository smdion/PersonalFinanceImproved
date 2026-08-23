CREATE TABLE `projection_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`input_hash` text NOT NULL,
	`seed` integer,
	`result` text NOT NULL,
	`computed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_read_at` integer DEFAULT (unixepoch()) NOT NULL,
	`engine_version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_cache_hash_version_idx` ON `projection_cache` (`input_hash`,`engine_version`);--> statement-breakpoint
CREATE INDEX `projection_cache_expires_at_idx` ON `projection_cache` (`expires_at`);
