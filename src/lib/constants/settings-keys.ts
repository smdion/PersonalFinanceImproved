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

// ── Salary Profile ──────────────────────────────────────────────────
export const SK_ACTIVE_SALARY_PROFILE_ID = "active_salary_profile_id";

// ── Retirement Profile ──────────────────────────────────────────────
/** The globally active Retirement Profile — the lowest tier of
 *  useEffectiveProfileId's resolution (Plan's choice → local selection →
 *  this). Required, not optional: without it a household with no active Plan
 *  resolves to no profile at all, and build-engine-payload returns null,
 *  which blanks the retirement page. Mirrors SK_ACTIVE_CONTRIB_PROFILE_ID /
 *  SK_ACTIVE_SALARY_PROFILE_ID above. */
export const SK_ACTIVE_RETIREMENT_PROFILE_ID = "active_retirement_profile_id";

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
/** Rate the projection engine grows IRS contribution limits by each future
 *  year (fraction, e.g. 0.02). Read at
 *  server/retirement/build-engine-payload.ts; unset → IRS_LIMIT_GROWTH_RATE
 *  constant. Editable in Settings → Reference Data → Return Rates. */
export const SK_IRS_LIMIT_GROWTH_RATE = "irs_limit_growth_rate";

// ── Savings ─────────────────────────────────────────────────────────
export const SK_EFUND_BUDGET_COLUMN = "efund_budget_column";
export const SK_SAVINGS_PROJECTION_YEARS = "savings_projection_years";

// ── Paycheck ────────────────────────────────────────────────────────
export const SK_PAYCHECK_TAX_YEAR = "paycheck_tax_year";
/** Dollars below the Roth IRA phase-out start "direct contribution OK" needs; unset = the range's width. */
export const SK_ROTH_IRA_DIRECT_MARGIN = "roth_ira_direct_margin";
/** Dollars of HSA cash to keep uninvested; unset = the year's HDHP minimum deductible for the coverage. */
export const SK_HSA_CASH_BUFFER = "hsa_cash_buffer";

/** Where each person's bonus goes — `{ [personId]: "budget" | "spending" }`.
 *  "spending" = extra spending outside the budget (its own Living Costs
 *  bar); unset = budget. Set on the Paycheck page, like extra paychecks. */
export const SK_BONUS_DESTINATIONS = "bonus_destinations";

// ── Dashboard Cards ─────────────────────────────────────────────────
export const SK_HIGH_INCOME_THRESHOLD = "high_income_threshold";
export const SK_SAVINGS_RATE_THRESHOLDS = "savings_rate_thresholds";
/** "auto" | "include" | "exclude" — employer match in savings rates and contribution totals. */
export const SK_SAVINGS_RATE_MATCH = "savings_rate_match";
/** Portfolio (non-retirement) money in savings rates and contribution totals. */
export const SK_SAVINGS_RATE_INCLUDE_PORTFOLIO =
  "savings_rate_include_portfolio";

// ── Milestones ──────────────────────────────────────────────────────
/** The household's own milestone goals (validated: customGoalsSchema). */
export const SK_MILESTONE_CUSTOM_GOALS = "milestone_custom_goals";
/** Ticked milestone checklist items (validated: milestoneChecklistSchema). */
export const SK_MILESTONE_CHECKLIST = "milestone_checklist";
/** "moneyGuy" | "fidelity" — which income-multiple checkpoints to follow. */
export const SK_MILESTONE_CHECKPOINT_SOURCE = "milestone_checkpoint_source";
/** The household's own target mix by age for what it holds today —
 *  separate from the retirement simulation's glide path (validated:
 *  currentGlidePathSchema). */
export const SK_CURRENT_GLIDE_PATH = "current_glide_path";
/** Dismissed/snoozed recommendations (validated: dismissalsSchema). */
export const SK_RECOMMENDATION_DISMISSALS = "recommendation_dismissals";
/** "moneyGuy" | "personalFinance" — which savings-rate rule to follow. */
export const SK_MILESTONE_SAVINGS_TARGET_SOURCE =
  "milestone_savings_target_source";

// ── Settings Page ───────────────────────────────────────────────────
export const SK_SETTINGS_ACTIVE_TAB = "settings_active_tab";
export const SK_SETTINGS_TAX_DATA_SECTION = "settings_tax_data_section";
export const SK_SETTINGS_TAX_DATA_YEAR = "settings_tax_data_year";
export const SK_SETTINGS_ACCESS_CONTROL_SECTION =
  "settings_access_control_section";
export const SK_SETTINGS_INTEGRATIONS_SECTION = "settings_integrations_section";
export const SK_SETTINGS_GENERAL_SECTION = "settings_general_section";
export const SK_SETTINGS_DEBUG_SECTION = "settings_debug_section";

// ── Debug ───────────────────────────────────────────────────────────
export const SK_DIAG_MODE = "diag_mode";

// ── Household ───────────────────────────────────────────────────────
/** IANA time zone the server's date math runs in (e.g. "America/Chicago"). */
export const SK_HOUSEHOLD_TIMEZONE = "household_timezone";
