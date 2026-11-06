/**
 * Registry of all tables included in state versions, ordered by FK dependency tier.
 *
 * Insert order: tier 0 → 1 → 2 → 3 (parent tables first).
 * Truncate: all tables in a single TRUNCATE ... CASCADE statement.
 *
 * Adding a new table = one entry here. Zero logic changes.
 */

type VersionTableEntry = {
  /** PostgreSQL table name (snake_case). */
  name: string;
  /** FK dependency tier: 0 = no FKs, 1 = depends on tier 0, 2 = depends on tier 1, 3 = depends on tier 2. */
  tier: number;
  /** "household": restored and previewed for the backup permission. "logins":
   *  never previewed. "installation": never previewed, and a non-admin's
   *  restore or import keeps today's credentials (installation-rows.ts). */
  scope: "household" | "logins" | "installation";
};

export const VERSION_TABLES: VersionTableEntry[] = [
  // Tier 0 — root tables (no FK dependencies)
  { name: "people", tier: 0, scope: "household" },
  { name: "budget_profiles", tier: 0, scope: "household" },
  { name: "savings_goals", tier: 0, scope: "household" },
  { name: "mortgage_loans", tier: 0, scope: "household" },
  { name: "contribution_limits", tier: 0, scope: "household" },
  { name: "retirement_scenarios", tier: 0, scope: "household" },
  { name: "return_rate_table", tier: 0, scope: "household" },
  { name: "tax_brackets", tier: 0, scope: "household" },
  { name: "ltcg_brackets", tier: 0, scope: "household" },
  { name: "irmaa_brackets", tier: 0, scope: "household" },
  { name: "fpl_by_household", tier: 0, scope: "household" },
  { name: "tax_params", tier: 0, scope: "household" },
  { name: "api_connections", tier: 0, scope: "installation" },
  { name: "app_settings", tier: 0, scope: "household" },
  { name: "local_admins", tier: 0, scope: "logins" },
  // These three must stay ahead of "scenarios" — scenarios.salary_profile_id,
  // .contribution_profile_id and .retirement_profile_id FK into them, and the
  // tier sort is stable, so array order decides insert order within tier 0.
  // The restore path in version-logic.ts does NOT disable FK checks (unlike
  // the session_replication_role import path), so getting this wrong fails
  // the restore outright.
  { name: "salary_profiles", tier: 0, scope: "household" },
  { name: "contribution_profiles", tier: 0, scope: "household" },
  { name: "retirement_profiles", tier: 0, scope: "household" },
  { name: "scenarios", tier: 0, scope: "household" },
  { name: "asset_class_params", tier: 0, scope: "household" },
  { name: "mc_presets", tier: 0, scope: "household" },
  { name: "portfolio_snapshots", tier: 0, scope: "household" },
  { name: "brokerage_goals", tier: 0, scope: "household" },
  { name: "net_worth_annual", tier: 0, scope: "household" },
  { name: "home_improvement_items", tier: 0, scope: "household" },
  { name: "other_asset_items", tier: 0, scope: "household" },
  { name: "historical_notes", tier: 0, scope: "household" },
  { name: "relocation_scenarios", tier: 0, scope: "household" },
  { name: "mc_user_presets", tier: 0, scope: "household" },
  { name: "utility_service", tier: 0, scope: "household" },
  { name: "simplefin_balance_snapshots", tier: 0, scope: "household" },
  { name: "securities", tier: 0, scope: "household" },
  { name: "security_facts", tier: 1, scope: "household" }, // FK into securities (tier 0); user-entered facts can't be re-fetched // no FKs (sample_description snapshot instead)

  // Tier 1 — depends on tier 0
  { name: "jobs", tier: 1, scope: "household" },
  { name: "historical_salaries", tier: 1, scope: "household" },
  { name: "savings_monthly", tier: 1, scope: "household" },
  { name: "savings_planned_transactions", tier: 1, scope: "household" },
  { name: "savings_allocation_overrides", tier: 1, scope: "household" },
  { name: "savings_goal_profile_allocations", tier: 1, scope: "household" },
  { name: "self_loans", tier: 1, scope: "household" },
  { name: "performance_accounts", tier: 1, scope: "household" },
  { name: "mortgage_what_if_scenarios", tier: 1, scope: "household" },
  { name: "mortgage_extra_payments", tier: 1, scope: "household" },
  { name: "debts", tier: 1, scope: "household" }, // FK owner_person_id → people (tier 0)
  { name: "retirement_settings", tier: 1, scope: "household" },
  // FKs both people (tier 0) and retirement_profiles (tier 0, ordered above).
  { name: "retirement_profile_people", tier: 1, scope: "household" },
  { name: "retirement_salary_overrides", tier: 1, scope: "household" },
  { name: "retirement_budget_overrides", tier: 1, scope: "household" },
  { name: "projection_overrides", tier: 1, scope: "household" },
  { name: "asset_class_correlations", tier: 1, scope: "household" },
  { name: "asset_class_buckets", tier: 1, scope: "household" }, // FK into asset_class_params
  { name: "glide_path_allocations", tier: 1, scope: "household" },
  { name: "brokerage_planned_transactions", tier: 1, scope: "household" },
  { name: "annual_performance", tier: 1, scope: "household" },
  { name: "property_taxes", tier: 1, scope: "household" },
  { name: "utility_reading", tier: 1, scope: "household" },

  // Tier 2 — depends on tier 1
  { name: "paycheck_deductions", tier: 2, scope: "household" },
  { name: "paycheck_earnings", tier: 2, scope: "household" }, // FK into jobs (tier 1)
  { name: "contribution_accounts", tier: 2, scope: "household" },
  { name: "portfolio_accounts", tier: 2, scope: "household" },
  { name: "account_performance", tier: 2, scope: "household" },
  { name: "mc_preset_glide_paths", tier: 2, scope: "household" },
  { name: "mc_preset_return_overrides", tier: 2, scope: "household" },
  { name: "savings_planned_tx_settlements", tier: 2, scope: "household" },
  { name: "budget_income_adjustments", tier: 2, scope: "household" },
  { name: "account_basis", tier: 2, scope: "household" }, // FKs into performance_accounts (tier 1) + people (tier 0)
  { name: "savings_goal_category_links", tier: 2, scope: "household" }, // FK into savings_goals (tier 0)
  { name: "simplefin_accounts", tier: 2, scope: "household" }, // FKs into performance_accounts (tier 1) + mortgage_loans
  { name: "holding_periods", tier: 2, scope: "household" }, // FK into performance_accounts (tier 1)

  // Tier 3 — depends on tier 2
  // SimpleFIN history (v0.8.5) — can't be re-fetched after 90 days, so versioned + backed up.
  { name: "simplefin_account_balances", tier: 3, scope: "household" }, // FK into simplefin_accounts (tier 2)
  { name: "holding_observations", tier: 3, scope: "household" }, // FKs into simplefin_accounts (tier 2), performance_accounts (tier 1), securities (tier 0)
  { name: "investment_transactions", tier: 3, scope: "household" }, // FK into simplefin_accounts (tier 2)
  { name: "budget_items", tier: 3, scope: "household" }, // FK into contribution_accounts (tier 2)
  { name: "holding_period_weights", tier: 3, scope: "household" }, // FKs into holding_periods (tier 2), securities (tier 0)

  // Tier 4 — depends on tier 3
  { name: "budget_item_category_links", tier: 4, scope: "household" }, // FK into budget_items (tier 3)
];

// Validate tier ordering: entries must be grouped by ascending tier. The
// migrator (db-migrate.ts) imports this too, so a mis-tiered entry stops it
// at load, before it touches the database.
(() => {
  let maxTier = -1;
  for (const entry of VERSION_TABLES) {
    if (entry.tier < maxTier) {
      throw new Error(
        `VERSION_TABLES ordering error: "${entry.name}" (tier ${entry.tier}) appears after tier ${maxTier}. ` +
          `Tables must be grouped by ascending tier.`,
      );
    }
    maxTier = Math.max(maxTier, entry.tier);
  }
})();

/** All table names in insert order (tier 0 → 1 → 2 → 3). */
export const VERSION_TABLE_NAMES = VERSION_TABLES.map((t) => t.name);

const namesIn = (scopes: VersionTableEntry["scope"][]) =>
  VERSION_TABLES.filter((t) => scopes.includes(t.scope)).map((t) => t.name);

/** Versioned, but never shown in a version preview: they hold credentials. */
export const VERSION_PREVIEW_WITHHELD_TABLES = namesIn([
  "logins",
  "installation",
]);

/** Versioned, but a non-admin's import or restore keeps today's credentials. */
export const ADMIN_ONLY_RESTORE_TABLES = namesIn(["installation"]);

/** The tables a restore or import takes from the backup whole: every one for
 *  an admin, all but ADMIN_ONLY_RESTORE_TABLES for anyone else. */
export function restoredTables(by: { asAdmin: boolean }): VersionTableEntry[] {
  return by.asAdmin
    ? VERSION_TABLES
    : VERSION_TABLES.filter((t) => t.scope !== "installation");
}

/** Excluded from versioning (audit/version tables + ephemeral caches). */
export const EXCLUDED_TABLES = [
  "change_log",
  "state_versions",
  "state_version_tables",
  "budget_api_cache",
  "projection_cache", // derived-from-inputs cache; rebuilt on demand, never user data
  "sync_request_log", // outbound-request quota ledger; operational, pruned after 30 days
  "sec_filing_cache", // normalised SEC filings by accession; re-fetchable
  "market_closes", // Tiingo daily closes; re-fetchable
  "tax_data_updates", // fetched community tax-data files + admin decisions; not household data
];
