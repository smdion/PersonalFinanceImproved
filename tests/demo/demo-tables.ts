/**
 * Every table beside DEMO_SHARED_TABLES, placed once: data a page reads or
 * empty on purpose; then what each profile leaves empty (ON_PURPOSE, GAPS).
 * Read by demo-completeness.test.ts and the PostgreSQL demo test.
 */
import { DEMO_PROFILES } from "@/lib/demo";

/** Tables a page reads that every demo profile should fill. */
export const DEMO_DATA_TABLES: readonly string[] = [
  // Reference data (applyReferenceData)
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
  "asset_class_params",
  "asset_class_correlations",
  "asset_class_buckets",
  "mc_presets",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
  // The household (seedProfile)
  "people",
  "jobs",
  "salary_profiles",
  "paycheck_deductions",
  "paycheck_earnings",
  "historical_salaries",
  "historical_notes",
  "budget_profiles",
  "budget_items",
  "budget_income_adjustments",
  "savings_goals",
  "savings_monthly",
  "savings_goal_profile_allocations",
  "savings_planned_transactions",
  "savings_planned_tx_settlements",
  "savings_allocation_overrides",
  "self_loans",
  "contribution_accounts",
  "contribution_profiles",
  "portfolio_snapshots",
  "portfolio_accounts",
  "performance_accounts",
  "annual_performance",
  "account_performance",
  "account_basis",
  "brokerage_goals",
  "brokerage_planned_transactions",
  "retirement_settings",
  "retirement_profiles",
  "retirement_profile_people",
  "retirement_salary_overrides",
  "retirement_budget_overrides",
  "retirement_scenarios",
  "projection_overrides",
  "return_rate_table",
  "glide_path_allocations",
  "mc_user_presets",
  "scenarios",
  "relocation_scenarios",
  "securities",
  "holding_periods",
  "holding_period_weights",
  "debts",
  "mortgage_loans",
  "mortgage_extra_payments",
  "mortgage_what_if_scenarios",
  "other_asset_items",
  "property_taxes",
  "home_improvement_items",
  "net_worth_annual",
  "utility_service",
  "utility_reading",
  "app_settings",
];

/** Tables a demo leaves empty on purpose, each with its reason. */
export const DEMO_EMPTY_TABLES: Readonly<Record<string, string>> = {
  api_connections: "integration credentials; a demo connects to nothing",
  budget_api_cache: "filled by a budget-app (Actual/YNAB) sync",
  budget_item_category_links: "links to budget-app categories",
  savings_goal_category_links: "links to budget-app categories",
  simplefin_accounts: "filled by a SimpleFIN sync",
  simplefin_account_balances: "filled by a SimpleFIN sync",
  simplefin_balance_snapshots: "filled by a SimpleFIN sync",
  investment_transactions: "filled by a SimpleFIN sync",
  holding_observations: "filled by a SimpleFIN sync",
  security_facts: "filled by the SEC fund-facts sync",
  sec_filing_cache: "SEC cache, re-fetchable",
  market_closes: "Tiingo cache, re-fetchable",
  sync_request_log: "outbound-request ledger",
  projection_cache: "rebuilt on demand",
  change_log: "the audit trail of edits",
  state_versions: "saved versions; a demo is rebuilt, never versioned",
  state_version_tables: "saved versions; a demo is rebuilt, never versioned",
  local_admins: "sign-in accounts, not household data",
};

export const ALL = Object.keys(DEMO_PROFILES);
const WORKING = ALL.filter((slug) => slug !== "recently-retired");
const DEBT_FREE = ["early-retirement", "recently-retired"];
const NEEDS_DEBTS = ["single-income", "dual-income-family"];

/** Empty on purpose, with the reason: the case checks it stays empty. */
export const ON_PURPOSE: Record<
  string,
  { profiles: string[]; reason: string }
> = {
  "expenses: budget.listApiActuals": {
    profiles: ALL,
    reason: "actual spending comes from a budget app",
  },
  "versions: version.list": {
    profiles: ALL,
    reason: "a demo is rebuilt, never versioned",
  },
  contribution_accounts: {
    profiles: ["recently-retired"],
    reason: "retired: no one contributes",
  },
  contribution_profiles: {
    profiles: ["recently-retired"],
    reason: "retired: no one contributes",
  },
  "profiles: contributionProfile.list": {
    profiles: ["recently-retired"],
    reason: "retired: no one contributes",
  },
  paycheck_deductions: {
    profiles: ["recently-retired"],
    reason: "retired: no paycheck",
  },
  paycheck_earnings: {
    profiles: ["recently-retired"],
    reason: "retired: no paycheck",
  },
  debts: { profiles: DEBT_FREE, reason: "debt-free persona" },
  "liabilities: debts.list": {
    profiles: DEBT_FREE,
    reason: "debt-free persona",
  },
  mortgage_loans: { profiles: ["single-income"], reason: "rents" },
  property_taxes: { profiles: ["single-income"], reason: "rents" },
  home_improvement_items: { profiles: ["single-income"], reason: "rents" },
  "house: assets.listPropertyTaxes": {
    profiles: ["single-income"],
    reason: "rents",
  },
  "liabilities: mortgage.computeActiveSummary": {
    profiles: ["single-income"],
    reason: "rents",
  },
};

/** Gaps filed under v0.11 Data and migrations, "Demo data gaps" (filling
 *  one moves demo figures): expected failures, by table or page read. */
export const GAPS: Record<string, string[]> = {
  account_basis: ALL,
  brokerage_goals: ALL,
  brokerage_planned_transactions: ALL,
  "brokerage: brokerage.listGoals": ALL,
  budget_income_adjustments: ALL,
  debts: NEEDS_DEBTS,
  "liabilities: debts.list": NEEDS_DEBTS,
  glide_path_allocations: ALL,
  historical_notes: ALL,
  historical_salaries: ALL,
  securities: ALL,
  holding_periods: ALL,
  holding_period_weights: ALL,
  mc_user_presets: ALL,
  mortgage_extra_payments: ALL,
  mortgage_what_if_scenarios: ALL,
  paycheck_deductions: WORKING,
  paycheck_earnings: WORKING,
  projection_overrides: ALL,
  relocation_scenarios: ALL,
  "tools: projection.relocationScenarios.list": ALL,
  retirement_budget_overrides: ALL,
  retirement_salary_overrides: ALL,
  retirement_scenarios: ALL,
  savings_allocation_overrides: ALL,
  savings_planned_transactions: ALL,
  savings_planned_tx_settlements: ALL,
  scenarios: ALL,
  self_loans: ALL,
  utility_service: ALL,
  utility_reading: ALL,
  "upkeep: utilities.listServices": ALL,
};

/** The tables a profile leaves empty today, sorted. */
export function expectedEmptyTables(slug: string, tables: readonly string[]) {
  return tables
    .filter(
      (table) =>
        ON_PURPOSE[table]?.profiles.includes(slug) ||
        GAPS[table]?.includes(slug),
    )
    .sort();
}
