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

/** Wealth score ≥ 1.0 = PAW (Prodigious Accumulator of Wealth). */
export const PAW_THRESHOLD = 1.0;

/** Wealth score ≥ 0.5 = AAW (Average Accumulator of Wealth). */
export const AAW_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Financial Independence
// ---------------------------------------------------------------------------

/** FI progress ≥ 1.0 means fully financially independent. */
export const FI_COMPLETE_THRESHOLD = 1.0;

/** FI progress ≥ 0.5 shown as yellow (on track). */
export const FI_ON_TRACK_THRESHOLD = 0.5;

/** Performance data older than this many days is considered "Outdated". */
export const PERFORMANCE_STALE_DAYS = 14;

// ---------------------------------------------------------------------------
// IRS Limit Growth
// ---------------------------------------------------------------------------

/** Assumed annual growth rate for IRS contribution limits. */
export const IRS_LIMIT_GROWTH_RATE = 0.02;

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

/** Minimum bar width percentage for contribution visualization. */
export const MIN_BAR_WIDTH_PCT = 0.005;

/** Change detection threshold for contribution warnings (1 cent). */
export const CHANGE_DETECTION_THRESHOLD = 0.01;

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
