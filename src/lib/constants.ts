/**
 * Shared constants — single source of truth for values used across routers and calculators.
 * Avoids magic numbers scattered throughout the codebase.
 */

/** Milliseconds per day (24 * 60 * 60 * 1000). */
export const MS_PER_DAY = 86_400_000;

/** Average days per year, accounting for leap years (365.25). */
export const DAYS_PER_YEAR = 365.25;

/** MS_PER_DAY * DAYS_PER_YEAR — used for age calculations. */
export const MS_PER_YEAR = MS_PER_DAY * DAYS_PER_YEAR;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const MONTHS_PER_YEAR = 12;

// ---------------------------------------------------------------------------
// Withdrawal & Decumulation
// ---------------------------------------------------------------------------

/** Default safe withdrawal rate (the "4% rule"). */
export const DEFAULT_WITHDRAWAL_RATE = 0.04;

// ---------------------------------------------------------------------------
// Return Rates
// ---------------------------------------------------------------------------

/** Default nominal return rate fallback when no user-configured rate is available. */
export const DEFAULT_RETURN_RATE = 0.07;

/** Default annual inflation rate fallback when no user-configured rate is available. */
export const DEFAULT_INFLATION_RATE = 0.03;

// ---------------------------------------------------------------------------
// Income Thresholds
// ---------------------------------------------------------------------------

/** High income threshold for savings rate display (show employee-only rate as headline). */
export const DEFAULT_HIGH_INCOME_THRESHOLD = 200_000;

// Default withdrawal splits are defined in src/lib/config/account-types.ts
// (derived from each account type's defaultWithdrawalSplit config property)

// ---------------------------------------------------------------------------
// Contribution Defaults
// ---------------------------------------------------------------------------

/** Fallback contribution rate when a contribution profile has a spec without a
 *  matching account or when income data is missing. Prevents the engine from
 *  silently contributing 0% for users who haven't fully configured their profile. */
export const FALLBACK_CONTRIBUTION_RATE = 0.25;

/** Fallback pay periods per year (biweekly) when a job's schedule can't be resolved. */
export const DEFAULT_PAY_PERIODS_PER_YEAR = 26;

// ---------------------------------------------------------------------------
// Distribution Tax Rates (defaults for new retirement scenarios)
// ---------------------------------------------------------------------------

export const DEFAULT_TAX_RATE_TRADITIONAL = 0.22;
export const DEFAULT_TAX_RATE_ROTH = 0;
export const DEFAULT_TAX_RATE_BROKERAGE = 0.15;

// ---------------------------------------------------------------------------
// Wealth Score (Millionaire Next Door formula)
// ---------------------------------------------------------------------------

/** Age at which the wealth formula denominator stops decreasing. */
export const WEALTH_FORMULA_AGE_CUTOFF = 40;

/** Base denominator in (age × salary) / (BASE + yearsUntil40) × MULTIPLIER. */
export const WEALTH_FORMULA_BASE_DENOMINATOR = 10;

/** Multiplier applied to the wealth target formula. */
export const WEALTH_FORMULA_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Financial Independence
// ---------------------------------------------------------------------------

/** FI progress ≥ 1.0 means fully financially independent. */
export const FI_COMPLETE_THRESHOLD = 1.0;

/** Performance data older than this many days is considered "Outdated". */
export const PERFORMANCE_STALE_DAYS = 14;

// ---------------------------------------------------------------------------
// IRS Limit Growth
// ---------------------------------------------------------------------------

/** Assumed annual growth rate for IRS contribution limits. */
export const IRS_LIMIT_GROWTH_RATE = 0.02;

// ---------------------------------------------------------------------------
// RMD / Excise Tax
// ---------------------------------------------------------------------------

/** IRS excise tax rate on a missed/shortfalled RMD (25% under SECURE 2.0). */
export const RMD_EXCISE_TAX_RATE = 0.25;

// ---------------------------------------------------------------------------
// Withdrawal Strategy Defaults
// ---------------------------------------------------------------------------

/** Default withdrawal percentage shared by constant-percentage, Vanguard
 *  dynamic, and endowment withdrawal strategies. */
export const DEFAULT_STRATEGY_WITHDRAWAL_PERCENT = 0.05;

/** Default spending floor (as a fraction of the initial withdrawal amount)
 *  shared by the constant-percentage and endowment withdrawal strategies. */
export const DEFAULT_STRATEGY_FLOOR_PERCENT = 0.9;

/** Default rolling-average window (years) for the endowment withdrawal
 *  strategy. Confirmed 2026-08-19: the UI config previously defaulted this
 *  to 5 while the engine and server fallback both used 10 — a real,
 *  user-facing divergence. Standardized on 10 (majority — engine, server
 *  fallback, and methodology docs all already agreed) and wired all three
 *  layers to this one constant so they can't drift apart again. */
export const DEFAULT_ENDOWMENT_ROLLING_YEARS = 10;

// ---------------------------------------------------------------------------
// Monte Carlo / Projection
// ---------------------------------------------------------------------------

/** Success-rate threshold above which a Monte Carlo plan is considered
 *  "confident" (e.g. Coast FIRE reachability, strategy diagnosis). */
export const MC_CONFIDENCE_THRESHOLD = 0.9;

/** Default per-year return clamps for Monte Carlo trials (max 50% loss,
 *  max 100% gain), shared by the calculator's own default and the server
 *  fallback used when no preset is selected. */
export const MC_RETURN_CLAMP_MIN = -0.5;
export const MC_RETURN_CLAMP_MAX = 1.0;

/** A trial is "spending stable" if withdrawals stay at or above this
 *  fraction of the initial inflation-adjusted withdrawal in every
 *  decumulation year. */
export const MC_SPENDING_STABILITY_THRESHOLD = 0.75;

/** Default inflation risk assumption for Monte Carlo simulations when no
 *  preset-specific value is configured. */
export const DEFAULT_MC_INFLATION_RISK = { meanRate: 0.025, stdDev: 0.012 };

/** Default number of trials for a Monte Carlo simulation run. */
export const MC_DEFAULT_TRIALS = 1000;

/** React Query staleTime for projection queries (1 minute). */
export const PROJECTION_STALE_TIME_MS = 60_000;

/** Debounce delay applied to projection engine inputs before firing queries. */
export const PROJECTION_DEBOUNCE_MS = 600;

// ---------------------------------------------------------------------------
// Tolerances
// ---------------------------------------------------------------------------

/** Allocation tolerance — allocations summing within this of 1.0 are acceptable. */
export const ALLOCATION_TOLERANCE = 0.01;

/** Amortization loop stops when remaining balance drops below this. */
export const AMORTIZATION_BALANCE_TOLERANCE = 0.005;

/** Suppress overflow rounding noise below this dollar amount. */
export const OVERFLOW_TOLERANCE = 1;

/** Maximum sane effective tax rate (50%). */
export const MAX_EFFECTIVE_TAX_RATE = 0.5;

/** Funding ratio above which an account is considered over the IRS limit (filters rounding noise). */
export const OVER_LIMIT_THRESHOLD = 1.005;

/** Change detection threshold for contribution warnings (1 cent). */
export const CHANGE_DETECTION_THRESHOLD = 0.01;

/** Ending balance mismatch warning: absolute floor in dollars. */
export const PERF_BALANCE_MISMATCH_ABS = 5;

/** Ending balance mismatch warning: relative threshold (0.01% of portfolio total). */
export const PERF_BALANCE_MISMATCH_PCT = 0.0001;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Maximum extra mortgage payments to generate (50 years × 12 months). */
export const MAX_EXTRA_PAYMENTS = 600;

// ---------------------------------------------------------------------------
// Input Safeguards (engine hardening)
// ---------------------------------------------------------------------------

/** Return rates below -100% would produce negative balances. */
export const MIN_RETURN_RATE = -1;

/** Ceiling on inflation rate (20%) — hyperinflation guard. */
export const MAX_INFLATION_RATE = 0.2;

/** Floor on inflation rate (-10%) — deflation guard. */
export const MIN_INFLATION_RATE = -0.1;

/** Cap the brokerage ramp multiplier year to prevent unbounded growth. */
export const MAX_BROKERAGE_RAMP_YEARS = 40;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** Show coverage indicator when holdings weight sum deviates this far from
 *  10000 bps (100%). Applies to both under and over coverage. */
export const ANALYTICS_WEIGHT_COVERAGE_WARN_BPS = 500; // 5%

/** Default number of snapshots to fetch for historical allocation/drift charts. */
export const ANALYTICS_HISTORY_SNAPSHOT_LIMIT = 12;

// ---------------------------------------------------------------------------
// Settings Forms
// ---------------------------------------------------------------------------

/** Minimum tax year selectable/editable across bracket and limit settings editors. */
export const TAX_YEAR_MIN = 2020;

/** Maximum tax year selectable/editable across bracket and limit settings editors. */
export const TAX_YEAR_MAX = 2040;

// ---------------------------------------------------------------------------
// Mortgage
// ---------------------------------------------------------------------------

/** Default closing costs assumption ($) for the refinance calculator. */
export const DEFAULT_REFI_CLOSING_COSTS = "5000";

// ---------------------------------------------------------------------------
// Loan Defaults (relocation large-purchase planning)
// ---------------------------------------------------------------------------

/** Default down payment, as a whole-number percent (20 = 20%). */
export const DEFAULT_LOAN_DOWN_PAYMENT_PERCENT = 20;

/** Default loan interest rate, as a whole-number percent (6.5 = 6.5%). */
export const DEFAULT_LOAN_RATE = 6.5;

/** Default loan term in years. */
export const DEFAULT_LOAN_TERM_YEARS = 30;
