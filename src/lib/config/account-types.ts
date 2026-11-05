// Account types: one ACCOUNT_TYPE_CONFIG entry per category and the helpers
// that read it (types: account-types.types.ts; balances: account-balance.ts).
// Code asks about properties, never a category (RULES.md § Data-Driven Architecture).

import type {
  AccountTypeConfig,
  EarlyAccessRule,
  DisplayGroup,
  AccountBalance,
  AccountSegment,
} from "./account-types.types";

import { zeroBalanceForStructure } from "./account-balance";
import { HSA_NON_MEDICAL_PENALTY_RATE } from "@/lib/constants";
import {
  PERF_CATEGORY_HSA,
  PERF_CATEGORY_BROKERAGE,
  FULLY_RETIREMENT_PERF_CATEGORIES,
  accountTypeToPerformanceCategory,
} from "./display-labels";

/** Create a zero-initialized AccountBalance for the given category. */
export function zeroBalance(category: AccountCategory): AccountBalance {
  return zeroBalanceForStructure(
    ACCOUNT_TYPE_CONFIG[category].balanceStructure,
  );
}

// ---------------------------------------------------------------------------
// THE CONFIG — one entry per account category
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPE_CONFIG = {
  "401k": {
    displayLabel: "401k",
    description:
      "Employer-sponsored retirement plan with pre-tax and Roth options",
    keywords: ["401k", "401(k)"],
    supportsRothSplit: true,
    balanceStructure: "roth_traditional",
    withdrawalTaxType: "income",
    taxBucketKey: "preTax",
    supportedTaxTreatments: ["pre_tax", "tax_free"],
    rothOrderingRules: "pro_rata",
    earlyAccessRule: "employer_plan",
    qcdEligible: false,
    nonMedicalPenaltyRate: null,
    hasIrsLimit: true,
    irsLimitGroup: "401k",
    irsLimitKeys: {
      base: "401k_employee_limit",
      catchup: "401k_catchup_limit",
      superCatchup: "401k_super_catchup_limit",
      totalAdditions: "401k_total_additions_limit",
    },
    matchCountsTowardLimit: false,
    limitBoundedByCompensation: false,
    isHouseholdLimit: false,
    fooStep: null,
    catchupAge: 50,
    superCatchupAgeRange: [60, 63],
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.35,
    decumulationRank: 1,
    isPayrollDeductible: true,
    payrollFicaExempt: false,
    supportsPriorYearContrib: false,
    parentCategory: "Retirement",
    displayGroup: "retirement",
    participatesInEngine: true,
    engineParent: null,
    colors: {
      bg: "bg-blue-600",
      bgLight: "bg-blue-100",
      border: "border-blue-300",
      text: "text-blue-700",
    },
    chartHex: { standard: "#3b82f6", roth: "#93c5fd" },
    employerMatchLabel: "match",
    hasDiscountBar: false,
    employerContribKind: "match",
    taxPreferenceNote:
      "Can be split between Traditional (pre-tax) and Roth (after-tax)",
    subTypeOptions: ["Rollover", "Employer Match", "Profit Sharing"],
    employerMatchSubType: "Employer Match",
    subTypeDisplay: {},
  },
  "403b": {
    displayLabel: "403b",
    description: "Non-profit/government employer retirement plan",
    keywords: ["403b", "403(b)"],
    supportsRothSplit: true,
    balanceStructure: "roth_traditional",
    withdrawalTaxType: "income",
    taxBucketKey: "preTax",
    supportedTaxTreatments: ["pre_tax", "tax_free"],
    rothOrderingRules: "pro_rata",
    earlyAccessRule: "employer_plan",
    qcdEligible: false,
    nonMedicalPenaltyRate: null,
    hasIrsLimit: true,
    irsLimitGroup: "401k", // shares limit with 401k
    irsLimitKeys: {
      base: "401k_employee_limit",
      catchup: "401k_catchup_limit",
      superCatchup: "401k_super_catchup_limit",
      totalAdditions: "401k_total_additions_limit",
    },
    matchCountsTowardLimit: false,
    limitBoundedByCompensation: false,
    isHouseholdLimit: false,
    fooStep: null,
    catchupAge: 50,
    superCatchupAgeRange: [60, 63],
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0,
    decumulationRank: 2,
    isPayrollDeductible: true,
    payrollFicaExempt: false,
    supportsPriorYearContrib: false,
    parentCategory: "Retirement",
    displayGroup: "retirement",
    participatesInEngine: true,
    engineParent: null,
    colors: {
      bg: "bg-indigo-600",
      bgLight: "bg-indigo-100",
      border: "border-indigo-300",
      text: "text-indigo-700",
    },
    chartHex: { standard: "#3b82f6", roth: "#93c5fd" },
    employerMatchLabel: "match",
    hasDiscountBar: false,
    employerContribKind: "match",
    taxPreferenceNote:
      "Can be split between Traditional (pre-tax) and Roth (after-tax)",
    subTypeOptions: ["Rollover", "Employer Match"],
    employerMatchSubType: "Employer Match",
    subTypeDisplay: {},
  },
  ira: {
    displayLabel: "IRA",
    description: "Individual Retirement Account with pre-tax and Roth options",
    keywords: ["ira", "roth ira", "traditional ira"],
    supportsRothSplit: true,
    balanceStructure: "roth_traditional",
    withdrawalTaxType: "income",
    taxBucketKey: "preTax",
    supportedTaxTreatments: ["pre_tax", "tax_free"],
    rothOrderingRules: "basis_first",
    earlyAccessRule: "ira_59_half",
    qcdEligible: true,
    nonMedicalPenaltyRate: null,
    hasIrsLimit: true,
    irsLimitGroup: "ira",
    irsLimitKeys: {
      base: "ira_limit",
      catchup: "ira_catchup_limit",
    },
    matchCountsTowardLimit: false,
    limitBoundedByCompensation: true,
    isHouseholdLimit: false,
    fooStep: 5,
    catchupAge: 50,
    superCatchupAgeRange: null,
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.25,
    decumulationRank: 3,
    isPayrollDeductible: false,
    payrollFicaExempt: false,
    supportsPriorYearContrib: true,
    parentCategory: "Retirement",
    displayGroup: "retirement",
    participatesInEngine: true,
    engineParent: null,
    colors: {
      bg: "bg-purple-600",
      bgLight: "bg-purple-100",
      border: "border-purple-300",
      text: "text-purple-700",
    },
    chartHex: { standard: "#8b5cf6", roth: "#c4b5fd" },
    employerMatchLabel: "match",
    hasDiscountBar: false,
    employerContribKind: "match",
    taxPreferenceNote:
      "Can be split between Traditional (pre-tax) and Roth (after-tax)",
    subTypeOptions: ["Rollover"],
    subTypeDisplay: {},
  },
  hsa: {
    displayLabel: "HSA",
    description: "Health Savings Account — triple tax advantage",
    keywords: ["hsa", "health savings"],
    supportsRothSplit: false,
    balanceStructure: "single_bucket",
    withdrawalTaxType: "none",
    taxBucketKey: "hsa",
    supportedTaxTreatments: ["hsa"],
    rothOrderingRules: null,
    earlyAccessRule: "hsa_non_medical",
    qcdEligible: false,
    nonMedicalPenaltyRate: HSA_NON_MEDICAL_PENALTY_RATE,
    tripleTaxAdvantaged: true,
    hasIrsLimit: true,
    irsLimitGroup: "hsa",
    irsLimitKeys: {
      base: "hsa_individual_limit",
      catchup: "hsa_catchup_limit",
      coverageVariant: "hsa_family_limit",
    },
    matchCountsTowardLimit: true,
    limitBoundedByCompensation: false,
    isHouseholdLimit: true,
    fooStep: 5,
    catchupAge: 55,
    superCatchupAgeRange: null,
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.1,
    decumulationRank: 5,
    isPayrollDeductible: true,
    payrollFicaExempt: true,
    supportsPriorYearContrib: true,
    parentCategory: "Retirement",
    displayGroup: "hsa",
    participatesInEngine: true,
    engineParent: null,
    colors: {
      bg: "bg-teal-600",
      bgLight: "bg-teal-100",
      border: "border-teal-300",
      text: "text-teal-700",
    },
    chartHex: { standard: "#10b981", roth: "#6ee7b7" },
    employerMatchLabel: "match",
    hasDiscountBar: false,
    employerContribKind: "match",
    taxPreferenceNote: "Always pre-tax — no Roth/Traditional split",
    subTypeOptions: [],
    subTypeDisplay: {},
  },
  brokerage: {
    displayLabel: "Brokerage",
    description: "Taxable investment account — no IRS contribution limit",
    keywords: [
      "brokerage",
      "taxable",
      "long term",
      "retirement brokerage",
      "espp",
      "after-tax",
      "mega backdoor",
    ],
    supportsRothSplit: false,
    balanceStructure: "basis_tracking",
    withdrawalTaxType: "capital_gains",
    taxBucketKey: "afterTax",
    supportedTaxTreatments: ["after_tax"],
    rothOrderingRules: null,
    earlyAccessRule: "none",
    qcdEligible: false,
    nonMedicalPenaltyRate: null,
    hasIrsLimit: false,
    irsLimitGroup: null,
    irsLimitKeys: null,
    matchCountsTowardLimit: false,
    limitBoundedByCompensation: false,
    isHouseholdLimit: false,
    fooStep: null,
    catchupAge: null,
    superCatchupAgeRange: null,
    isOverflowTarget: true,
    fixedContribScalesWithSalary: true,
    generateOverflowWarnings: false,
    defaultWithdrawalSplit: 0.3,
    decumulationRank: 4,
    isPayrollDeductible: false,
    payrollFicaExempt: false,
    supportsPriorYearContrib: false,
    parentCategory: "Portfolio",
    displayGroup: "taxable",
    participatesInEngine: true,
    engineParent: null,
    colors: {
      bg: "bg-amber-600",
      bgLight: "bg-amber-100",
      border: "border-amber-300",
      text: "text-amber-700",
    },
    chartHex: { standard: "#f97316", roth: "#fdba74" },
    employerMatchLabel: "match",
    hasDiscountBar: false,
    employerContribKind: "match",
    taxPreferenceNote: "Always after-tax — no Roth/Traditional split",
    subTypeOptions: ["ESPP"],
    subTypeDisplay: {
      espp: {
        displayLabel: "ESPP",
        description:
          "Employee stock purchase plan — employer discount on company stock",
        hasDiscountBar: true,
        employerContribKind: "discount",
        employerMatchLabel: "disc.",
        colors: {
          bg: "bg-teal-500",
          bgLight: "bg-teal-300/60",
          border: "border-teal-500",
          text: "text-teal-700",
        },
      },
    },
  },
} as const satisfies Record<string, AccountTypeConfig>;

/** An account category: one key of `ACCOUNT_TYPE_CONFIG`. */
export type AccountCategory = keyof typeof ACCOUNT_TYPE_CONFIG;

/** Zod-compatible tuple for `z.enum(accountCategoryEnum())`, read at call time. */
export function accountCategoryEnum(): [AccountCategory, ...AccountCategory[]] {
  const [first, ...rest] = getAllCategories();
  if (first === undefined) throw new Error("ACCOUNT_TYPE_CONFIG is empty");
  return [first, ...rest];
}

// ---------------------------------------------------------------------------
// Budget ↔ contribution matching
// ---------------------------------------------------------------------------

/** Extra keyword → category aliases for account types that don't have full
 *  AccountTypeConfig entries but still need budget keyword matching. */
const KEYWORD_ALIASES: Record<string, string> = {
  "529": "529",
  "457b": "457b",
  "457(b)": "457b",
};

/**
 * Normalize an account type or budget subcategory to a canonical contribution
 * category key. Returns null if the string doesn't match any known category.
 */
export function normalizeContribKey(name: string): string | null {
  const lower = name.toLowerCase();
  // Check extra aliases first (these don't have full config entries)
  for (const [kw, cat] of Object.entries(KEYWORD_ALIASES)) {
    if (lower.includes(kw)) return cat;
  }
  // Check config keywords
  for (const [cat, cfg] of Object.entries(ACCOUNT_TYPE_CONFIG)) {
    for (const kw of cfg.keywords) {
      if (lower.includes(kw.toLowerCase())) return cat;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display config resolver
// ---------------------------------------------------------------------------

/** Resolve display config for an account — checks subTypeDisplay overrides first, then base config. */
export function getDisplayConfig(
  accountType: string,
  subType?: string | null,
): {
  hasDiscountBar: boolean;
  employerMatchLabel: string;
  displayLabel: string;
  employerContribKind: "match" | "discount";
} {
  const cfg = ACCOUNT_TYPE_CONFIG[accountType as AccountCategory];
  if (!cfg)
    return {
      hasDiscountBar: false,
      employerContribKind: "match",
      employerMatchLabel: "match",
      displayLabel: accountType,
    };
  const subLower = subType?.toLowerCase() ?? "";
  const sub = (
    cfg.subTypeDisplay as Record<
      string,
      | {
          hasDiscountBar: boolean;
          employerMatchLabel: string;
          displayLabel: string;
          employerContribKind: "match" | "discount";
        }
      | undefined
    >
  )[subLower];
  return sub ?? cfg;
}

/** True if this account's (type + subtype) employer_contributions are an ESPP
 *  purchase-price discount, not cash, so its cash-basis figure means something.
 *  Per account, never by category: Brokerage also has cash sub-types. */
export function isDiscountBasisEmployerContrib(
  accountType: string,
  subType?: string | null,
): boolean {
  return (
    getDisplayConfig(accountType, subType).employerContribKind === "discount"
  );
}

// ---------------------------------------------------------------------------
// Module-level defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WITHDRAWAL_SPLITS: Record<AccountCategory, number> =
  Object.fromEntries(
    Object.entries(ACCOUNT_TYPE_CONFIG).map(([k, v]) => [
      k,
      v.defaultWithdrawalSplit,
    ]),
  ) as Record<AccountCategory, number>;

// ---------------------------------------------------------------------------
// Query helpers — all derived from config
// ---------------------------------------------------------------------------

/** All account categories. */
export function getAllCategories(): AccountCategory[] {
  return Object.keys(ACCOUNT_TYPE_CONFIG) as AccountCategory[];
}

/** Categories that participate in the retirement engine (excludes sub-types that roll up). */
export function getEngineCategories(): AccountCategory[] {
  return getAllCategories().filter(
    (c) =>
      ACCOUNT_TYPE_CONFIG[c].participatesInEngine &&
      !ACCOUNT_TYPE_CONFIG[c].engineParent,
  );
}

/** Categories that support Traditional/Roth split. */
export function categoriesWithTaxPreference(): AccountCategory[] {
  return getAllCategories().filter(
    (c) => ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
  );
}

/** The Traditional-preference categories that take part in engine routing
 *  (`getEngineCategories() ∩ categoriesWithTaxPreference()`), for
 *  bracket_filling's Phase 1 and the Traditional order editor. */
export function tradPreferenceEngineCategories(): AccountCategory[] {
  const engineCats = new Set(getEngineCategories());
  return categoriesWithTaxPreference().filter((c) => engineCats.has(c));
}

/** Categories that do NOT support Traditional/Roth split. */
export function categoriesWithoutTaxPreference(): AccountCategory[] {
  return getAllCategories().filter(
    (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
  );
}

/** Categories that have IRS contribution limits. */
export function categoriesWithIrsLimit(): AccountCategory[] {
  return getAllCategories().filter((c) => ACCOUNT_TYPE_CONFIG[c].hasIrsLimit);
}

/** Get the config for a specific category. */
export function getAccountTypeConfig(
  category: AccountCategory,
): AccountTypeConfig {
  return ACCOUNT_TYPE_CONFIG[category];
}

// ---------------------------------------------------------------------------
// Engine helpers — replace hardcoded if-chains
// ---------------------------------------------------------------------------

/**
 * Get the Roth fraction for a category from tax splits.
 */
export function getRothFraction(
  category: AccountCategory,
  taxSplits: Partial<Record<AccountCategory, number>>,
): number {
  const cfg = ACCOUNT_TYPE_CONFIG[category];
  if (!cfg.supportsRothSplit) return 0;
  const lookupKey =
    cfg.irsLimitGroup && cfg.irsLimitGroup !== category
      ? (cfg.irsLimitGroup as AccountCategory)
      : category;
  return taxSplits[lookupKey] ?? 0;
}

/**
 * Get the effective contribution limit for a category.
 */
export function getEffectiveLimit(
  category: AccountCategory,
  irsLimit: number,
  accountCap: number | null,
): number {
  if (!ACCOUNT_TYPE_CONFIG[category].hasIrsLimit) return Infinity;
  return Math.min(irsLimit, accountCap ?? Infinity);
}

/**
 * Whether this category absorbs overflow from other accounts.
 */
export function isOverflowTarget(category: AccountCategory): boolean {
  return ACCOUNT_TYPE_CONFIG[category].isOverflowTarget;
}

/**
 * Get the limit group for a category (for shared IRS limits like 401k/403b).
 */
export function getLimitGroup(category: string): string | null {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg?.irsLimitGroup ?? null;
}

/** The sub-type holding employer match money for a category, if it tracks one. */
export function getEmployerMatchSubType(category: string): string | null {
  const cfg: AccountTypeConfig | undefined =
    ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg?.employerMatchSubType ?? null;
}

/** Check if a category tracks cost basis (after-tax accounts like brokerage). */
export function tracksCostBasis(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg?.balanceStructure === "basis_tracking";
}

/** Check if a category's Roth balance can carry a basis entry (401k/403b/ira —
 *  anything with a Traditional/Roth split). Mirrors tracksCostBasis(). */
export function tracksRothBasis(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg?.balanceStructure === "roth_traditional";
}

/** Identity checks, kept for the callers not yet on behavior fields
 *  (RULES.md § Data-Driven Architecture, rule 10); new code reads a field. */
export function isHsaCategory(category: string): boolean {
  return category === "hsa";
}

/** See isHsaCategory. */
export function isIraCategory(category: string): boolean {
  return category === "ira";
}

/** Rule of 55 can apply (IRC §72(t)(2)(A)(v)): the employer-plan
 *  early-access rule. False for a category not in the config. */
export function isRuleOf55EligibleCategory(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg?.earlyAccessRule === "employer_plan";
}

/** The early-access rule a category's withdrawals follow (`earlyAccessRule`). */
export function earlyAccessRuleOf(category: AccountCategory): EarlyAccessRule {
  return ACCOUNT_TYPE_CONFIG[category].earlyAccessRule;
}

/** A QCD can come from this category (`qcdEligible`). */
export function isQcdEligible(category: AccountCategory): boolean {
  return ACCOUNT_TYPE_CONFIG[category].qcdEligible;
}

/** The non-medical withdrawal penalty rate, or null where there is none. */
export function nonMedicalPenaltyRate(
  category: AccountCategory,
): number | null {
  return ACCOUNT_TYPE_CONFIG[category].nonMedicalPenaltyRate;
}

/** Valid parentCategory values — shared by Zod schemas, DB checks, and UI dropdowns. */
export const PARENT_CATEGORY_VALUES = ["Retirement", "Portfolio"] as const;
export type ParentCategory = (typeof PARENT_CATEGORY_VALUES)[number];
/** Tuple for z.enum(parentCategoryEnum()). */
export function parentCategoryEnum(): typeof PARENT_CATEGORY_VALUES {
  return PARENT_CATEGORY_VALUES;
}

/**
 * Get the parent category for classification.
 */
export function getParentCategory(category: AccountCategory): ParentCategory {
  return ACCOUNT_TYPE_CONFIG[category].parentCategory;
}

/**
 * Get the display group for paycheck/contribution views.
 */
export function getDisplayGroup(category: AccountCategory): DisplayGroup {
  return ACCOUNT_TYPE_CONFIG[category].displayGroup;
}

// ---------------------------------------------------------------------------
// Classification predicates — config-driven, no string knowledge
// ---------------------------------------------------------------------------

/** Check if an account category belongs to the Retirement parent category (by account type config). */
export function isRetirementCategory(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg ? cfg.parentCategory === "Retirement" : false;
}

/** Check if a parentCategory DB column value is Retirement. Use this when checking the stored/user-editable field, not account type config. */
export function isRetirementParent(
  parentCategory: string | undefined,
): boolean {
  return parentCategory === "Retirement";
}

/** Whether money with this parent category is retirement money in the
 *  projection: Retirement, or no parent at all (unset/empty — the engine's
 *  default). The scope rule for what retirement answers count. */
export function isRetirementMoney(
  parentCategory: string | null | undefined,
): boolean {
  return isRetirementParent(parentCategory || "Retirement");
}

/**
 * Whether an account counts toward the "Retirement" performance rollup: a
 * fully-retirement performance category (401k/IRA, HSA, whatever its
 * parentCategory), or a Brokerage account tagged parentCategory "Retirement"
 * (Brokerage spans both goals). The performance router's rollup and the
 * page's selection matching share this one rule.
 */
export function isInRetirementPerformanceRollup(
  accountType: string | null,
  parentCategory: string | undefined,
): boolean {
  const cat = accountTypeToPerformanceCategory(accountType);
  if ((FULLY_RETIREMENT_PERF_CATEGORIES as readonly string[]).includes(cat)) {
    return true;
  }
  return cat === PERF_CATEGORY_BROKERAGE && isRetirementParent(parentCategory);
}

/** Check if a parentCategory DB column value is Portfolio. Use this when checking the stored/user-editable field, not account type config. */
export function isPortfolioParent(parentCategory: string | undefined): boolean {
  return parentCategory === "Portfolio";
}

/** Performance categories that report a distinct Distributions row (in addition
 *  to Contributions and Gains/Losses) — e.g. HSA, which supports tax-free
 *  qualified medical withdrawals during accumulation. Single source of truth
 *  for the year-over-year spreadsheet table's Distributions row. */
const PERF_CATEGORIES_WITH_DISTRIBUTIONS: readonly string[] = [
  PERF_CATEGORY_HSA,
];

/** Check if a performance display category (e.g. "HSA", "401k/IRA") reports a Distributions row. */
export function categoryHasDistributions(category: string): boolean {
  return PERF_CATEGORIES_WITH_DISTRIBUTIONS.includes(category);
}

/** Check if a tax treatment value represents tax-free (Roth) contributions. */
export function isTaxFree(taxTreatment: string): boolean {
  return taxTreatment === "tax_free";
}

/** Check if a tax treatment value represents pre-tax (traditional) contributions. */
export function isPreTaxTreatment(taxTreatment: string): boolean {
  return taxTreatment === "pre_tax";
}

/** Check if a tax treatment value represents after-tax (taxable/brokerage) contributions. */
export function isAfterTaxTreatment(taxTreatment: string): boolean {
  return taxTreatment === "after_tax";
}

/** Check if a tax treatment value represents HSA contributions. */
export function isHsaTreatment(taxTreatment: string): boolean {
  return taxTreatment === "hsa";
}

/** Check if an engine-internal taxType key represents the tax-free (Roth) bucket. */
export function isTaxFreeBucket(taxType: string): boolean {
  return taxType === "taxFree";
}

/** Check if an engine-internal taxType key is pre-tax (traditional). */
export function isPreTaxType(taxType: string): boolean {
  return taxType === "preTax";
}

/** Check if an engine-internal taxType key is tax-free (Roth). */
export function isRothType(taxType: string): boolean {
  return taxType === "roth";
}

/** Check if an engine-internal taxType key is after-tax (Brokerage). */
export function isAfterTaxType(taxType: string): boolean {
  return taxType === "afterTax";
}

/** Whether a category's money is taxed as it earns (a taxable account —
 *  its config tax bucket is after-tax). Unknown categories: false. */
export function isTaxableCategory(category: string | null): boolean {
  if (category === null || !isKnownCategory(category)) return false;
  return isAfterTaxType(ACCOUNT_TYPE_CONFIG[category].taxBucketKey);
}

/** Whether contributions to a category come out of the paycheck (config
 *  `isPayrollDeductible`). Unknown categories: false. */
export function isPayrollDeductibleCategory(category: string): boolean {
  return (
    isKnownCategory(category) &&
    ACCOUNT_TYPE_CONFIG[category].isPayrollDeductible
  );
}

/** Whether a category's payroll contributions skip FICA (config
 *  `payrollFicaExempt`, §125 — HSA). Unknown categories: false. */
export function isPayrollFicaExemptCategory(category: string): boolean {
  return (
    isKnownCategory(category) && ACCOUNT_TYPE_CONFIG[category].payrollFicaExempt
  );
}

function isKnownCategory(category: string): category is AccountCategory {
  return (getAllCategories() as string[]).includes(category);
}

/** Check if an engine-internal taxType key is the HSA bucket. */
export function isHsaTaxType(taxType: string): boolean {
  return taxType === "hsa";
}

/** Map engine-internal tax type keys to sub-keys used for balance columns. */
export function taxTypeToSubKey(taxType: string): "roth" | "trad" {
  return taxType === "taxFree" ? "roth" : "trad";
}

/** Get the default tax treatment for a category from its config. */
export function getDefaultTaxTreatment(category: AccountCategory): string {
  return ACCOUNT_TYPE_CONFIG[category].supportedTaxTreatments[0];
}

// ---------------------------------------------------------------------------
// UI helpers — replace scattered label maps and column key builders
// ---------------------------------------------------------------------------

/**
 * Get the column segments for all engine categories.
 */
export function getAccountSegments(): AccountSegment<AccountCategory>[] {
  const segments: AccountSegment<AccountCategory>[] = [];
  for (const cat of getEngineCategories()) {
    const cfg = ACCOUNT_TYPE_CONFIG[cat];
    if (cfg.balanceStructure === "roth_traditional") {
      segments.push(
        {
          key: `${cat}_trad`,
          category: cat,
          label: `${cfg.displayLabel} Trad`,
          subKey: "trad",
        },
        {
          key: `${cat}_roth`,
          category: cat,
          label: `${cfg.displayLabel} Roth`,
          subKey: "roth",
        },
      );
    } else {
      segments.push({
        key: cat,
        category: cat,
        label: cfg.displayLabel,
        subKey: null,
      });
    }
  }
  return segments;
}

/**
 * Parse a column key back to category + sub-key.
 */
export function parseColumnKey(
  key: string,
): { category: AccountCategory; subKey: string | null } | null {
  // Try exact match first (single-bucket categories)
  if (key in ACCOUNT_TYPE_CONFIG) {
    return { category: key as AccountCategory, subKey: null };
  }
  // Try suffix match for roth_traditional categories
  for (const suffix of ["_trad", "_roth"]) {
    if (key.endsWith(suffix)) {
      const cat = key.slice(0, -suffix.length);
      if (cat in ACCOUNT_TYPE_CONFIG) {
        return { category: cat as AccountCategory, subKey: suffix.slice(1) };
      }
    }
  }
  return null;
}

/**
 * Get the display label for a column key.
 */
export function getColumnLabel(key: string): string {
  const parsed = parseColumnKey(key);
  if (!parsed) return key;
  const cfg = ACCOUNT_TYPE_CONFIG[parsed.category];
  if (parsed.subKey === "trad") return `${cfg.displayLabel} Trad`;
  if (parsed.subKey === "roth") return `${cfg.displayLabel} Roth`;
  return cfg.displayLabel;
}

/**
 * Get the default accumulation order (engine categories only).
 */
export function getDefaultAccumulationOrder(): AccountCategory[] {
  return getEngineCategories();
}

/**
 * Get the default decumulation order.
 */
export function getDefaultDecumulationOrder(): AccountCategory[] {
  return getEngineCategories().sort(
    (a, b) =>
      ACCOUNT_TYPE_CONFIG[a].decumulationRank -
      ACCOUNT_TYPE_CONFIG[b].decumulationRank,
  );
}

/** The Retirement page's default decumulation input, shared with the
 *  dashboard tile's peek queries so both hash to one cache key. No routing
 *  mode, order or splits: omitted, they come from retirement_settings. */
export function defaultDecumulationConfig(): {
  withdrawalTaxPreference: Partial<
    Record<AccountCategory, "traditional" | "roth">
  >;
} {
  return {
    withdrawalTaxPreference: Object.fromEntries(
      categoriesWithTaxPreference().map((cat) => [cat, "traditional" as const]),
    ),
  };
}

/**
 * Build an empty record keyed by all engine categories with a factory.
 */
export function buildCategoryRecord<T>(
  factory: () => T,
): Record<AccountCategory, T> {
  return Object.fromEntries(
    getEngineCategories().map((c) => [c, factory()]),
  ) as Record<AccountCategory, T>;
}
