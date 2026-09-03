/** Data-driven utility functions and lookup tables for the projection table — tax bucket mapping, slot/column balance extraction, parent-category filtering, and per-account split computation. */
import type {
  EngineYearProjection,
  EngineAccumulationYear,
  AccumulationSlot,
  IndividualAccountYearBalance,
} from "@/lib/calculators/types";
import {
  type AccountCategory,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getAllCategories,
  getAccountTypeConfig,
  parseColumnKey,
  ACCOUNT_TYPE_CONFIG,
  isRothType,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import {
  roundToCents,
  safeDivide as canonicalSafeDivide,
} from "@/lib/utils/math";
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

// Centralized tooltip accent-color lookup (2026-08-30 UI/UX pass) — every
// projection tooltip color, chart or table, single-select or hand-rolled
// JSX, resolves through here.
//
// Corrected twice in the same pass. First pass (wrong): treated "hard to
// read depending on theme" as a missing-theme-override problem and swapped
// every broken shade for one of globals.css's `--c-<color>-<shade>`
// PAGE-theme-remapped overrides. Second pass (this one): these tooltips
// (both this chart's own hand-rolled Recharts tooltip AND the table's
// shared `Tooltip` UI primitive, see ui/tooltip.tsx's TOOLTIP_SURFACE_
// CLASSES) render on a surface that's deliberately dark REGARDLESS of the
// page's own light/dark setting (bg-slate-900 / dark:bg-slate-700 — both
// dark, neither theme-adaptive). Routing tooltip TEXT through the
// PAGE-theme system was solving the wrong layer: the container doesn't
// track page theme, so text that does track it can end up chosen for the
// wrong (light-page-assuming) background regardless of which shade number
// gets picked. Every value below is therefore a STATIC shade -- one with
// NO `--c-*` override in globals.css, so it resolves to Tailwind's plain
// default and stays the same fixed, dark-surface-legible color no matter
// what the page's own theme is set to (the exact "readable on a dark
// background" role Tailwind's own 300-400 tier exists for). `red` is the
// one exception: every red-* shade IS remapped (no static option exists in
// this app), so red-400 is used deliberately -- its own light-page-mode
// value is still light/saturated enough to read on a dark surface, unlike
// the darker 600-800 tier (chosen for text-on-white, not text-on-dark).
//
// This is the OPPOSITE selection rule from ordinary page content (badges,
// status text, borders), which correctly SHOULD use the `--c-*` system so
// it tracks the page's own theme. Don't "fix" these shades again by
// routing them through `--c-*` overrides — that regresses back to the
// first, wrong pass. If a NEW tooltip surface is added that IS
// theme-adaptive (like a page-background card, not a hover tooltip), it
// needs its OWN color choices via the normal `--c-*`-remapped classes,
// not this map.
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
  // No individual-account data to filter by at all (MC "Simple" tax mode —
  // see monte-carlo.ts's Simple-mode block — has no per-account/parent-
  // category structure left once it collapses to one fictional bucket).
  // Filtering by parent category is meaningless here; returning `yr`
  // unchanged is the honest degradation, not zeroing every balance/
  // withdrawal field below to match an empty account list (live-user
  // finding, 2026-08-28 — Rate-Seeded showed $0 balances everywhere
  // because this function was doing exactly that).
  if (yr.individualAccountBalances.length === 0) return yr;
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
  const origAfterTax = yr.balanceByTaxType.afterTax;
  const origBasis = yr.balanceByTaxType.afterTaxBasis;
  byTax.afterTaxBasis = roundToCents(
    origBasis * safeDivide(byTax.afterTax, origAfterTax),
  );
  const byAcct = { ...yr.balanceByAccount };
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
      byAcct[cat] = {
        structure: "roth_traditional" as const,
        traditional: trad,
        roth,
      };
    } else if (cfg.balanceStructure === "basis_tracking") {
      const bal = catIabs.reduce((s, ia) => s + ia.balance, 0);
      const origCatBal = getTotalBalance(yr.balanceByAccount[cat]);
      const ratio = safeDivide(bal, origCatBal);
      const origCatBasis =
        yr.balanceByAccount[cat].structure === "basis_tracking"
          ? yr.balanceByAccount[cat].basis
          : 0;
      byAcct[cat] = {
        structure: "basis_tracking" as const,
        balance: bal,
        basis: roundToCents(origCatBasis * ratio),
      };
    } else {
      byAcct[cat] = {
        structure: "single_bucket" as const,
        balance: catIabs.reduce((s, ia) => s + ia.balance, 0),
      };
    }
  }
  const endBalance = roundToCents(
    byTax.preTax + byTax.taxFree + byTax.hsa + byTax.afterTax,
  );

  if (yr.phase !== "decumulation") {
    return {
      ...yr,
      individualAccountBalances: filtered,
      balanceByTaxType: byTax,
      balanceByAccount: byAcct,
      endBalance,
    };
  }

  // Rescope withdrawals to the same account subset as the balances above —
  // otherwise a filtered "After-Tax: $32k" balance sits next to an
  // unfiltered "Brokerage: -$30k" withdrawal that was mostly drawn from a
  // Portfolio-parented account this page never shows, making it look like
  // the account is being overdrawn. `slots` has no per-account structure
  // in the engine (it's a per-category routing decision), so this sums the
  // withdrawal each filtered *account* actually recorded rather than
  // re-deriving what routing would have decided for a smaller pool — the
  // routing-decision flags below (cappedByAccount/cappedByTaxType/
  // remainingNeed) are left as the true household-wide values since they
  // reflect a real global constraint (bracket-filling, account limits) that
  // doesn't change based on this page's display-only account grouping.
  const filteredSlots = yr.slots.map((slot) => {
    const catIabs = filtered.filter((ia) => ia.category === slot.category);
    const cfg = getAccountTypeConfig(slot.category);
    let withdrawal: number;
    let rothWithdrawal: number;
    let traditionalWithdrawal: number;
    if (cfg.balanceStructure === "roth_traditional") {
      traditionalWithdrawal = roundToCents(
        catIabs
          .filter((ia) => !isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.withdrawal ?? 0), 0),
      );
      rothWithdrawal = roundToCents(
        catIabs
          .filter((ia) => isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.withdrawal ?? 0), 0),
      );
      withdrawal = roundToCents(traditionalWithdrawal + rothWithdrawal);
    } else {
      withdrawal = roundToCents(
        catIabs.reduce((s, ia) => s + (ia.withdrawal ?? 0), 0),
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

  // Rescope targetWithdrawal/taxCost by the SAME filtered/unfiltered ratio
  // as the slots above, instead of leaving them at their household-wide
  // values (advisor review, 2026-08-29). Leaving targetWithdrawal
  // household-wide while totalWithdrawal is Retirement-scoped meant a
  // FULLY-funded plan could still compare as "underfunded" — the amber
  // withdrawal-cell coloring, the tooltip's "Eff. rate = tax / withdrawal"
  // claim, and a literal false SHORTFALL string in diag mode all read off
  // that same mismatch. taxCost is prorated the same way, matching the
  // proration this function already applies to basis/gains above —
  // effectiveTaxRate (taxCost/totalWithdrawal) is invariant under a
  // shared scale factor, so it stays correct with no separate change.
  // projectedExpenses/rmdAmount/qcdAmount/rmdExcessAmount are
  // DELIBERATELY left household-wide: RMD is a real IRS obligation on the
  // full Traditional balance regardless of account grouping (same
  // rationale rmd-smoothing.ts's docblock gives for never scoping the
  // balance an RMD is measured against), and projectedExpenses is the
  // household's real stated spending need, independent of which accounts
  // this display-only filter happens to be scoped to.
  const targetRatio = canonicalSafeDivide(
    totalWithdrawal,
    yr.totalWithdrawal,
    1,
  );
  const targetWithdrawal = roundToCents(yr.targetWithdrawal * targetRatio);
  const taxCost = roundToCents(yr.taxCost * targetRatio);

  return {
    ...yr,
    individualAccountBalances: filtered,
    balanceByTaxType: byTax,
    balanceByAccount: byAcct,
    endBalance,
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
      ? ACCOUNT_TYPE_CONFIG[category as AccountCategory]
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
  const bal = ba[category as AccountCategory];
  if (!bal) return 0;
  if (treatment === "roth") return getRothBalance(bal);
  if (treatment === "traditional" || treatment === "trad")
    return getTraditionalBalance(bal);
  return getTotalBalance(bal);
}

/**
 * Safe division — returns 0 when divisor is 0.
 * Thin wrapper around the canonical `safeDivide` in `@/lib/utils/math`
 * (previously a local reimplementation with a 1e-9 epsilon threshold instead
 * of an exact `=== 0` check). All call sites in this module already guard
 * their denominators with an explicit `> 0` check before calling, so the
 * epsilon vs. exact-zero difference is not reachable here.
 */
export function safeDivide(numerator: number, denominator: number): number {
  return canonicalSafeDivide(numerator, denominator, 0)!;
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

// Moved to lib/pure/report/withdrawal-strategy-narrative.ts so
// the retirement advisor report can reuse them without a pure module
// importing this component-layer file — re-exported here so the existing
// tooltip call sites (projection-table-decum-row.tsx) don't need to change
// their import path.
export {
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
} from "@/lib/pure/report/withdrawal-strategy-narrative";

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
  return safeDivide(matchAnnual, allMatchAnnual);
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

// ---------------------------------------------------------------------------
// Lump sum helpers
// ---------------------------------------------------------------------------

import type { LumpSum } from "@/lib/calculators/types/shared";

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
// Guardrail/strategy event styling (shared between the Balance chart's
// ReferenceLine markers and the table's "Total Withdrawals" tooltip —
// UI/UX review, 2026-08-28: the table tooltip previously had no
// user-visible explanation for a spending jump/drop, only the hidden
// diagMode diagnostic dump. Factored out here so both call sites can never
// independently drift on color/wording.)
// ---------------------------------------------------------------------------

export type StrategyEventStyle = {
  color: string;
  label: string;
  tooltipText: string;
};

/** Per-strategy spending-adjustment event styling, keyed by
 *  `EngineDecumulationYear.strategyAction`. Percent context (raise/cut/
 *  ceiling/floor %) comes straight from the household's own settings —
 *  the actual % applied that year, not a guess. */
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
  const vdCeilingPct = pct(engineSettings?.vdCeilingPercent);
  const vdFloorPct = pct(engineSettings?.vdFloorPercent);
  const cpFloorPct = pct(engineSettings?.cpFloorPercent);
  const enFloorPct = pct(engineSettings?.enFloorPercent);
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
        "Prosperity rule — inflation raise skipped after a loss year",
    },
    ceiling_applied: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: vdCeilingPct ? `▲ capped @${vdCeilingPct}` : "▲ capped",
      tooltipText: `Year-over-year ceiling reached${vdCeilingPct ? ` (max +${vdCeilingPct}/yr)` : ""} — raise capped, spending still rose just not as much as your balance alone would set`,
    },
    floor_applied: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label:
        activeStrategy === "vanguard_dynamic" && vdFloorPct
          ? `▼ floor @${vdFloorPct}`
          : "▼ floor",
      tooltipText:
        activeStrategy === "vanguard_dynamic"
          ? `Year-over-year floor reached${vdFloorPct ? ` (max -${vdFloorPct}/yr)` : ""} — cut limited, spending still fell just not as much as your balance alone would set`
          : `Nominal floor reached${
              activeStrategy === "endowment"
                ? enFloorPct
                  ? ` (${enFloorPct} of your initial withdrawal)`
                  : ""
                : cpFloorPct
                  ? ` (${cpFloorPct} of your initial withdrawal)`
                  : ""
            } — spending held at the floor instead of following your balance down further`,
    },
  };
}
