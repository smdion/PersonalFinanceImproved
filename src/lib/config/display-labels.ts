// Consolidated display label maps.
// Components import from here — never define local label maps.

export const CONTRIBUTION_METHOD_LABELS: Record<string, string> = {
  percent_of_salary: "% of Salary",
  fixed_per_period: "Fixed/Period",
  fixed_monthly: "Fixed/Month",
  fixed_annual: "Fixed/Year",
};

/** Shorter method labels used in the paycheck view. */
export const CONTRIBUTION_METHOD_LABELS_SHORT: Record<string, string> = {
  percent_of_salary: "% of salary",
  fixed_per_period: "$/period",
  fixed_monthly: "$/month",
  fixed_annual: "$/year",
};

export const TAX_TREATMENT_LABELS: Record<string, string> = {
  pre_tax: "Traditional",
  tax_free: "Roth",
  after_tax: "After-Tax",
  hsa: "HSA",
};

export const EMPLOYER_MATCH_LABELS: Record<string, string> = {
  none: "None",
  percent_of_contribution: "% of Contrib",
  dollar_match: "$ Match",
  fixed_annual: "Fixed/Year",
};

export const MATCH_TAX_LABELS: Record<string, string> = {
  pre_tax: "Traditional",
  tax_free: "Roth",
};

export const HSA_COVERAGE_LABELS: Record<string, string> = {
  self_only: "Self Only",
  family: "Family",
};

/** Tooltip descriptions for tax bucket columns in the contribution engine table. */
export const TAX_BUCKET_DESCRIPTIONS: Record<string, string> = {
  preTax:
    "Traditional (pre-tax) contributions + employer match. Taxed on withdrawal.",
  taxFree: "Roth (tax-free) contributions. Tax-free on withdrawal.",
  hsa: "HSA contributions. Triple tax-advantaged.",
  afterTax: "After-tax brokerage contributions. Capital gains tax on growth.",
};

/** Short tax treatment labels for compact display (contribution profiles, badges). */
export const TAX_TREATMENT_SHORT_LABELS: Record<string, string> = {
  pre_tax: "Trad",
  tax_free: "Roth",
  after_tax: "After-Tax",
  hsa: "HSA",
  // Engine-internal keys (used in projection overrides taxTypeCaps)
  traditional: "Trad",
  roth: "Roth",
};

/** Get short label for a tax treatment value. */
export function taxTreatmentToShortLabel(taxTreatment: string): string {
  return TAX_TREATMENT_SHORT_LABELS[taxTreatment] ?? taxTreatment;
}

/**
 * Performance display category config — maps account types to performance page groupings.
 * "401k/IRA" covers 401k, 403b, and IRA accounts.
 */
const PERF_CATEGORY_MAP: Record<string, string> = {
  brokerage: "Brokerage",
  hsa: "HSA",
};

/** Default performance category for account types not in PERF_CATEGORY_MAP. */
export const PERF_CATEGORY_DEFAULT = "401k/IRA";

/** Performance category for brokerage accounts. */
export const PERF_CATEGORY_BROKERAGE = "Brokerage";

/** Performance category for HSA accounts. */
export const PERF_CATEGORY_HSA = "HSA";

/** Performance category for the combined Portfolio view. */
export const PERF_CATEGORY_PORTFOLIO = "Portfolio";

/** Performance category for the combined Retirement rollup. */
export const PERF_CATEGORY_RETIREMENT = "Retirement";

/** Canonical display order for performance categories (tabs, finalize modal, etc.). */
export const PERF_CATEGORY_DISPLAY_ORDER = [
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_HSA,
] as const;

/** Derive performance page display category from accountType string. */
export function accountTypeToPerformanceCategory(
  accountType: string | null,
): string {
  return (
    (accountType && PERF_CATEGORY_MAP[accountType]) ?? PERF_CATEGORY_DEFAULT
  );
}

/**
 * Performance categories whose accounts are entirely Retirement-parentCategory.
 * Brokerage is excluded because it spans both Retirement and Portfolio goals.
 */
export const FULLY_RETIREMENT_PERF_CATEGORIES = [
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_HSA,
] as const;

/** Parent-category rollup names used in performance data. */
export const PARENT_CATEGORY_ROLLUPS = ["Retirement", "Portfolio"] as const;

/**
 * Bridge map: DB tax_treatment (snake_case) → portfolio tax_type (camelCase).
 * Single source of truth — imported by projection, retirement, and engine routers.
 */
export const TAX_TREATMENT_TO_TAX_TYPE: Record<string, string> = {
  pre_tax: "preTax",
  tax_free: "taxFree",
  after_tax: "afterTax",
  hsa: "hsa",
};

/** Tax type labels keyed by camelCase portfolio keys (preTax, taxFree, etc.). */
export const TAX_TYPE_LABELS: Record<string, string> = {
  preTax: "Tax-Deferred",
  taxFree: "Tax-Free",
  afterTax: "After-Tax",
  hsa: "HSA",
};

/** Generic label lookup with fallback to key. */
export function displayLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

// ---------------------------------------------------------------------------
// Wealth score tier labels (shared by MetricsRow + Financial Checkup)
// ---------------------------------------------------------------------------

export type WealthTier = "paw" | "aaw" | "uaw";

/** Derive the wealth tier and display label from an AAW score (Money Guy multiplier).
 *  >= 2.0 = PAW, >= 1.0 = AAW, < 1.0 = UAW. */
export function wealthScoreTier(aawScore: number): {
  tier: WealthTier;
  label: string;
  shortLabel: string;
} {
  if (aawScore >= 2.0) {
    return {
      tier: "paw",
      label: "PAW — Prodigious Accumulator",
      shortLabel: "PAW — Excellent",
    };
  }
  if (aawScore >= 1.0) {
    return {
      tier: "aaw",
      label: "AAW — Average Accumulator",
      shortLabel: "AAW — On Track",
    };
  }
  return {
    tier: "uaw",
    label: "UAW — Under Accumulator",
    shortLabel: "UAW — Behind",
  };
}
