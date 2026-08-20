-- SQLite twin of drizzle/0018_fk_index_cleanup.sql (Postgres) — see that
-- file's header for the full rationale.
CREATE INDEX `contribution_accounts_perf_acct_idx` ON `contribution_accounts` (`performance_account_id`);--> statement-breakpoint
CREATE INDEX `performance_accounts_owner_id_idx` ON `performance_accounts` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `savings_goal_profile_alloc_profile_idx` ON `savings_goal_profile_allocations` (`budget_profile_id`);--> statement-breakpoint
CREATE INDEX `mc_preset_gp_asset_class_idx` ON `mc_preset_glide_paths` (`asset_class_id`);--> statement-breakpoint
CREATE INDEX `mc_preset_ro_asset_class_idx` ON `mc_preset_return_overrides` (`asset_class_id`);--> statement-breakpoint
DROP INDEX `idx_portfolio_accounts_owner`;
