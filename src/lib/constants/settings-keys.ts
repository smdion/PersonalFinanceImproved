/** Keys for usePersistedSetting / usePersistedToggle, stored in localStorage (instant reads)
 *  and the app_settings table (persistence). Every persisted setting's key goes here. */

// ── Budget ──────────────────────────────────────────────────────────
export const SK_BUDGET_ACTIVE_COLUMN = "budget_active_column";
export const SK_BUDGET_NAME_COL_WIDTH = "budget_name_col_width";

// ── Contribution Profile ────────────────────────────────────────────
export const SK_ACTIVE_CONTRIB_PROFILE_ID = "active_contrib_profile_id";

// ── Salary Profile ──────────────────────────────────────────────────
export const SK_ACTIVE_SALARY_PROFILE_ID = "active_salary_profile_id";

// ── Retirement Profile ──────────────────────────────────────────────
/** The globally active Retirement Profile: useEffectiveProfileId's last tier (Plan's choice →
 *  local selection → this). Required: without it a household with no active Plan gets no
 *  profile and a blank retirement page. */
export const SK_ACTIVE_RETIREMENT_PROFILE_ID = "active_retirement_profile_id";
/** The Plan last applied (scenarios.id) — only so the header can offer
 *  "Update ‹Plan›" after a profile changes; which Plan is in use is derived
 *  from the active profiles, never read from here. */
export const SK_LAST_APPLIED_PLAN_ID = "last_applied_plan_id";

// ── Retirement ──────────────────────────────────────────────────────
export const SK_RETIREMENT_SIMULATION_AUTOLOAD =
  "retirement_simulation_autoload";
export const SK_RETIREMENT_MC_AUTOLOAD = "retirement_mc_autoload";
export const SK_RETIREMENT_COASTFIRE_SIMULATION_AUTOLOAD =
  "retirement_coastfire_mc_autoload";
export const SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID =
  "retirement_dec_budget_profile_id";
export const SK_RETIREMENT_DECUMULATION_BUDGET_COL =
  "retirement_decumulation_budget_column";
export const SK_RETIREMENT_DECUMULATION_EXPENSE_OVERRIDE =
  "retirement_dec_expense_override";
export const SK_RETIREMENT_COMPARISON_EXPANDED =
  "retirement_comparison_expanded";
/** Yearly growth of IRS contribution limits in projections (fraction, e.g. 0.02); unset →
 *  IRS_LIMIT_GROWTH_RATE. Editable in Settings → Reference Data → Return Rates. */
export const SK_IRS_LIMIT_GROWTH_RATE = "irs_limit_growth_rate";

// ── Savings ─────────────────────────────────────────────────────────
export const SK_EFUND_BUDGET_COLUMN = "efund_budget_column";
export const SK_SAVINGS_PROJECTION_YEARS = "savings_projection_years";

// ── Paycheck ────────────────────────────────────────────────────────
export const SK_PAYCHECK_TAX_YEAR = "paycheck_tax_year";
/** Dollars below the Roth IRA phase-out start "direct contribution OK" needs; unset = the range's width. */
export const SK_ROTH_IRA_DIRECT_MARGIN = "roth_ira_direct_margin";
/** The filing status on this year's tax return (MFJ / Single / HOH); unset = the active Retirement Profile's, else a W-4. */
export const SK_TAX_FILING_STATUS = "tax_filing_status";
/** Dollars of HSA cash to keep uninvested; unset = the year's HDHP minimum deductible for the coverage. */
export const SK_HSA_CASH_BUFFER = "hsa_cash_buffer";

/** Simulation preset the Retirement page's Simulation and strategy comparison use; unset = Default. */
export const SK_SIMULATION_PRESET = "simulation_preset";

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
/** When each milestone was first reached (lib/pure/advice/milestone-first-reached.ts). */
export const SK_MILESTONE_FIRST_REACHED = "milestone_first_reached";
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

/** Community tax-data updates on (true) or off. Unset = off: existing
 *  installs opt in; onboarding offers it to new ones. */
export const SK_TAX_DATA_SYNC_ENABLED = "tax_data_sync_enabled";
/** The last community tax-data check: `{ at, result, detail? }`. */
export const SK_TAX_DATA_LAST_CHECK = "tax_data_last_check";

/** Onboarding finished (true), or the first-admin gate is open (false): first-run.ts. */
export const SK_ONBOARDING_COMPLETED = "onboarding_completed";

/** Custom Simulation return clamps: { returnClampMin, returnClampMax }. */
export const SK_SIMULATION_CUSTOM_CLAMP_BOUNDS = "mc_custom_clamp_bounds";

// ── Reset ───────────────────────────────────────────────────────────

/** app_settings keys describing the household's data (row ids, derived history, sync state),
 *  which "reset all data" clears with the tables; setup keys stay. */
export const DATA_SETTING_KEYS: readonly string[] = [
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_LAST_APPLIED_PLAN_ID,
  SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
  SK_MILESTONE_FIRST_REACHED,
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_CUSTOM_GOALS,
  SK_RECOMMENDATION_DISMISSALS,
  SK_CURRENT_GLIDE_PATH,
  "mc_asset_class_overrides", // asset-class ids, emptied with the classes
  "active_budget_api",
  "current_other_liabilities",
  "performance_last_updated",
  "basis_last_updated",
  "simplefin_fill_ledger",
  "simplefin_investments_first_synced_at",
  "simplefin_investments_synced_at",
  "simplefin_last_error",
  "simplefin_partial_sync_state",
];
