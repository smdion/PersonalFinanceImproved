/**
 * Uninvested cash per account (holdings' cash plus money outside any position), judged for
 * cash drag against the current glide path's cash target, or for HSAs against a cash buffer.
 * Only accounts that report holdings are judged.
 */
import {
  isPreTaxType,
  isRothIncomeLimited,
  paysMedical,
} from "@/lib/config/account-types";
import type { CompositionBucket } from "@/lib/config/enum-values";
import { HDHP_MIN_DEDUCTIBLE_KEY } from "@/lib/config/tax-params";
import type { HsaCoverageType } from "@/lib/config/enum-values";
import { REBALANCE_BANDS } from "@/lib/config/milestones";
import { CASH_DRAG_MIN_EXCESS } from "@/lib/config/recommendations";
import {
  portfolioBuckets,
  type ValuedHolding,
} from "@/lib/pure/investments/fund-facts";
import { outsideRebalanceBand } from "@/lib/pure/advice/milestones/investing";

export type CashAccountInput = {
  simplefinAccountId: number;
  label: string;
  accountType: string | null;
  taxType: string | null;
  ownerPersonId: number | null;
  holdings: readonly ValuedHolding[];
  uninvestedCash: number | null;
};

export type CashFinding = {
  simplefinAccountId: number;
  label: string;
  /** Dollars to invest. */
  excess: number;
  /** The account's value counted (known mix + uninvested cash). */
  value: number;
};

/** Dollars in the given buckets and the value whose mix is known, incl. uninvested cash. */
function cashIn(a: CashAccountInput, buckets: ReadonlySet<CompositionBucket>) {
  const { buckets: dollars, unknown, total } = portfolioBuckets(a.holdings);
  const outside = a.uninvestedCash ?? 0;
  let inClass = outside;
  for (const b of buckets) inClass += dollars[b];
  return { inClass, known: total - unknown + outside };
}

export function judgeCashDrag(args: {
  accounts: readonly CashAccountInput[];
  /** The current glide path's target for the class cash counts toward, and
   *  the buckets that class takes. null = no current glide path. */
  cashClass: {
    targetShare: number;
    buckets: readonly CompositionBucket[];
  } | null;
  /** While a backdoor Roth is the plan, money in a traditional IRA is in
   *  transit, not drag. */
  excludeTraditionalIra: boolean;
}): CashFinding[] {
  const cls = args.cashClass;
  if (!cls) return [];
  const buckets = new Set(cls.buckets);
  const out: CashFinding[] = [];
  for (const a of args.accounts) {
    if (a.accountType !== null && paysMedical(a.accountType)) continue;
    // A whole-account link has no tax type; while a backdoor is the plan,
    // treat an IRA of unknown type like a traditional one (its cash may be
    // the contribution waiting to convert).
    if (
      args.excludeTraditionalIra &&
      a.accountType !== null &&
      isRothIncomeLimited(a.accountType) &&
      (a.taxType === null || isPreTaxType(a.taxType))
    )
      continue;
    const { inClass, known } = cashIn(a, buckets);
    if (known <= 0) continue;
    const share = inClass / known;
    if (share <= cls.targetShare) continue;
    if (!outsideRebalanceBand(share, cls.targetShare)) continue;
    if (share - cls.targetShare < REBALANCE_BANDS.minMove) continue;
    const excess = (share - cls.targetShare) * known;
    if (excess < CASH_DRAG_MIN_EXCESS) continue;
    out.push({
      simplefinAccountId: a.simplefinAccountId,
      label: a.label,
      excess,
      value: known,
    });
  }
  return out;
}

/** Each person's default HSA cash buffer: the year's HDHP minimum
 *  deductible for their coverage; null when coverage or the row is unknown. */
export function hsaCashBuffers(args: {
  people: readonly { personId: number; hsaCoverageType: string | null }[];
  limits: Record<string, number>;
}): { personId: number; buffer: number | null }[] {
  return args.people.map((p) => {
    const key =
      p.hsaCoverageType !== null
        ? HDHP_MIN_DEDUCTIBLE_KEY[p.hsaCoverageType as HsaCoverageType]
        : undefined;
    return {
      personId: p.personId,
      buffer: key !== undefined ? (args.limits[key] ?? null) : null,
    };
  });
}

/** The cash to keep in a person's HSA: the household setting, else their
 *  HDHP-deductible default; null = unknown (no item). The one rule — the
 *  HSA cash item and the buffer shown under the HSA both use it. */
export function resolveHsaCashBuffer(
  bufferSetting: number | null,
  defaultBuffers: readonly { personId: number; buffer: number | null }[],
  ownerPersonId: number | null,
): number | null {
  if (bufferSetting !== null) return bufferSetting;
  if (ownerPersonId === null) return null;
  return (
    defaultBuffers.find((b) => b.personId === ownerPersonId)?.buffer ?? null
  );
}

/** The current glide path's cash class and target for judgeCashDrag; null unless the
 *  target comes from the household's current glide path. */
export function currentCashClass(overview: {
  targetSource: string;
  allocation: {
    categories: readonly {
      bucket: CompositionBucket;
      assetClassId: number | null;
    }[];
    rows: readonly {
      assetClassId: number;
      buckets: readonly CompositionBucket[];
      targetPct: number | null;
    }[];
  };
}): { targetShare: number; buckets: readonly CompositionBucket[] } | null {
  if (overview.targetSource !== "current") return null;
  const classId =
    overview.allocation.categories.find((c) => c.bucket === "cash")
      ?.assetClassId ?? null;
  const row = overview.allocation.rows.find((r) => r.assetClassId === classId);
  return row && row.targetPct !== null
    ? { targetShare: row.targetPct, buckets: row.buckets }
    : null;
}

export function judgeHsaCash(args: {
  accounts: readonly CashAccountInput[];
  /** Household setting (dollars per HSA); null = the deductible default. */
  bufferSetting: number | null;
  defaultBuffers: readonly { personId: number; buffer: number | null }[];
}): (CashFinding & { buffer: number })[] {
  const cash = new Set<CompositionBucket>(["cash"]);
  const out: (CashFinding & { buffer: number })[] = [];
  for (const a of args.accounts) {
    if (a.accountType === null || !paysMedical(a.accountType)) continue;
    const buffer = resolveHsaCashBuffer(
      args.bufferSetting,
      args.defaultBuffers,
      a.ownerPersonId,
    );
    if (buffer === null) continue;
    const { inClass, known } = cashIn(a, cash);
    const excess = inClass - buffer;
    // Same minimum move as rebalancing, relative to the account.
    if (known <= 0 || excess < REBALANCE_BANDS.minMove * known) continue;
    out.push({
      simplefinAccountId: a.simplefinAccountId,
      label: a.label,
      excess,
      value: known,
      buffer,
    });
  }
  return out;
}
