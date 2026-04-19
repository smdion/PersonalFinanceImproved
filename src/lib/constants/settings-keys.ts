/**
 * Centralized keys for usePersistedSetting / usePersistedToggle.
 *
 * These keys are stored in both localStorage (for instant reads) and the
 * app_settings DB table (for cross-session persistence). Using constants
 * prevents typo bugs and makes it easy to find all usages via "Find References".
 *
 * When adding a new persisted setting, add the key here first.
 */

// ── Budget ──────────────────────────────────────────────────────────
export const SK_BUDGET_ACTIVE_COLUMN = "budget_active_column";
export const SK_BUDGET_NAME_COL_WIDTH = "budget_name_col_width";

// ── Contribution Profile ────────────────────────────────────────────
export const SK_ACTIVE_CONTRIB_PROFILE_ID = "active_contrib_profile_id";

// ── Retirement ──────────────────────────────────────────────────────
export const SK_RETIREMENT_SIMULATION_AUTOLOAD =
  "retirement_simulation_autoload";
export const SK_RETIREMENT_MC_AUTOLOAD = "retirement_mc_autoload";
export const SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD =
  "retirement_coastfire_mc_autoload";
export const SK_RETIREMENT_ACC_BUDGET_PROFILE_ID =
  "retirement_acc_budget_profile_id";
export const SK_RETIREMENT_ACC_BUDGET_COL =
  "retirement_accumulation_budget_column";
export const SK_RETIREMENT_ACC_EXPENSE_OVERRIDE =
  "retirement_acc_expense_override";
export const SK_RETIREMENT_DEC_BUDGET_PROFILE_ID =
  "retirement_dec_budget_profile_id";
export const SK_RETIREMENT_DEC_BUDGET_COL =
  "retirement_decumulation_budget_column";
export const SK_RETIREMENT_DEC_EXPENSE_OVERRIDE =
  "retirement_dec_expense_override";
export const SK_RETIREMENT_COMPARISON_EXPANDED =
  "retirement_comparison_expanded";

// ── Savings ─────────────────────────────────────────────────────────
export const SK_EFUND_BUDGET_COLUMN = "efund_budget_column";
export const SK_SAVINGS_PROJECTION_YEARS = "savings_projection_years";

// ── Paycheck ────────────────────────────────────────────────────────
export const SK_PAYCHECK_TAX_YEAR = "paycheck_tax_year";

// ── Dashboard Cards ─────────────────────────────────────────────────
export const SK_HIGH_INCOME_THRESHOLD = "high_income_threshold";
export const SK_SAVINGS_RATE_THRESHOLDS = "savings_rate_thresholds";

// ── Settings Page ───────────────────────────────────────────────────
export const SK_SETTINGS_ACTIVE_TAB = "settings_active_tab";

// ── Debug ───────────────────────────────────────────────────────────
export const SK_DIAG_MODE = "diag_mode";
