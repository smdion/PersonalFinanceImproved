/**
 * Registry of all tables included in state versions, ordered by FK dependency tier.
 *
 * Insert order: tier 0 → 1 → 2 (parent tables first).
 * Truncate: all tables in a single TRUNCATE ... CASCADE statement.
 *
 * Adding a new table = one entry here. Zero logic changes.
 */

export type VersionTableEntry = {
  /** PostgreSQL table name (snake_case). */
  name: string;
  /** FK dependency tier: 0 = no FKs, 1 = depends on tier 0, 2 = depends on tier 1. */
  tier: number;
};

export const VERSION_TABLES: VersionTableEntry[] = [
  // Tier 0 — root tables (no FK dependencies)
  { name: "people", tier: 0 },
  { name: "budget_profiles", tier: 0 },
  { name: "savings_goals", tier: 0 },
  { name: "mortgage_loans", tier: 0 },
  { name: "contribution_limits", tier: 0 },
  { name: "retirement_scenarios", tier: 0 },
  { name: "return_rate_table", tier: 0 },
  { name: "tax_brackets", tier: 0 },
  { name: "api_connections", tier: 0 },
  { name: "app_settings", tier: 0 },
  { name: "local_admins", tier: 0 },
  { name: "scenarios", tier: 0 },
  { name: "asset_class_params", tier: 0 },
  { name: "mc_presets", tier: 0 },
  { name: "portfolio_snapshots", tier: 0 },
  { name: "brokerage_goals", tier: 0 },
  { name: "contribution_profiles", tier: 0 },
  { name: "net_worth_annual", tier: 0 },
  { name: "home_improvement_items", tier: 0 },
  { name: "other_asset_items", tier: 0 },
  { name: "historical_notes", tier: 0 },
  { name: "relocation_scenarios", tier: 0 },

  // Tier 1 — depends on tier 0
  { name: "jobs", tier: 1 },
  { name: "budget_items", tier: 1 },
  { name: "savings_monthly", tier: 1 },
  { name: "savings_planned_transactions", tier: 1 },
  { name: "savings_allocation_overrides", tier: 1 },
  { name: "self_loans", tier: 1 },
  { name: "performance_accounts", tier: 1 },
  { name: "mortgage_what_if_scenarios", tier: 1 },
  { name: "mortgage_extra_payments", tier: 1 },
  { name: "retirement_settings", tier: 1 },
  { name: "retirement_salary_overrides", tier: 1 },
  { name: "retirement_budget_overrides", tier: 1 },
  { name: "asset_class_correlations", tier: 1 },
  { name: "glide_path_allocations", tier: 1 },
  { name: "brokerage_planned_transactions", tier: 1 },
  { name: "annual_performance", tier: 1 },
  { name: "property_taxes", tier: 1 },

  // Tier 2 — depends on tier 1
  { name: "salary_changes", tier: 2 },
  { name: "paycheck_deductions", tier: 2 },
  { name: "contribution_accounts", tier: 2 },
  { name: "portfolio_accounts", tier: 2 },
  { name: "account_performance", tier: 2 },
  { name: "mc_preset_glide_paths", tier: 2 },
  { name: "mc_preset_return_overrides", tier: 2 },
];

// Validate tier ordering: entries must be grouped by tier (0, then 1, then 2).
// This catches accidental mis-ordering when adding new tables.
(() => {
  let maxTier = -1;
  for (const entry of VERSION_TABLES) {
    if (entry.tier < maxTier) {
      throw new Error(
        `VERSION_TABLES ordering error: "${entry.name}" (tier ${entry.tier}) appears after tier ${maxTier}. ` +
          `Tables must be grouped by tier (0 → 1 → 2).`,
      );
    }
    maxTier = Math.max(maxTier, entry.tier);
  }
})();

/** All table names in insert order (tier 0 → 1 → 2). */
export const VERSION_TABLE_NAMES = VERSION_TABLES.map((t) => t.name);

/** Excluded from versioning (audit/version tables + ephemeral caches). */
export const EXCLUDED_TABLES = [
  "change_log",
  "state_versions",
  "state_version_tables",
  "budget_api_cache",
];
