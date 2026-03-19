import type {
  EngineYearProjection,
  EngineAccumulationYear,
  AccumulationSlot,
  IndividualAccountYearBalance,
} from "@/lib/calculators/types";
import {
  type AccountCategory as AcctCat,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getAllCategories,
  getAccountTypeConfig,
  parseColumnKey,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import type {
  TipColor,
  AccountSplitsResult,
  SpecFracInput,
  MatchFracInput,
  ColumnChangeInput,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALL_CATEGORIES = getAllCategories();

/** Roth conversion target bracket presets for the decumulation form dropdown. */
export const ROTH_CONVERSION_BRACKET_PRESETS = [
  "0",
  "0.1",
  "0.12",
  "0.22",
  "0.24",
  "0.32",
  "0.35",
];

export const tipColorClass: Record<TipColor, string> = {
  green: "text-green-400",
  blue: "text-blue-300",
  red: "text-red-300",
  amber: "text-amber-300",
  emerald: "text-emerald-300",
  violet: "text-violet-300",
  gray: "text-gray-400",
};

/** Display label for an account category. */
export const catDisplayLabel: Record<string, string> = Object.fromEntries(
  getAllCategories().map((cat) => [
    cat,
    getAccountTypeConfig(cat).displayLabel,
  ]),
);

/** Tax bucket → slot field mapping. Data-driven: add a bucket here, everything else follows. */
// Re-export the shared bridge map under the name this module uses
export const TAX_TREATMENT_TO_BUCKET = TAX_TREATMENT_TO_TAX_TYPE;

export const bucketSlotMap: Record<
  string,
  {
    /** Which slot field holds the contribution for this bucket? */
    contribField: "traditionalContrib" | "rothContrib" | "employeeContrib";
    /** Which slot field holds the withdrawal for this bucket? */
    withdrawalField: "traditionalWithdrawal" | "rothWithdrawal" | "withdrawal";
    /** Only match slots whose category is this value (null = all categories). */
    categoryFilter: string | null;
    /** DB tax treatment values that belong to this bucket (null = all). Derived from TAX_TREATMENT_TO_BUCKET. */
    specTreatments: Set<string> | null;
    /** Tax field string for itemTaxType(). */
    taxField: string | undefined;
    /** True if employer match for this bucket is "associated" (flows to another tax bucket, e.g. Roth match → Pre-Tax). */
    matchIsAssociated: boolean;
  }
> = {
  preTax: {
    contribField: "traditionalContrib",
    withdrawalField: "traditionalWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_BUCKET)
        .filter(([, v]) => v === "preTax")
        .map(([k]) => k),
    ),
    taxField: "traditional",
    matchIsAssociated: false,
  },
  taxFree: {
    contribField: "rothContrib",
    withdrawalField: "rothWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_BUCKET)
        .filter(([, v]) => v === "taxFree")
        .map(([k]) => k),
    ),
    taxField: "roth",
    matchIsAssociated: true,
  },
  ...Object.fromEntries(
    getAllCategories()
      .filter((cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit)
      .map((cat) => [
        ACCOUNT_TYPE_CONFIG[cat].taxBucketKey,
        {
          contribField: "employeeContrib" as const,
          withdrawalField: "withdrawal" as const,
          categoryFilter: cat,
          specTreatments: null,
          taxField: undefined,
          matchIsAssociated: false,
        },
      ]),
  ),
};

/** Set of categories that have their own tax buckets (not roth_traditional). */
export const _singleBucketCategories = new Set<string>(
  getAllCategories().filter(
    (cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit,
  ),
);

// ---------------------------------------------------------------------------
// Year-level parentCategory filter (reused by both standalone and MC det memos)
// ---------------------------------------------------------------------------

export function filterYearByParentCategory(
  yr: EngineYearProjection,
  parentCategory: string,
): EngineYearProjection {
  const filtered = yr.individualAccountBalances.filter(
    (ia) => ia.parentCategory === parentCategory,
  );
  const byTax = {
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  for (const ia of filtered) {
    if (ia.taxType === "taxFree") {
      byTax.taxFree += ia.balance;
    } else {
      const cfg =
        ia.category in ACCOUNT_TYPE_CONFIG
          ? ACCOUNT_TYPE_CONFIG[ia.category as AcctCat]
          : null;
      const bucket = cfg ? cfg.taxBucketKey : "preTax";
      if (bucket in byTax) {
        byTax[bucket as keyof typeof byTax] += ia.balance;
      } else {
        byTax.preTax += ia.balance;
      }
    }
  }
  const origAfterTax = yr.balanceByTaxType.afterTax;
  const origBasis = yr.balanceByTaxType.afterTaxBasis;
  byTax.afterTaxBasis =
    origAfterTax > 0
      ? Math.round(origBasis * (byTax.afterTax / origAfterTax) * 100) / 100
      : 0;
  const byAcct = { ...yr.balanceByAccount };
  for (const cat of getAllCategories()) {
    const catIabs = filtered.filter((ia) => ia.category === cat);
    const cfg = getAccountTypeConfig(cat);
    if (cfg.balanceStructure === "roth_traditional") {
      const trad = catIabs
        .filter((ia) => ia.taxType !== "taxFree")
        .reduce((s, ia) => s + ia.balance, 0);
      const roth = catIabs
        .filter((ia) => ia.taxType === "taxFree")
        .reduce((s, ia) => s + ia.balance, 0);
      byAcct[cat] = {
        structure: "roth_traditional" as const,
        traditional: trad,
        roth,
      };
    } else if (cfg.balanceStructure === "basis_tracking") {
      const bal = catIabs.reduce((s, ia) => s + ia.balance, 0);
      const origCatBal = getTotalBalance(yr.balanceByAccount[cat]);
      const ratio = origCatBal > 0 ? bal / origCatBal : 0;
      const origCatBasis =
        yr.balanceByAccount[cat].structure === "basis_tracking"
          ? yr.balanceByAccount[cat].basis
          : 0;
      byAcct[cat] = {
        structure: "basis_tracking" as const,
        balance: bal,
        basis: Math.round(origCatBasis * ratio * 100) / 100,
      };
    } else {
      byAcct[cat] = {
        structure: "single_bucket" as const,
        balance: catIabs.reduce((s, ia) => s + ia.balance, 0),
      };
    }
  }
  const endBalance =
    Math.round(
      (byTax.preTax + byTax.taxFree + byTax.hsa + byTax.afterTax) * 100,
    ) / 100;
  return {
    ...yr,
    individualAccountBalances: filtered,
    balanceByTaxType: byTax,
    balanceByAccount: byAcct,
    endBalance,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isAccumYear(
  yr: EngineYearProjection,
): yr is EngineAccumulationYear {
  return yr.phase === "accumulation";
}

export function itemTaxType(
  category: string,
  taxField?: string,
): "roth" | "traditional" | undefined {
  const cfg =
    category in ACCOUNT_TYPE_CONFIG
      ? ACCOUNT_TYPE_CONFIG[category as AcctCat]
      : null;
  if (!cfg || !cfg.supportsRothSplit) return undefined;
  if (taxField === "roth" || taxField === "tax_free" || taxField === "taxFree")
    return "roth";
  return "traditional";
}

/** Derive category + tax treatment from a column key like '401k_trad', 'hsa', 'brokerage'. */
export function colKeyParts(key: string): {
  category: string;
  treatment: "traditional" | "roth" | null;
} {
  const parsed = parseColumnKey(key);
  if (!parsed) return { category: key, treatment: null };
  const treatment =
    parsed.subKey === "trad"
      ? ("traditional" as const)
      : parsed.subKey === "roth"
        ? ("roth" as const)
        : null;
  return { category: parsed.category, treatment };
}

/** Read a column's balance from balanceByAccount — data-driven, no if-chains. */
export function colBalance(
  ba: import("@/lib/calculators/types").AccountBalances,
  key: string,
): number {
  const { category, treatment } = colKeyParts(key);
  const bal = ba[category as AcctCat];
  if (!bal) return 0;
  if (treatment === "roth") return getRothBalance(bal);
  if (treatment === "traditional" || treatment === "trad")
    return getTraditionalBalance(bal);
  return getTotalBalance(bal);
}

/** Safe division — returns 0 when divisor is 0 or near-zero. */
export function safeDivide(numerator: number, denominator: number): number {
  return Math.abs(denominator) > 1e-9 ? numerator / denominator : 0;
}

/** Sum withdrawals for a column key across all slots — data-driven, no if-chains. */
export function colWithdrawal(
  slots: {
    category: string;
    withdrawal: number;
    rothWithdrawal: number;
    traditionalWithdrawal: number;
  }[],
  key: string,
): number {
  const { category, treatment } = colKeyParts(key);
  let total = 0;
  for (const slot of slots) {
    if (slot.category !== category) continue;
    if (treatment === "roth") total += slot.rothWithdrawal;
    else if (treatment === "traditional") total += slot.traditionalWithdrawal;
    else total += slot.withdrawal;
  }
  return total;
}

/** Map a column key (e.g. '401k_roth', 'hsa') to the engine's taxType string for IA filtering. */
export function colEngineTaxType(key: string): string | null {
  const { treatment } = colKeyParts(key);
  if (treatment === "roth") return "taxFree";
  if (treatment === "traditional") return "preTax";
  const parsed = parseColumnKey(key);
  if (parsed) {
    const cfg = ACCOUNT_TYPE_CONFIG[parsed.category];
    return cfg.taxBucketKey === "preTax" ? "preTax" : cfg.taxBucketKey;
  }
  return null;
}

/** Get withdrawal amount for a tax bucket from a single slot. */
export function slotBucketWithdrawal(
  slot: {
    category: string;
    withdrawal: number;
    rothWithdrawal: number;
    traditionalWithdrawal: number;
  },
  bucket: string,
): number {
  const map = bucketSlotMap[bucket];
  if (!map) return 0;
  if (map.categoryFilter && slot.category !== map.categoryFilter) return 0;
  return slot[map.withdrawalField as keyof typeof slot] as number;
}

/** Get contribution amount for a tax bucket from a single slot. */
export function slotBucketContrib(
  slot: {
    category: string;
    traditionalContrib: number;
    rothContrib: number;
    employeeContrib: number;
  },
  bucket: string,
): number {
  const map = bucketSlotMap[bucket];
  if (!map) return 0;
  if (map.categoryFilter && slot.category !== map.categoryFilter) return 0;
  // preTax/taxFree don't apply to single-bucket categories (they have their own tax bucket)
  if (!map.categoryFilter && _singleBucketCategories.has(slot.category))
    return 0;
  return slot[map.contribField as keyof typeof slot] as number;
}

/** Total balance inflow (employee + match) for a specific account column — mirrors engine balance routing. */
export function slotsColumnBalanceInflow(
  slots: AccumulationSlot[],
  colKey: string,
): number {
  const { category, treatment } = colKeyParts(colKey);
  const slot = slots.find((s) => s.category === category);
  if (!slot) return 0;
  if (treatment === "traditional")
    return slot.traditionalContrib + slot.employerMatch;
  if (treatment === "roth") return slot.rothContrib; // roth match flows to preTax, not here
  return slot.employeeContrib + slot.employerMatch;
}

/** Total balance inflow (employee + match) routed to a tax bucket — mirrors engine balance routing. */
export function slotsBucketBalanceInflow(
  slots: AccumulationSlot[],
  bucket: string,
): number {
  let total = 0;
  for (const slot of slots) {
    const emp = slotBucketContrib(slot, bucket);
    if (emp <= 0 && slot.employerMatch <= 0) continue;
    const map = bucketSlotMap[bucket];
    if (!map) continue;
    if (map.categoryFilter) {
      // Single-bucket (hsa, brokerage): employee + match both go to this bucket
      if (slot.category === map.categoryFilter)
        total += slot.employeeContrib + slot.employerMatch;
    } else if (!_singleBucketCategories.has(slot.category)) {
      // roth_traditional: preTax gets traditionalContrib + ALL match; taxFree gets rothContrib only
      if (map.contribField === "traditionalContrib") {
        total += slot.traditionalContrib + slot.employerMatch;
      } else {
        total += slot.rothContrib;
      }
    }
  }
  return total;
}

/** Filter specs for a tax bucket — data-driven via bucketSlotMap + TAX_TREATMENT_TO_BUCKET. */
export function filterSpecsForBucket<
  T extends { taxTreatment?: string; category?: string },
>(specs: T[], bucket: string): T[] {
  const map = bucketSlotMap[bucket];
  if (!map) return specs;
  // For buckets with a category filter (hsa, afterTax), only include matching specs
  if (map.categoryFilter)
    return specs.filter((s) => s.category === map.categoryFilter);
  // For preTax/taxFree (no category filter), exclude single-bucket categories
  // that have their own dedicated tax bucket (hsa, brokerage)
  const filtered = specs.filter(
    (s) => !s.category || !_singleBucketCategories.has(s.category),
  );
  if (!map.specTreatments) return filtered;
  return filtered.filter(
    (s) => s.taxTreatment != null && map.specTreatments!.has(s.taxTreatment),
  );
}

/** Filter individual accounts by tax bucket. ia.taxType already uses bucket names (preTax/taxFree/hsa/afterTax). */
export function iaBelongsToBucket(
  ia: { taxType: string },
  bucket: string,
): boolean {
  return ia.taxType === bucket;
}

// --- Shared calculation helpers ---

export function pctOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export function proRateMonths(fraction: number): number {
  return Math.round(fraction * 12);
}

export function specFrac({
  baseAnnual,
  specTotal,
  specCount,
}: SpecFracInput): number {
  return specTotal > 0
    ? baseAnnual / specTotal
    : specCount > 0
      ? 1 / specCount
      : 1;
}

export function matchFracOf({
  matchAnnual,
  allMatchAnnual,
}: MatchFracInput): number {
  return allMatchAnnual > 0 ? matchAnnual / allMatchAnnual : 0;
}

export function computeColumnChange({
  deflate,
  bal,
  year,
  prev,
  splitContrib,
  splitGrowth,
}: ColumnChangeInput) {
  const deflatedBal = deflate(bal, year);
  const deflatedPrev = prev ? deflate(prev.bal, prev.year) : 0;
  const displayContrib = deflate(splitContrib, year);
  const displayGrowth = deflate(splitGrowth, year);
  const displayChange = prev
    ? deflatedBal - deflatedPrev
    : displayContrib + displayGrowth;
  return {
    displayChange,
    displayContrib,
    displayGrowth,
    boyBal: prev
      ? deflatedPrev
      : deflate(bal - splitContrib - splitGrowth, year),
  };
}

/** Compute per-account contribution/growth splits from engine's tracked fields (not balance-change derivation). */
export function computeAccountSplits(
  accounts: IndividualAccountYearBalance[],
): AccountSplitsResult {
  const seen = new Set<string>();
  const splits: {
    name: string;
    category: string;
    taxType: string;
    balance: number;
    contribution: number;
    growth: number;
  }[] = [];
  let splitContrib = 0;
  let splitGrowth = 0;
  for (const ia of accounts) {
    const key = `${ia.category}::${ia.name}::${ia.taxType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contrib = Math.max(0, ia.contribution + ia.employerMatch);
    if (ia.balance > 0 || contrib > 1 || Math.abs(ia.growth) > 1) {
      splits.push({
        name: ia.name,
        category: ia.category,
        taxType: ia.taxType,
        balance: ia.balance,
        contribution: contrib,
        growth: ia.growth,
      });
      splitContrib += contrib;
      splitGrowth += ia.growth;
    }
  }
  return { splits, splitContrib, splitGrowth };
}
