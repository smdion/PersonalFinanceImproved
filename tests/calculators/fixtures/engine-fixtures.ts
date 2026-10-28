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
import { roundToCents } from "@/lib/utils/math";
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
    avoidPenalizedWithdrawals: true,
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

// ---------------------------------------------------------------------------
// Starting money that agrees with itself
// ---------------------------------------------------------------------------

/** The tax buckets a set of per-category balances adds up to. */
function taxBucketsFromAccountBalances(a: AccountBalances): TaxBuckets {
  const b: TaxBuckets = {
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  for (const bal of Object.values(a)) {
    if (bal.structure === "roth_traditional") {
      b.preTax += bal.traditional;
      b.taxFree += bal.roth;
    } else if (bal.structure === "single_bucket") b.hsa += bal.balance;
    else {
      b.afterTax += bal.balance;
      b.afterTaxBasis += bal.basis;
    }
  }
  return b;
}

/** `a` rescaled to `b`'s totals, keeping its mix across categories (all of
 *  a bucket in one category stays there). A bucket `a` holds nothing of
 *  falls back to the engine's config-derived split. */
function rescaleAccountBalances(
  a: AccountBalances,
  b: TaxBuckets,
): AccountBalances {
  const have = taxBucketsFromAccountBalances(a);
  const fallback = accountBalancesFromTaxBuckets(b);
  const scale = (value: number, from: number, to: number) =>
    from > 0 ? roundToCents((value * to) / from) : 0;
  return Object.fromEntries(
    (Object.keys(a) as AccountCategory[]).map((cat) => {
      const bal = a[cat];
      const fb = fallback[cat];
      if (
        bal.structure === "roth_traditional" &&
        fb.structure === bal.structure
      )
        return [
          cat,
          {
            ...bal,
            traditional:
              have.preTax > 0
                ? scale(bal.traditional, have.preTax, b.preTax)
                : fb.traditional,
            roth:
              have.taxFree > 0
                ? scale(bal.roth, have.taxFree, b.taxFree)
                : fb.roth,
          },
        ];
      if (bal.structure === "single_bucket" && fb.structure === bal.structure)
        return [
          cat,
          {
            ...bal,
            balance:
              have.hsa > 0 ? scale(bal.balance, have.hsa, b.hsa) : fb.balance,
          },
        ];
      if (bal.structure === "basis_tracking" && fb.structure === bal.structure)
        return [
          cat,
          {
            ...bal,
            balance:
              have.afterTax > 0
                ? scale(bal.balance, have.afterTax, b.afterTax)
                : fb.balance,
            basis:
              have.afterTax > 0
                ? scale(bal.balance, have.afterTax, b.afterTaxBasis)
                : fb.basis,
          },
        ];
      return [cat, bal];
    }),
  ) as AccountBalances;
}

/**
 * A test input whose starting money says the same thing in each form the
 * engine reads — the tax buckets and the per-category balances (the engine
 * flags any gap with a `[DIAG] starting balances` warning, and routing
 * treats it as money it may never reach). `input` is the merged fixture,
 * `overrides` what the test set: buckets set alone rescale the fixture's
 * per-category balances to them; per-category balances set alone set the
 * buckets. Setting both keeps both — the test's own choice.
 * `individualAccounts` are left as given; `startingBalanceGaps` (asserted
 * by the engine suites) catches any that disagree.
 */
export function withConsistentStart<
  T extends {
    startingBalances: TaxBuckets;
    startingAccountBalances?: AccountBalances;
  },
>(
  input: T,
  overrides: {
    startingBalances?: TaxBuckets;
    startingAccountBalances?: AccountBalances;
  },
): T {
  if (overrides.startingBalances && !overrides.startingAccountBalances)
    return input.startingAccountBalances
      ? {
          ...input,
          startingAccountBalances: rescaleAccountBalances(
            input.startingAccountBalances,
            input.startingBalances,
          ),
        }
      : input;
  if (overrides.startingAccountBalances && !overrides.startingBalances)
    return {
      ...input,
      startingBalances: taxBucketsFromAccountBalances(
        overrides.startingAccountBalances,
      ),
    };
  return input;
}

/** The engine's starting-balance gap warnings (`[DIAG] starting
 *  balances`): a fixture whose money disagrees with itself. Engine suites
 *  assert none, so a gap can't creep back into a fixture. */
export function startingBalanceGaps(result: { warnings: string[] }): string[] {
  return result.warnings.filter((w) =>
    w.startsWith("[DIAG] starting balances"),
  );
}
