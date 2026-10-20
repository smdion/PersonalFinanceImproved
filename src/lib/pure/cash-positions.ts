/**
 * Uninvested cash, per account — judged once here; the cash-drag and HSA
 * cash recommendations map the results.
 *
 * An account's cash = its holdings' cash (each fund's composition) plus
 * money outside any reported position (uninvestedCash, from the feed's
 * same-day balance). Only accounts that report holdings are judged: a feed
 * that reports none can't be told apart from an all-cash account.
 *
 * Cash drag compares an account's share in the current glide path's cash
 * class with its target, using the rebalancing band (one band rule) and the
 * same minimum move. No current glide path → nothing (the simulation's
 * glide path isn't a holding target). HSA accounts are judged on a cash
 * buffer instead: the household setting, else the year's HDHP minimum
 * deductible for the owner's coverage (unknown coverage → nothing).
 */
import {
  isHsaCategory,
  isIraCategory,
  isPreTaxType,
} from "@/lib/config/account-types";
import type { CompositionBucket } from "@/lib/config/enum-values";
import { HDHP_MIN_DEDUCTIBLE_KEY } from "@/lib/config/tax-params";
import type { HsaCoverageType } from "@/lib/config/enum-values";
import { REBALANCE_BANDS } from "@/lib/config/milestones";
import { portfolioBuckets, type ValuedHolding } from "@/lib/pure/fund-facts";
import { outsideRebalanceBand } from "@/lib/pure/milestones";

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
    if (a.accountType !== null && isHsaCategory(a.accountType)) continue;
    // A whole-account link has no tax type; while a backdoor is the plan,
    // treat an IRA of unknown type like a traditional one (its cash may be
    // the contribution waiting to convert).
    if (
      args.excludeTraditionalIra &&
      a.accountType !== null &&
      isIraCategory(a.accountType) &&
      (a.taxType === null || isPreTaxType(a.taxType))
    )
      continue;
    const { inClass, known } = cashIn(a, buckets);
    if (known <= 0) continue;
    const share = inClass / known;
    if (share <= cls.targetShare) continue;
    if (!outsideRebalanceBand(share, cls.targetShare)) continue;
    if (share - cls.targetShare < REBALANCE_BANDS.minMove) continue;
    out.push({
      simplefinAccountId: a.simplefinAccountId,
      label: a.label,
      excess: (share - cls.targetShare) * known,
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

export function judgeHsaCash(args: {
  accounts: readonly CashAccountInput[];
  /** Household setting (dollars per HSA); null = the deductible default. */
  bufferSetting: number | null;
  defaultBuffers: readonly { personId: number; buffer: number | null }[];
}): (CashFinding & { buffer: number })[] {
  const byPerson = new Map(
    args.defaultBuffers.map((b) => [b.personId, b.buffer]),
  );
  const cash = new Set<CompositionBucket>(["cash"]);
  const out: (CashFinding & { buffer: number })[] = [];
  for (const a of args.accounts) {
    if (a.accountType === null || !isHsaCategory(a.accountType)) continue;
    const buffer =
      args.bufferSetting ??
      (a.ownerPersonId !== null
        ? (byPerson.get(a.ownerPersonId) ?? null)
        : null);
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
