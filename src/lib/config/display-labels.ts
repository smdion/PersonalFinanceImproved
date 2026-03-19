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
};

/** Get short label for a tax treatment value. */
export function taxTreatmentToShortLabel(taxTreatment: string): string {
  return TAX_TREATMENT_SHORT_LABELS[taxTreatment] ?? taxTreatment;
}

/**
 * Derive performance page display category from accountType string.
 * Groups by what TYPE of account it is, not its parentCategory goal.
 * See DESIGN.md § "Performance page display categories".
 */
export function accountTypeToPerformanceCategory(
  accountType: string | null,
): string {
  if (accountType === "brokerage") return "Brokerage";
  if (accountType === "hsa") return "HSA";
  return "Retirement";
}

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

/** Generic label lookup with fallback to key. */
export function displayLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
