// Central account type configuration — the ONLY place account-type-specific
// knowledge lives. Everything else imports from here.
//
// Philosophy: Config declares, code executes.
// Nothing in the codebase knows what a "401k" is — it only knows how to process
// an account type with properties like supportsRothSplit: true and
// balanceStructure: 'roth_traditional'.

// ---------------------------------------------------------------------------
// Re-exports — maintain backwards compatibility for all consumers
// ---------------------------------------------------------------------------

// Types
export type {
  BalanceStructure,
  WithdrawalTaxType,
  DisplayGroup,
  IrsLimitKeys,
  ColorSet,
  AccountTypeConfig,
  RothTraditionalBalance,
  SingleBucketBalance,
  BasisTrackingBalance,
  AccountBalance,
  AccountSegment,
  AccountCategory,
} from "./account-types.types";

export {
  ACCOUNT_CATEGORY_VALUES,
  accountCategoryEnum,
} from "./account-types.types";

// Balance helpers
export {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getBasis,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
  zeroBalanceForStructure,
  cloneBalance,
  getSegmentBalance,
} from "./account-balance";

import type {
  AccountCategory,
  AccountTypeConfig,
  DisplayGroup,
  AccountBalance,
  AccountSegment,
} from "./account-types.types";

import { zeroBalanceForStructure } from "./account-balance";

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
    hasIrsLimit: true,
    irsLimitGroup: "401k",
    irsLimitKeys: {
      base: "401k_employee_limit",
      catchup: "401k_catchup_limit",
      superCatchup: "401k_super_catchup_limit",
    },
    matchCountsTowardLimit: false,
    isHouseholdLimit: false,
    catchupAge: 50,
    superCatchupAgeRange: [60, 63],
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.35,
    isPayrollDeductible: true,
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
    employerMatchLabel: "match",
    hasDiscountBar: false,
    taxPreferenceNote:
      "Can be split between Traditional (pre-tax) and Roth (after-tax)",
    subTypeOptions: ["Rollover", "Employer Match", "Profit Sharing"],
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
    hasIrsLimit: true,
    irsLimitGroup: "401k", // shares limit with 401k
    irsLimitKeys: {
      base: "401k_employee_limit",
      catchup: "401k_catchup_limit",
      superCatchup: "401k_super_catchup_limit",
    },
    matchCountsTowardLimit: false,
    isHouseholdLimit: false,
    catchupAge: 50,
    superCatchupAgeRange: [60, 63],
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0,
    isPayrollDeductible: true,
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
    employerMatchLabel: "match",
    hasDiscountBar: false,
    taxPreferenceNote:
      "Can be split between Traditional (pre-tax) and Roth (after-tax)",
    subTypeOptions: ["Rollover", "Employer Match"],
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
    hasIrsLimit: true,
    irsLimitGroup: "ira",
    irsLimitKeys: {
      base: "ira_limit",
      catchup: "ira_catchup_limit",
    },
    matchCountsTowardLimit: false,
    isHouseholdLimit: false,
    catchupAge: 50,
    superCatchupAgeRange: null,
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.25,
    isPayrollDeductible: false,
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
    employerMatchLabel: "match",
    hasDiscountBar: false,
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
    hasIrsLimit: true,
    irsLimitGroup: "hsa",
    irsLimitKeys: {
      base: "hsa_individual_limit",
      catchup: "hsa_catchup_limit",
      coverageVariant: "hsa_family_limit",
    },
    matchCountsTowardLimit: true,
    isHouseholdLimit: true,
    catchupAge: 55,
    superCatchupAgeRange: null,
    isOverflowTarget: false,
    fixedContribScalesWithSalary: false,
    generateOverflowWarnings: true,
    defaultWithdrawalSplit: 0.1,
    isPayrollDeductible: true,
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
    employerMatchLabel: "match",
    hasDiscountBar: false,
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
    hasIrsLimit: false,
    irsLimitGroup: null,
    irsLimitKeys: null,
    matchCountsTowardLimit: false,
    isHouseholdLimit: false,
    catchupAge: null,
    superCatchupAgeRange: null,
    isOverflowTarget: true,
    fixedContribScalesWithSalary: true,
    generateOverflowWarnings: false,
    defaultWithdrawalSplit: 0.3,
    isPayrollDeductible: false,
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
    employerMatchLabel: "match",
    hasDiscountBar: false,
    taxPreferenceNote: "Always after-tax — no Roth/Traditional split",
    subTypeOptions: ["ESPP"],
    subTypeDisplay: {
      espp: {
        displayLabel: "ESPP",
        description:
          "Employee stock purchase plan — employer discount on company stock",
        hasDiscountBar: true,
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
} as const;

// Validate: every config entry must conform to AccountTypeConfig.
// Using a helper function avoids hardcoding keys and preserves literal key inference.
function _validateConfig<T extends Record<string, AccountTypeConfig>>(c: T): T {
  return c;
}
_validateConfig(ACCOUNT_TYPE_CONFIG);

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
} {
  const cfg = ACCOUNT_TYPE_CONFIG[accountType as AccountCategory];
  if (!cfg)
    return {
      hasDiscountBar: false,
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
        }
      | undefined
    >
  )[subLower];
  if (sub) return sub;
  return cfg;
}

// ---------------------------------------------------------------------------
// Module-level defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ACCUMULATION_ORDER: AccountCategory[] = [
  "401k",
  "403b",
  "hsa",
  "ira",
  "brokerage",
];

export const DEFAULT_DECUMULATION_ORDER: AccountCategory[] = [
  "401k",
  "403b",
  "ira",
  "brokerage",
  "hsa",
];

export const DEFAULT_WITHDRAWAL_TAX_PREF: Partial<
  Record<AccountCategory, "traditional" | "roth">
> = {};

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

/** Check if an account category belongs to the Retirement parent category. */
export function isRetirementCategory(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg ? cfg.parentCategory === "Retirement" : false;
}

/** Check if an account category belongs to the Portfolio parent category. */
export function isPortfolioCategory(category: string): boolean {
  const cfg = ACCOUNT_TYPE_CONFIG[category as AccountCategory];
  return cfg ? cfg.parentCategory === "Portfolio" : false;
}

/** Check if a tax treatment value represents tax-free (Roth) contributions. */
export function isTaxFree(taxTreatment: string): boolean {
  return taxTreatment === "tax_free";
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
export function getAccountSegments(): AccountSegment[] {
  const segments: AccountSegment[] = [];
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
 * Build column key for a category + optional sub-key.
 */
export function getCategoryColumnKey(
  category: AccountCategory,
  subKey?: string | null,
): string {
  return subKey ? `${category}_${subKey}` : category;
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
  return DEFAULT_DECUMULATION_ORDER.filter(
    (c) =>
      ACCOUNT_TYPE_CONFIG[c].participatesInEngine &&
      !ACCOUNT_TYPE_CONFIG[c].engineParent,
  );
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
