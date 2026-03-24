CREATE TABLE `mc_user_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`simulations` integer DEFAULT 1000 NOT NULL,
	`return_mean` text NOT NULL,
	`return_std_dev` text NOT NULL,
	`inflation_mean` text NOT NULL,
	`inflation_std_dev` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
