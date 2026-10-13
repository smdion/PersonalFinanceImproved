/**
 * Facts in use for each fund, and what they add up to across holdings.
 * Pure.
 *
 * - A household entry wins over SEC; otherwise the latest SEC filing.
 * - Expense ratio and composition are each taken whole from one row —
 *   never mixed across filings.
 * - Facts older than 15 months are flagged stale.
 */
import { HALF_CENT } from "@/lib/constants";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
  type SecurityFactSource,
} from "@/lib/config/enum-values";

export type FactRow = {
  source: SecurityFactSource;
  asOf: string;
  expenseRatio: number | null;
  /** Null when the row carries no composition. */
  composition:
    (Record<CompositionBucket, number> & { coverage: number }) | null;
};

export type EffectiveFacts = {
  expenseRatio: { value: number; asOf: string; fromUser: boolean } | null;
  composition: {
    buckets: Record<CompositionBucket, number>;
    coverage: number;
    asOf: string;
    fromUser: boolean;
  } | null;
  stale: boolean;
};

const STALE_MONTHS = 15;

function newest<T extends { asOf: string }>(rows: T[]): T | undefined {
  return [...rows].sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
}

export function effectiveFacts(
  rows: readonly FactRow[],
  today: string,
): EffectiveFacts {
  const pick = (has: (r: FactRow) => boolean) => {
    const user = newest(rows.filter((r) => r.source === "user" && has(r)));
    return user ?? newest(rows.filter((r) => r.source !== "user" && has(r)));
  };
  const er = pick((r) => r.expenseRatio !== null);
  const comp = pick((r) => r.composition !== null);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - STALE_MONTHS);
  // eslint-disable-next-line local/no-tz-unsafe-date-string -- `today` is parsed and shifted in UTC, so the UTC day is exactly 15 months before it; compared only with stored filing dates, never with a local "today".
  const cutoffDay = cutoff.toISOString().slice(0, 10); // lint-violation-ok: date arithmetic done entirely in UTC
  const used = [er, comp].filter(
    (r): r is FactRow => !!r && r.source !== "user",
  );
  return {
    expenseRatio: er
      ? {
          value: er.expenseRatio!,
          asOf: er.asOf,
          fromUser: er.source === "user",
        }
      : null,
    composition: comp
      ? {
          buckets: Object.fromEntries(
            COMPOSITION_BUCKET_VALUES.map((b) => [b, comp.composition![b]]),
          ) as Record<CompositionBucket, number>,
          coverage: comp.composition!.coverage,
          asOf: comp.asOf,
          fromUser: comp.source === "user",
        }
      : null,
    stale: used.some((r) => r.asOf < cutoffDay),
  };
}

export type ValuedHolding = {
  value: number;
  facts: EffectiveFacts;
};

/**
 * Dollars per composition bucket across holdings. Value whose fund has no
 * composition, or that its coverage leaves unexplained, is `unknown`.
 */
export function portfolioBuckets(holdings: readonly ValuedHolding[]): {
  buckets: Record<CompositionBucket, number>;
  unknown: number;
  total: number;
} {
  const buckets = Object.fromEntries(
    COMPOSITION_BUCKET_VALUES.map((b) => [b, 0]),
  ) as Record<CompositionBucket, number>;
  let unknown = 0;
  let total = 0;
  for (const h of holdings) {
    total += h.value;
    const c = h.facts.composition;
    if (!c) {
      unknown += h.value;
      continue;
    }
    const known = h.value * c.coverage;
    unknown += h.value - known;
    for (const b of COMPOSITION_BUCKET_VALUES)
      buckets[b] += known * c.buckets[b];
  }
  return { buckets, unknown, total };
}

/** Value-weighted expense ratio, yearly cost, and the share of value it covers. */
export function blendedCost(holdings: readonly ValuedHolding[]): {
  expenseRatio: number | null;
  yearlyCost: number;
  coveredShare: number;
} {
  let covered = 0;
  let total = 0;
  let cost = 0;
  for (const h of holdings) {
    total += h.value;
    const er = h.facts.expenseRatio?.value;
    if (er == null) continue;
    covered += h.value;
    cost += h.value * er;
  }
  return {
    expenseRatio: covered > 0 ? cost / covered : null,
    yearlyCost: cost,
    coveredShare: total > 0 ? covered / total : 0,
  };
}

/** A fund smaller than this share of its account doesn't make it "multi-fund" (e.g. cash dust). */
const ROLLUP_MIN_SHARE = 0.01;

/**
 * One account's funds added up — mix as shares of the money whose mix is
 * known, plus blended cost — or null when the account effectively holds a
 * single fund (then that fund's own row already says it all).
 */
export function accountRollup(holdings: readonly ValuedHolding[]): {
  mix: Record<CompositionBucket, number> | null;
  /** Share of the account's value whose mix is known. */
  coverage: number;
  cost: ReturnType<typeof blendedCost>;
} | null {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return null;
  const meaningful = holdings.filter(
    (h) => h.value / total >= ROLLUP_MIN_SHARE,
  );
  if (meaningful.length < 2) return null;
  const { buckets, unknown } = portfolioBuckets(holdings);
  const known = total - unknown;
  return {
    mix:
      known > 0
        ? (Object.fromEntries(
            COMPOSITION_BUCKET_VALUES.map((b) => [b, buckets[b] / known]),
          ) as Record<CompositionBucket, number>)
        : null,
    coverage: known / total,
    cost: blendedCost(holdings),
  };
}

/**
 * Value per asset class from value per bucket, through the household's
 * links (bucket → the class it counts toward; several buckets may feed one
 * class). Buckets with value but no link are listed so they can be shown
 * as left out. The one place bucket values become class values.
 */
export function valueByClass(
  buckets: Readonly<Record<CompositionBucket, number>>,
  links: ReadonlyMap<CompositionBucket, number>,
): { byClass: Map<number, number>; unlinked: CompositionBucket[] } {
  const byClass = new Map<number, number>();
  const unlinked: CompositionBucket[] = [];
  for (const b of COMPOSITION_BUCKET_VALUES) {
    const v = buckets[b];
    const classId = links.get(b);
    if (classId === undefined) {
      if (v > HALF_CENT) unlinked.push(b);
      continue;
    }
    byClass.set(classId, (byClass.get(classId) ?? 0) + v);
  }
  return { byClass, unlinked };
}

/**
 * The household's holdings by fund instead of by account: each fund held
 * in several accounts appears once, with its combined shares and value,
 * its share of everything held, and which accounts hold how much. Largest
 * first. `holding` is the fund's first row (name, symbol, facts are the
 * fund's own, so any account's row carries them).
 */
export function combineHoldings<
  H extends { securityId: number; shares: number; value: number },
>(
  accounts: readonly { label: string; holdings: readonly H[] }[],
): {
  holding: H;
  shares: number;
  value: number;
  /** Of the value of everything held. */
  share: number;
  accounts: { label: string; value: number }[];
}[] {
  const byFund = new Map<
    number,
    {
      holding: H;
      shares: number;
      value: number;
      accounts: { label: string; value: number }[];
    }
  >();
  let total = 0;
  for (const a of accounts)
    for (const h of a.holdings) {
      total += h.value;
      const f = byFund.get(h.securityId) ?? {
        holding: h,
        shares: 0,
        value: 0,
        accounts: [],
      };
      f.shares += h.shares;
      f.value += h.value;
      f.accounts.push({ label: a.label, value: h.value });
      byFund.set(h.securityId, f);
    }
  return [...byFund.values()]
    .map((f) => ({
      ...f,
      share: total > 0 ? f.value / total : 0,
      accounts: [...f.accounts].sort((x, y) => y.value - x.value),
    }))
    .sort((x, y) => y.value - x.value);
}

/**
 * Which funds make up one composition bucket, and how much of it each
 * holds (value × the fund's known share in that bucket), largest first.
 * Funds holding none of it are left out.
 */
export function fundsInBucket<H extends ValuedHolding & { securityId: number }>(
  funds: readonly { holding: H; value: number }[],
  bucket: CompositionBucket,
): { holding: H; value: number; share: number }[] {
  const rows = funds
    .map((f) => {
      const c = f.holding.facts.composition;
      return {
        holding: f.holding,
        value: c ? f.value * c.coverage * c.buckets[bucket] : 0,
      };
    })
    .filter((r) => r.value > 0);
  const total = rows.reduce((t, r) => t + r.value, 0);
  return rows
    .map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 }))
    .sort((x, y) => y.value - x.value);
}
