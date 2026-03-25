/**
 * Factory functions for engine test types.
 * Provides sensible defaults that can be overridden per-test.
 */
import type {
  TaxBuckets,
  AccountBalances,
  ResolvedAccumulationConfig,
  ResolvedDecumulationConfig,
  AccumulationSlot,
  DecumulationSlot,
  AccountCategory,
  ContributionSpec,
  AccumulationDefaults,
  DecumulationDefaults,
  IndividualAccountInput,
} from "@/lib/calculators/types";
import { accountBalancesFromTaxBuckets } from "@/lib/calculators/engine/balance-utils";
import { buildCategoryRecord } from "@/lib/config/account-types";
import type { WithholdingBracket } from "@/lib/calculators/engine/tax-estimation";

// ---------------------------------------------------------------------------
// TaxBuckets
// ---------------------------------------------------------------------------

export function makeTaxBuckets(
  overrides: Partial<TaxBuckets> = {},
): TaxBuckets {
  return {
    preTax: 500000,
    taxFree: 200000,
    hsa: 50000,
    afterTax: 300000,
    afterTaxBasis: 150000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AccountBalances
// ---------------------------------------------------------------------------

export function makeAccountBalances(
  bucketOverrides: Partial<TaxBuckets> = {},
): AccountBalances {
  return accountBalancesFromTaxBuckets(makeTaxBuckets(bucketOverrides));
}

// ---------------------------------------------------------------------------
// ResolvedAccumulationConfig
// ---------------------------------------------------------------------------

export function makeAccumulationConfig(
  overrides: Partial<ResolvedAccumulationConfig> = {},
): ResolvedAccumulationConfig {
  return {
    contributionRate: 0.25,
    routingMode: "waterfall",
    accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
    accountSplits: {
      "401k": 0.4,
      "403b": 0,
      hsa: 0.15,
      ira: 0.15,
      brokerage: 0.3,
    },
    taxSplits: { "401k": 0.5, ira: 1.0 },
    accountCaps: buildCategoryRecord(() => null),
    taxTypeCaps: { traditional: null, roth: null },
    lumpSums: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ResolvedDecumulationConfig
// ---------------------------------------------------------------------------

export function makeDecumulationConfig(
  overrides: Partial<ResolvedDecumulationConfig> = {},
): ResolvedDecumulationConfig {
  return {
    withdrawalRate: 0.04,
    withdrawalRoutingMode: "waterfall",
    withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    withdrawalSplits: {
      "401k": 0.3,
      "403b": 0,
      hsa: 0.1,
      ira: 0.2,
      brokerage: 0.4,
    },
    withdrawalTaxPreference: {
      "401k": "traditional",
      "403b": null,
      ira: "traditional",
      hsa: null,
      brokerage: null,
    } as Record<AccountCategory, "traditional" | "roth" | null>,
    withdrawalAccountCaps: buildCategoryRecord(() => null),
    withdrawalTaxTypeCaps: { traditional: null, roth: null },
    lumpSums: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AccumulationSlot
// ---------------------------------------------------------------------------

export function makeAccumulationSlot(
  category: AccountCategory,
  overrides: Partial<AccumulationSlot> = {},
): AccumulationSlot {
  return {
    category,
    irsLimit: 23500,
    effectiveLimit: 23500,
    employerMatch: 0,
    employeeContrib: 0,
    rothContrib: 0,
    traditionalContrib: 0,
    remainingSpace: 23500,
    cappedByAccount: false,
    cappedByTaxType: false,
    overflowAmount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DecumulationSlot
// ---------------------------------------------------------------------------

export function makeDecumulationSlot(
  category: AccountCategory,
  overrides: Partial<DecumulationSlot> = {},
): DecumulationSlot {
  return {
    category,
    withdrawal: 0,
    rothWithdrawal: 0,
    traditionalWithdrawal: 0,
    cappedByAccount: false,
    cappedByTaxType: false,
    remainingNeed: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Year Limits
// ---------------------------------------------------------------------------

export function makeYearLimits(): Record<AccountCategory, number> {
  return {
    "401k": 23500,
    "403b": 23500,
    hsa: 4300,
    ira: 7000,
    brokerage: Infinity,
  };
}

export function makeEmployerMatch(
  overrides: Partial<Record<AccountCategory, number>> = {},
): Record<AccountCategory, number> {
  return {
    "401k": 5000,
    "403b": 0,
    hsa: 0,
    ira: 0,
    brokerage: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tax Brackets (2025 MFJ withholding)
// ---------------------------------------------------------------------------

export const TEST_BRACKETS: WithholdingBracket[] = [
  { threshold: 0, baseWithholding: 0, rate: 0 },
  { threshold: 16550, baseWithholding: 0, rate: 0.1 },
  { threshold: 33725, baseWithholding: 1717.5, rate: 0.12 },
  { threshold: 96175, baseWithholding: 9211.5, rate: 0.22 },
  { threshold: 201550, baseWithholding: 32394, rate: 0.24 },
  { threshold: 383325, baseWithholding: 76020, rate: 0.32 },
  { threshold: 457525, baseWithholding: 99764, rate: 0.35 },
  { threshold: 719525, baseWithholding: 191464, rate: 0.37 },
];

// ---------------------------------------------------------------------------
// AccumulationDefaults / DecumulationDefaults
// ---------------------------------------------------------------------------

export function makeAccumulationDefaults(
  overrides: Partial<AccumulationDefaults> = {},
): AccumulationDefaults {
  return {
    contributionRate: 0.25,
    routingMode: "waterfall",
    accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
    accountSplits: {
      "401k": 0.4,
      "403b": 0,
      hsa: 0.15,
      ira: 0.15,
      brokerage: 0.3,
    },
    taxSplits: { "401k": 0.5, ira: 1.0 },
    ...overrides,
  };
}

export function makeDecumulationDefaults(
  overrides: Partial<DecumulationDefaults> = {},
): DecumulationDefaults {
  return {
    withdrawalRate: 0.04,
    withdrawalRoutingMode: "bracket_filling",
    withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    withdrawalSplits: {
      "401k": 0.3,
      "403b": 0,
      hsa: 0.1,
      ira: 0.2,
      brokerage: 0.4,
    },
    withdrawalTaxPreference: {
      "401k": "traditional",
      "403b": null,
      ira: "traditional",
      hsa: null,
      brokerage: null,
    } as Record<AccountCategory, "traditional" | "roth" | null>,
    ...overrides,
  } as DecumulationDefaults;
}

// ---------------------------------------------------------------------------
// ContributionSpec
// ---------------------------------------------------------------------------

export function makeContributionSpec(
  overrides: Partial<ContributionSpec> = {},
): ContributionSpec {
  return {
    category: "401k",
    name: "Roth 401k",
    method: "percent_of_salary",
    value: 0.14,
    salaryFraction: 1,
    baseAnnual: 16800,
    taxTreatment: "tax_free",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// IndividualAccountInput
// ---------------------------------------------------------------------------

export function makeIndividualAccount(
  overrides: Partial<IndividualAccountInput> = {},
): IndividualAccountInput {
  return {
    name: "401k Account",
    category: "401k" as AccountCategory,
    taxType: "preTax",
    startingBalance: 100000,
    ...overrides,
  };
}
