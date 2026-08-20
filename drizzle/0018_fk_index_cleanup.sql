-- Batch 6 audit findings 2-4: 5 FK columns with no dedicated index (each
-- was previously only a non-leading column of a composite unique/regular
-- index, which doesn't serve single-column lookups), plus one duplicate
-- index on portfolio_accounts.owner_person_id.
--
-- savings_goal_profile_allocations and the two mc_preset_* tables are
-- small (tens of rows) — the planner will seq-scan them regardless of
-- this index; added for consistency and future-proofing, not a measured
-- perf win. contribution_accounts/performance_accounts are larger and
-- this closes a real single-column lookup gap.
CREATE INDEX "contribution_accounts_perf_acct_idx" ON "contribution_accounts" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "performance_accounts_owner_id_idx" ON "performance_accounts" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "savings_goal_profile_alloc_profile_idx" ON "savings_goal_profile_allocations" USING btree ("budget_profile_id");--> statement-breakpoint
CREATE INDEX "mc_preset_gp_asset_class_idx" ON "mc_preset_glide_paths" USING btree ("asset_class_id");--> statement-breakpoint
CREATE INDEX "mc_preset_ro_asset_class_idx" ON "mc_preset_return_overrides" USING btree ("asset_class_id");--> statement-breakpoint
DROP INDEX "idx_portfolio_accounts_owner";
