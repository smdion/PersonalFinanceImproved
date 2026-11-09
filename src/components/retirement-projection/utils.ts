/** Data-driven utility functions and lookup tables for the projection table — tax bucket mapping, slot/column balance extraction, parent-category filtering, and per-account split computation. */
import type {
  EngineYearProjection,
  EngineAccumulationYear,
  AccumulationSlot,
} from "@/lib/pure/engine/types";
import {
  type AccountCategory,
  getAllCategories,
  getAccountTypeConfig,
  parseColumnKey,
  ACCOUNT_TYPE_CONFIG,
  isRothType,
  isTaxFree,
  isTaxFreeBucket,
  isPreTaxType,
  tracksCostBasis,
} from "@/lib/config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "@/lib/config/account-balance";
import {
  emptyTaxBucketMap,
  TAX_TREATMENT_TO_TAX_TYPE,
} from "@/lib/config/tax-treatment-buckets";
import { roundToCents, sumBy, safeDivide } from "@/lib/utils/math";
import { formatPercent } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
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

// Tooltip accent colors for every projection tooltip. Tooltip surfaces are always dark,
// so these are STATIC shades with no `--c-*` override in globals.css (red-400 is remapped
// but still reads on dark). Theme-adaptive surfaces use `--c-*` classes, not this map.
export const tipColorClass: Record<TipColor, string> = {
  green: "text-green-400",
  blue: "text-blue-400",
  red: "text-red-400",
  amber: "text-amber-400",
  emerald: "text-emerald-300",
  violet: "text-violet-400",
  gray: "text-slate-400", // matches this feature's own pre-existing muted/neutral convention (tooltip-renderer.tsx's meta/meta2/tax-split lines)
  teal: "text-teal-400", // SS accent
  purple: "text-purple-300", // MC accent
};

/** Display label for an account category. */
export const catDisplayLabel: Record<string, string> = Object.fromEntries(
  getAllCategories().map((cat) => [
    cat,
    getAccountTypeConfig(cat).displayLabel,
  ]),
);

/** Tax bucket → slot field mapping. Data-driven: add a bucket here, everything else follows. */
export const bucketSlotMap: Record<
  string,
  {
    /** Which slot field holds the contribution for this bucket? */
    contributionField: "traditionalContrib" | "rothContrib" | "employeeContrib";
    /** Which slot field holds the withdrawal for this bucket? */
    withdrawalField: "traditionalWithdrawal" | "rothWithdrawal" | "withdrawal";
    /** Only match slots whose category is this value (null = all categories). */
    categoryFilter: string | null;
    /** DB tax treatment values that belong to this bucket (null = all). Derived from TAX_TREATMENT_TO_TAX_TYPE. */
    specTreatments: Set<string> | null;
    /** Tax field string for itemTaxType(). */
    taxField: string | undefined;
    /** True if employer match for this bucket is "associated" (flows to another tax bucket, e.g. Roth match → Pre-Tax). */
    matchIsAssociated: boolean;
  }
> = {
  preTax: {
    contributionField: "traditionalContrib",
    withdrawalField: "traditionalWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_TAX_TYPE)
        .filter(([, v]) => isPreTaxType(v))
        .map(([k]) => k),
    ),
    taxField: "traditional",
    matchIsAssociated: false,
  },
  taxFree: {
    contributionField: "rothContrib",
    withdrawalField: "rothWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_TAX_TYPE)
        .filter(([, v]) => isTaxFreeBucket(v))
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
          contributionField: "employeeContrib" as const,
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

/** What a projection-card row shows as its balance: the row's tax buckets,
 *  which a parent-filtered row (filterYearByParentCategory) scopes to that
 *  view. Not a retirement answer — those read `retirementBalance`. */
export function rowTotal(yearRow: {
  balanceByTaxType: {
    preTax: number;
    taxFree: number;
    hsa: number;
    afterTax: number;
  };
}): number {
  const b = yearRow.balanceByTaxType;
  return roundToCents(b.preTax + b.taxFree + b.hsa + b.afterTax);
}

/** A year narrowed to one parent category's accounts. The engine's
 *  retirementBalance / allAccountsBalance stay as reported (they describe the
 *  plan, not the view). */
export function filterYearByParentCategory(
  yearRow: EngineYearProjection,
  parentCategory: string,
): EngineYearProjection {
  // No individual-account data (MC "Simple" tax mode collapses to one
  // fictional bucket): filtering is meaningless, so return the year unchanged
  // rather than zeroing every balance.
  if (yearRow.individualAccountBalances.length === 0) return yearRow;
  const filtered = yearRow.individualAccountBalances.filter(
    (ia) => ia.parentCategory === parentCategory,
  );
  const byTax = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const ia of filtered) {
    if (isTaxFreeBucket(ia.taxType)) {
      byTax.taxFree += ia.balance;
    } else {
      const cfg =
        ia.category in ACCOUNT_TYPE_CONFIG
          ? ACCOUNT_TYPE_CONFIG[ia.category as AccountCategory]
          : null;
      const bucket = cfg ? cfg.taxBucketKey : "preTax";
      if (bucket in byTax) {
        byTax[bucket as keyof typeof byTax] += ia.balance;
      } else {
        byTax.preTax += ia.balance;
      }
    }
  }
  // The engine tracks brokerage basis per account; an older result without
  // it falls back to a proportional estimate.
  const basisAccounts = filtered.filter((ia) => tracksCostBasis(ia.category));
  byTax.afterTaxBasis = basisAccounts.every((ia) => ia.costBasis != null)
    ? roundToCents(sumBy(basisAccounts, (ia) => ia.costBasis!))
    : roundToCents(
        yearRow.balanceByTaxType.afterTaxBasis *
          safeDivide(byTax.afterTax, yearRow.balanceByTaxType.afterTax),
      );
  const byAccount = { ...yearRow.balanceByAccount };
  for (const cat of getAllCategories()) {
    const catIabs = filtered.filter((ia) => ia.category === cat);
    const cfg = getAccountTypeConfig(cat);
    if (cfg.balanceStructure === "roth_traditional") {
      const trad = catIabs
        .filter((ia) => !isTaxFreeBucket(ia.taxType))
        .reduce((s, ia) => s + ia.balance, 0);
      const roth = catIabs
        .filter((ia) => isTaxFreeBucket(ia.taxType))
        .reduce((s, ia) => s + ia.balance, 0);
      byAccount[cat] = {
        structure: "roth_traditional" as const,
        traditional: trad,
        roth,
      };
    } else if (cfg.balanceStructure === "basis_tracking") {
      const balance = catIabs.reduce((s, ia) => s + ia.balance, 0);
      const origCatBalance = getTotalBalance(yearRow.balanceByAccount[cat]);
      const ratio = safeDivide(balance, origCatBalance);
      const origCatBasis =
        yearRow.balanceByAccount[cat].structure === "basis_tracking"
          ? yearRow.balanceByAccount[cat].basis
          : 0;
      byAccount[cat] = {
        structure: "basis_tracking" as const,
        balance: balance,
        basis: roundToCents(origCatBasis * ratio),
      };
    } else {
      byAccount[cat] = {
        structure: "single_bucket" as const,
        balance: catIabs.reduce((s, ia) => s + ia.balance, 0),
      };
    }
  }
  if (yearRow.phase !== "decumulation") {
    // Contributions rebuilt from what the kept accounts received (the engine
    // routes per category). Routing flags (caps, remaining space, overflow)
    // stay household-wide, as for withdrawals below.
    const sum = (
      rows: typeof filtered,
      pick: (ia: (typeof filtered)[number]) => number,
    ) => roundToCents(rows.reduce((t, ia) => t + pick(ia), 0));
    const accumSlots =
      "slots" in yearRow
        ? yearRow.slots.map((slot) => {
            const catIabs = filtered.filter(
              (ia) => ia.category === slot.category,
            );
            return {
              ...slot,
              employeeContrib: sum(catIabs, (ia) => ia.contribution),
              employerMatch: sum(catIabs, (ia) => ia.employerMatch),
              rothContrib: sum(
                catIabs.filter((ia) => isTaxFreeBucket(ia.taxType)),
                (ia) => ia.contribution,
              ),
              traditionalContrib: sum(
                catIabs.filter((ia) => isPreTaxType(ia.taxType)),
                (ia) => ia.contribution,
              ),
            };
          })
        : undefined;
    return {
      ...yearRow,
      individualAccountBalances: filtered,
      balanceByTaxType: byTax,
      balanceByAccount: byAccount,
      ...(accumSlots
        ? {
            slots: accumSlots,
            totalEmployee: sum(filtered, (ia) => ia.contribution),
            totalEmployer: sum(filtered, (ia) => ia.employerMatch),
            totalRoth: sum(
              filtered.filter((ia) => isTaxFreeBucket(ia.taxType)),
              (ia) => ia.contribution,
            ),
            totalTraditional: sum(
              filtered.filter((ia) => isPreTaxType(ia.taxType)),
              (ia) => ia.contribution,
            ),
          }
        : {}),
    };
  }

  // Withdrawals rescoped to the balances' account subset by summing what each
  // kept account recorded. Routing flags (cappedByAccount/cappedByTaxType/
  // remainingNeed) stay household-wide: they reflect a real global constraint.
  const filteredSlots = yearRow.slots.map((slot) => {
    const catIabs = filtered.filter((ia) => ia.category === slot.category);
    const cfg = getAccountTypeConfig(slot.category);
    let withdrawal: number;
    let rothWithdrawal: number;
    let traditionalWithdrawal: number;
    if (cfg.balanceStructure === "roth_traditional") {
      traditionalWithdrawal = roundToCents(
        catIabs
          .filter((ia) => !isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      rothWithdrawal = roundToCents(
        catIabs
          .filter((ia) => isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      withdrawal = roundToCents(traditionalWithdrawal + rothWithdrawal);
    } else {
      withdrawal = roundToCents(
        catIabs.reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      rothWithdrawal = 0;
      traditionalWithdrawal = 0;
    }
    // Basis/gains aren't tracked per individual account — prorate by the
    // same withdrawal ratio, mirroring the basis proration above.
    const ratio = safeDivide(withdrawal, slot.withdrawal);
    return {
      ...slot,
      withdrawal,
      rothWithdrawal,
      traditionalWithdrawal,
      basisPortion:
        slot.basisPortion != null
          ? roundToCents(slot.basisPortion * ratio)
          : slot.basisPortion,
      gainsPortion:
        slot.gainsPortion != null
          ? roundToCents(slot.gainsPortion * ratio)
          : slot.gainsPortion,
    };
  });
  const totalWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.withdrawal, 0),
  );
  const totalTraditionalWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.traditionalWithdrawal, 0),
  );
  const totalRothWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.rothWithdrawal, 0),
  );

  // targetWithdrawal/taxCost scale by the same ratio as the slots, so a fully
  // funded scoped plan never reads as underfunded (effectiveTaxRate is
  // unchanged). Expenses and RMD/QCD figures stay household-wide obligations.
  const targetRatio = safeDivide(totalWithdrawal, yearRow.totalWithdrawal, 1);
  const targetWithdrawal = roundToCents(yearRow.targetWithdrawal * targetRatio);
  // Only the withdrawal's tax scales; tax on Social Security is the
  // household's, whichever accounts this view shows.
  const taxCost = roundToCents(
    (yearRow.taxCost - yearRow.ssTaxCost) * targetRatio + yearRow.ssTaxCost,
  );

  return {
    ...yearRow,
    individualAccountBalances: filtered,
    balanceByTaxType: byTax,
    balanceByAccount: byAccount,
    slots: filteredSlots,
    totalWithdrawal,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    targetWithdrawal,
    taxCost,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isAccumYear(
  yearRow: EngineYearProjection,
): yearRow is EngineAccumulationYear {
  return yearRow.phase === "accumulation";
}

export function itemTaxType(
  category: string,
  taxField?: string,
): "roth" | "traditional" | undefined {
  const cfg =
    category in ACCOUNT_TYPE_CONFIG
      ? ACCOUNT_TYPE_CONFIG[category as AccountCategory]
      : null;
  if (!cfg || !cfg.supportsRothSplit) return undefined;
  const t = taxField ?? "";
  if (isRothType(t) || isTaxFree(t) || isTaxFreeBucket(t)) return "roth";
  return "traditional";
}

type ColumnTreatment = "traditional" | "roth" | null; // a Roth-split column's side
const isRothColumn = (t: ColumnTreatment) => t === "roth";
const isTraditionalColumn = (t: ColumnTreatment) => t === "traditional";

/** Derive category + tax treatment from a column key like '401k_trad', 'hsa', 'brokerage'. */
export function colKeyParts(key: string): {
  category: string;
  treatment: ColumnTreatment;
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
  ba: import("@/lib/pure/accounts/account-balances.types").AccountBalances,
  key: string,
): number {
  const { category, treatment } = colKeyParts(key);
  const balance = ba[category as AccountCategory];
  if (!balance) return 0;
  if (isRothColumn(treatment)) return getRothBalance(balance);
  if (isTraditionalColumn(treatment)) return getTraditionalBalance(balance);
  return getTotalBalance(balance);
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
    if (isRothColumn(treatment)) total += slot.rothWithdrawal;
    else if (isTraditionalColumn(treatment))
      total += slot.traditionalWithdrawal;
    else total += slot.withdrawal;
  }
  return total;
}

/** Map a column key (e.g. '401k_roth', 'hsa') to the engine's taxType string for IA filtering. */
export function colEngineTaxType(key: string): string | null {
  const { treatment } = colKeyParts(key);
  if (isRothColumn(treatment)) return "taxFree";
  if (isTraditionalColumn(treatment)) return "preTax";
  const parsed = parseColumnKey(key);
  if (parsed) {
    const cfg = ACCOUNT_TYPE_CONFIG[parsed.category];
    return cfg.taxBucketKey;
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
export function slotBucketContribution(
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
  return slot[map.contributionField as keyof typeof slot] as number;
}

/** Total balance inflow (employee + match) for a specific account column — mirrors engine balance routing. */
export function slotsColumnBalanceInflow(
  slots: AccumulationSlot[],
  colKey: string,
): number {
  const { category, treatment } = colKeyParts(colKey);
  const slot = slots.find((s) => s.category === category);
  if (!slot) return 0;
  if (isTraditionalColumn(treatment))
    return slot.traditionalContrib + slot.employerMatch;
  if (isRothColumn(treatment)) return slot.rothContrib; // roth match flows to preTax, not here
  return slot.employeeContrib + slot.employerMatch;
}

/** Total balance inflow (employee + match) routed to a tax bucket — mirrors engine balance routing. */
export function slotsBucketBalanceInflow(
  slots: AccumulationSlot[],
  bucket: string,
): number {
  let total = 0;
  for (const slot of slots) {
    const emp = slotBucketContribution(slot, bucket);
    if (emp <= 0 && slot.employerMatch <= 0) continue;
    const map = bucketSlotMap[bucket];
    if (!map) continue;
    if (map.categoryFilter) {
      // Single-bucket (hsa, brokerage): employee + match both go to this bucket
      if (slot.category === map.categoryFilter)
        total += slot.employeeContrib + slot.employerMatch;
    } else if (!_singleBucketCategories.has(slot.category)) {
      // roth_traditional: preTax gets traditionalContrib + ALL match; taxFree gets rothContrib only
      if (map.contributionField === "traditionalContrib") {
        total += slot.traditionalContrib + slot.employerMatch;
      } else {
        total += slot.rothContrib;
      }
    }
  }
  return total;
}

/** Filter specs for a tax bucket — data-driven via bucketSlotMap + TAX_TREATMENT_TO_TAX_TYPE. */
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

// Re-exported from lib/pure so the advisor report and the tooltip call sites
// share one implementation.
export {
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
} from "@/lib/pure/advice/report/withdrawal-strategy-narrative";

export function percentOf(value: number, total: number): number {
  return Math.round(safeDivide(value, total) * 100);
}

export function proRateMonths(fraction: number): number {
  return Math.round(fraction * 12);
}

export function specFrac({
  baseAnnual,
  specTotal,
  specCount,
}: SpecFracInput): number {
  return specTotal > 0 ? baseAnnual / specTotal : safeDivide(1, specCount, 1);
}

export function matchFracOf({
  matchAnnual,
  allMatchAnnual,
}: MatchFracInput): number {
  return safeDivide(matchAnnual, allMatchAnnual);
}

export function computeColumnChange({
  deflate,
  balance,
  year,
  prev,
  splitContribution,
  splitGrowth,
}: ColumnChangeInput) {
  const deflatedBalance = deflate(balance, year);
  const deflatedPrev = prev ? deflate(prev.balance, prev.year) : 0;
  const displayContribution = deflate(splitContribution, year);
  const displayGrowth = deflate(splitGrowth, year);
  const displayChange = prev
    ? deflatedBalance - deflatedPrev
    : displayContribution + displayGrowth;
  return {
    displayChange,
    displayContribution,
    displayGrowth,
    boyBalance: prev
      ? deflatedPrev
      : deflate(balance - splitContribution - splitGrowth, year),
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
  let splitContribution = 0;
  let splitGrowth = 0;
  for (const ia of accounts) {
    const key = `${ia.category}::${ia.name}::${ia.taxType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contribution = Math.max(0, ia.contribution + ia.employerMatch);
    if (ia.balance > 0 || contribution > 1 || Math.abs(ia.growth) > 1) {
      splits.push({
        name: ia.name,
        category: ia.category,
        taxType: ia.taxType,
        balance: ia.balance,
        contribution: contribution,
        growth: ia.growth,
      });
      splitContribution += contribution;
      splitGrowth += ia.growth;
    }
  }
  return { splits, splitContribution, splitGrowth };
}

// ---------------------------------------------------------------------------
// Lump sum helpers
// ---------------------------------------------------------------------------

import type { LumpSum } from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";

type PortfolioTaxBucket = "preTax" | "taxFree" | "hsa" | "afterTax";

/** Determine which tax bucket a lump sum targets, using config-driven balance structure. */
export function lumpSumTaxBucket(ls: LumpSum): PortfolioTaxBucket {
  const bs = getAccountTypeConfig(ls.targetAccount).balanceStructure;
  if (bs === "roth_traditional")
    return isRothType(ls.taxType ?? "") ? "taxFree" : "preTax";
  if (bs === "single_bucket") return "hsa";
  return "afterTax";
}

/** Sum lump sums targeting a specific tax bucket. */
export function lumpSumsForBucket(
  lumpSums: LumpSum[],
  bucket: PortfolioTaxBucket,
): LumpSum[] {
  return lumpSums.filter((ls) => lumpSumTaxBucket(ls) === bucket);
}

/** Sum lump sums targeting a specific account category. */
export function lumpSumsForCategory(
  lumpSums: LumpSum[],
  category: AccountCategory,
): LumpSum[] {
  return lumpSums.filter((ls) => ls.targetAccount === category);
}

/** Total dollar amount of lump sums. */
export function lumpSumTotal(lumpSums: LumpSum[]): number {
  return lumpSums.reduce((s, ls) => s + ls.amount, 0);
}

// ---------------------------------------------------------------------------
// Guardrail/strategy event styling, shared by chart markers and table tooltip.
// ---------------------------------------------------------------------------

type StrategyEventStyle = {
  color: string;
  label: string;
  tooltipText: string;
};

/** Per-strategy spending-adjustment event styling, keyed by
 *  `EngineDecumulationYear.strategyAction`. Percent context comes from the
 *  household's own settings (the % actually applied that year). */
export function buildStrategyEventStyle(
  engineSettings:
    | {
        withdrawalStrategy?: string | null;
        gkIncreasePct?: string | number | null;
        gkDecreasePct?: string | number | null;
        vdCeilingPercent?: string | number | null;
        vdFloorPercent?: string | number | null;
        cpFloorPercent?: string | number | null;
        enFloorPercent?: string | number | null;
      }
    | null
    | undefined,
): Record<string, StrategyEventStyle> {
  const pct = (v: unknown) => (v != null ? formatPercent(Number(v), 0) : null);
  const gkIncreasePct = pct(engineSettings?.gkIncreasePct);
  const gkDecreasePct = pct(engineSettings?.gkDecreasePct);
  const vdCeilingPercent = pct(engineSettings?.vdCeilingPercent);
  const vdFloorPercent = pct(engineSettings?.vdFloorPercent);
  const cpFloorPercent = pct(engineSettings?.cpFloorPercent);
  const enFloorPercent = pct(engineSettings?.enFloorPercent);
  const activeStrategy = engineSettings?.withdrawalStrategy;

  return {
    increase: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: gkIncreasePct ? `▲ raise +${gkIncreasePct}` : "▲ raise",
      tooltipText: `Upper guardrail triggered — spending raised${gkIncreasePct ? ` ${gkIncreasePct}` : ""}`,
    },
    decrease: {
      color: CHART_COLORS.guardrailDecreaseMarker,
      label: gkDecreasePct ? `▼ cut -${gkDecreasePct}` : "▼ cut",
      tooltipText: `Lower guardrail triggered — spending cut${gkDecreasePct ? ` ${gkDecreasePct}` : ""}`,
    },
    skip_inflation: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label: "⏸ no raise",
      tooltipText:
        "Withdrawal rule — inflation raise skipped after a loss year",
    },
    ceiling_applied: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: vdCeilingPercent ? `▲ capped @${vdCeilingPercent}` : "▲ capped",
      tooltipText: `Year-over-year ceiling reached${vdCeilingPercent ? ` (max +${vdCeilingPercent}/yr)` : ""} — raise capped, spending still rose just not as much as your balance alone would set`,
    },
    vpw_cap: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: "▲ at cap",
      tooltipText:
        "VPW's percentage has reached its cap — it holds there from now on",
    },
    floor_applied: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label:
        activeStrategy === "vanguard_dynamic" && vdFloorPercent
          ? `▼ floor @${vdFloorPercent}`
          : "▼ floor",
      tooltipText:
        activeStrategy === "vanguard_dynamic"
          ? `Year-over-year floor reached${vdFloorPercent ? ` (max -${vdFloorPercent}/yr)` : ""} — cut limited, spending still fell just not as much as your balance alone would set`
          : `Nominal floor reached${
              activeStrategy === "endowment"
                ? enFloorPercent
                  ? ` (${enFloorPercent} of your initial withdrawal)`
                  : ""
                : cpFloorPercent
                  ? ` (${cpFloorPercent} of your initial withdrawal)`
                  : ""
            } — spending held at the floor instead of following your balance down further`,
    },
  };
}
