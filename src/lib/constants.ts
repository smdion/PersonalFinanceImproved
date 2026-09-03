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

/** Assumed annual growth rate for IRS contribution limits (fraction). Used
 *  when the `irs_limit_growth_rate` app-setting is unset. */
export const IRS_LIMIT_GROWTH_RATE = 0.02;

/** Sanity ceiling for a user-set `irs_limit_growth_rate` — enforced in the
 *  settings UI and clamped server-side on read (build-engine-payload.ts). */
export const IRS_LIMIT_GROWTH_RATE_MAX = 0.1;

// ---------------------------------------------------------------------------
// RMD / Excise Tax
// ---------------------------------------------------------------------------

/** IRS excise tax rate on a missed/shortfalled RMD (25% under SECURE 2.0). */
export const RMD_EXCISE_TAX_RATE = 0.25;

// ---------------------------------------------------------------------------
// Early-Access Ages (shared by the Tax Buckets analysis tool and
// the retirement projection engine's withdrawal-eligibility gate —
// both consume `src/lib/pure/early-access.ts`'s leaf predicates, which read
// these constants)
// ---------------------------------------------------------------------------

/** Age at/after which separating from an employer grants penalty-free access
 *  to that employer's 401k/403b (IRC §72(t)(2)(A)(v), the "Rule of 55"). */
export const RULE_OF_55_AGE = 55;

/** Age at which retirement-account withdrawals become penalty-free generally
 *  (and, combined with the 5-year clock, "qualified"/tax-free for Roth).
 *
 *  Non-integer threshold under year-granularity age modeling
 *  (`ageInYear` in `src/lib/utils/date.ts`, used everywhere the engine
 *  reasons about age): `ageInYear(...) >= 59.5` is only ever true when
 *  `ageInYear(...) >= 60` — integer age comparison against a `.5` threshold
 *  rounds the eligibility start up to the year the person turns 60, not the
 *  year they turn 59.5. Correct and intentional, not an off-by-one. */
export const PENALTY_FREE_AGE = 59.5;

/** Years a Roth conversion must season before it's penalty-free to withdraw
 *  (each conversion has its own clock — IRS ordering rules, ROTH_CONVERSION_SEASONING_YEARS
 *  is applied per the user's tracked latest-conversion-year, conservatively). */
export const ROTH_CONVERSION_SEASONING_YEARS = 5;

/** Age at which HSA withdrawals for non-medical expenses stop incurring the
 *  20% penalty (ordinary income tax still applies — this only removes the
 *  penalty, unlike the Medicare-eligibility age which is a separate, later
 *  threshold). Qualified medical withdrawals are always penalty-free and
 *  tax-free at any age, so this only matters for the non-medical case. */
export const HSA_NON_MEDICAL_PENALTY_AGE = 65;

/** Age at which a taxpayer qualifies for the additional standard deduction
 *  under IRC §63(f)(1) ("65 or older"). A person is treated as 65 for the
 *  whole tax year if they turn 65 by the first day of the following year, but
 *  the projection works in whole years so a simple `age >= 65` test is used.
 *  Distinct from the OBBBA senior deduction (2025–2028, MAGI-phased), which
 *  is deliberately NOT modeled — see `toLtcgTaxableIncome`. */
export const ADDITIONAL_STANDARD_DEDUCTION_AGE = 65;

/** 10% early-withdrawal penalty rate for Traditional/Roth IRA and 401k/403b
 *  (IRC §72(t)) — every account type this module gates EXCEPT HSA, which
 *  has its own, higher rate (see `HSA_NON_MEDICAL_PENALTY_RATE` immediately
 *  below — this is NOT a uniform "one rate for every account type" the way
 *  the age thresholds above are per-account-type but the penalty rate
 *  itself is not: HSA's non-medical penalty is legally 20%, not 10%, and
 *  applying 10% there would understate a real cost for exactly the account
 *  type where this feature is
 *  making the biggest behavior change). Used by
 *  `src/lib/pure/early-withdrawal-penalty.ts`. */
export const EARLY_WITHDRAWAL_PENALTY_RATE = 0.1;

/** 20% early-withdrawal penalty rate for HSA non-medical distributions
 *  before `HSA_NON_MEDICAL_PENALTY_AGE` (IRC §223(f)(4)) — double the
 *  retirement-account rate above. Real, not a placeholder: this codebase's
 *  own `computeHsaAccess` docblock already names the 20% figure. */
export const HSA_NON_MEDICAL_PENALTY_RATE = 0.2;

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

/** When Lifetime Income Stability's "vs strategy" rate trails Portfolio
 *  Survival by more than this many percentage points, something is
 *  forcing real deviations from the strategy's own plan (RMDs, routing/
 *  liquidity constraints, penalty-avoidance) even though the portfolio
 *  itself survives — a real, if narrow, signal worth flagging urgently
 *  rather than letting it sit as a quiet secondary ring. */
export const MC_STRATEGY_STABILITY_GAP_ALERT_THRESHOLD = 0.1;

/** Default inflation risk assumption for Monte Carlo simulations when no
 *  preset-specific value is configured. */
export const DEFAULT_MC_INFLATION_RISK = { meanRate: 0.025, stdDev: 0.012 };

/** Default number of trials for a Monte Carlo simulation run. Dropped from
 *  1000 → 500 2026-08-30 (user decision, after the worker-thread offload
 *  fixed the real motivation for a cut — it no longer needs to trade
 *  precision for a shorter server-wide freeze, since MC no longer blocks
 *  the event loop at all). Standard error scales as 1/sqrt(n): a true 90%
 *  success rate has ~±1.3 percentage points of noise at 500 trials vs
 *  ~±1% at 1000 — accepted as fine since results display rounded to whole
 *  percentage points anyway. */
export const MC_DEFAULT_TRIALS = 500;

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
// RMD / Qualified Charitable Distribution
// ---------------------------------------------------------------------------

/** Annual per-person cap on Qualified Charitable Distributions from an IRA
 *  (IRC §408(d)(8)). IRS-indexed annually for inflation — NOT tied to the
 *  household's own inflation assumption, which is why this is a flat
 *  constant rather than derived from `annualInflation`. $115,000 is the
 *  2026 figure (was $105,000 for 2024, $108,000 for 2025 — this constant
 *  was found stale by two years' worth of indexing; update it annually
 *  when the IRS publishes a new figure, the same discipline that applies
 *  to bracket/contribution-limit updates). Held flat across the whole
 *  projection horizon (no attempt to model future IRS indexing) — same
 *  simplification this engine already applies to IRS contribution limits
 *  via `limitGrowthRate` rather than real published figures. */
export const QCD_ANNUAL_CAP_PER_PERSON = 115000;

/** Minimum age for QCD eligibility (IRC §408(d)(8)(B)(ii): age 70½) — the
 *  engine tracks whole-year ages only, so this rounds DOWN to 70 rather
 *  than 71, since someone who turns 70 mid-year is already 70½-eligible
 *  for part of that projection year and the engine has no sub-year
 *  granularity to model the exact month. Deliberately independent of
 *  `getRmdStartAge` (72/73/75 by birth year) — QCD eligibility was NOT
 *  moved by SECURE 2.0's RMD-age delay, so a household can (and often
 *  should, to shrink a future RMD) start QCDs years before RMDs are even
 *  required (advisor review, 2026-08-29 — QCD was previously computed
 *  only for people who'd already reached RMD age, silently zeroing out
 *  this whole pre-RMD window, its highest-value use case). */
export const QCD_MIN_ELIGIBILITY_AGE = 70;

// ---------------------------------------------------------------------------
// RMD-aware Roth conversion smoothing
// ---------------------------------------------------------------------------

/** Fallback ceiling for how far RMD smoothing may elevate a household's
 *  effective Roth-conversion target rate above their own
 *  `rothBracketTarget`/`rothConversionTarget`, used only when a household
 *  has `rmdSmoothingEnabled` on but never explicitly set
 *  `rmdSmoothingMaxBracketTarget` — the UI's own default for a NEWLY
 *  enabled household should seed from that household's current
 *  `rothBracketTarget` instead of relying on this constant, so opting in
 *  never visibly changes a rate the household already chose. This is a
 *  last-resort backstop (e.g. for direct API/engine-input use bypassing
 *  the UI), not the primary default path. 24% keeps the backstop below
 *  the two highest ordinary brackets, matching the same "moderate, not
 *  the top bracket" intent as the schema/UI default. */
export const RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK = 0.24;

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
