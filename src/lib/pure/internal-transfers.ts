/**
 * Money moving between the household's own accounts — an IRA conversion
 * (Traditional → Roth), a rollover, a transfer between brokerages — shows
 * up as a withdrawal from one linked account and an equal deposit into
 * another. Neither side is money added to or taken out of the household,
 * so both are re-labelled "transfer". Pure; generic over any accounts.
 *
 * Matching: opposite, equal amounts (to the cent) in two different linked
 * accounts within a few days. When several deposits could match one
 * withdrawal (two people converting the same amount), the pair within one
 * owner wins, then within one tracked account, then the closest date.
 */
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { isPreTaxType, isTaxFreeBucket } from "@/lib/config/account-types";

export type TransferCandidate = {
  id: number;
  simplefinAccountId: number;
  /** Tracked account the SimpleFIN account is linked to; unlinked rows never match. */
  performanceAccountId: number | null;
  /** From a sub-account link, when there is one. */
  ownerPersonId: number | null;
  taxType: PortfolioTaxType | null;
  posted: string;
  amount: number;
  kind: string;
};

export type TransferMatch = {
  pairId: number;
  /** Traditional (pre-tax) → Roth: a conversion, which adds Roth conversion basis. */
  conversion: boolean;
};

const MAX_DAYS = 5;
const DAY_MS = 86_400_000;

export function matchInternalTransfers(
  rows: readonly TransferCandidate[],
): Map<number, TransferMatch> {
  const outs = rows.filter(
    (r) =>
      r.kind === "withdrawal" &&
      r.amount < 0 &&
      r.performanceAccountId !== null,
  );
  const ins = rows.filter(
    (r) =>
      r.kind === "contribution" &&
      r.amount > 0 &&
      r.performanceAccountId !== null,
  );
  type Pair = { out: TransferCandidate; in: TransferCandidate; score: number };
  const pairs: Pair[] = [];
  for (const o of outs)
    for (const i of ins) {
      if (o.simplefinAccountId === i.simplefinAccountId) continue;
      if (Math.round((o.amount + i.amount) * 100) !== 0) continue;
      const days =
        Math.abs(Date.parse(o.posted) - Date.parse(i.posted)) / DAY_MS;
      if (days > MAX_DAYS) continue;
      const sameOwner =
        o.ownerPersonId !== null && o.ownerPersonId === i.ownerPersonId;
      const sameAccount = o.performanceAccountId === i.performanceAccountId;
      // Lower is better: owner match dominates, then account, then days.
      pairs.push({
        out: o,
        in: i,
        score: (sameOwner ? 0 : 100) + (sameAccount ? 0 : 10) + days,
      });
    }
  pairs.sort(
    (a, b) => a.score - b.score || a.out.id - b.out.id || a.in.id - b.in.id,
  );
  const result = new Map<number, TransferMatch>();
  for (const p of pairs) {
    if (result.has(p.out.id) || result.has(p.in.id)) continue;
    const conversion =
      p.out.taxType !== null &&
      p.in.taxType !== null &&
      isPreTaxType(p.out.taxType) &&
      isTaxFreeBucket(p.in.taxType);
    result.set(p.out.id, { pairId: p.in.id, conversion });
    result.set(p.in.id, { pairId: p.out.id, conversion });
  }
  return result;
}

/**
 * Deposits that are probably money the household already recorded as
 * moved in: a deposit into a tracked account whose Performance figures for
 * that year record money rolled in from another tracked account
 * (`recordedMoveIn` names it) — e.g. an emptied ESPP whose proceeds went
 * to a brokerage, entered by hand under Rollovers. A Fill from SimpleFIN
 * leaves these out (counting them as contributions too would count the
 * money twice) and says so. Rows already matched or set by hand are left
 * alone.
 */
export function recordedMoveDeposits(
  rows: readonly {
    id: number;
    /** Tracked account it counts toward (null when not counted). */
    performanceAccountId: number | null;
    posted: string;
    amount: number;
    kind: string;
    /** Already matched, or kind set by hand / locked. */
    settled: boolean;
  }[],
  recordedMoveIn: (performanceAccountId: number, year: number) => string | null,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of rows) {
    if (
      r.settled ||
      r.kind !== "contribution" ||
      r.amount <= 0 ||
      r.performanceAccountId === null
    )
      continue;
    const from = recordedMoveIn(
      r.performanceAccountId,
      Number(r.posted.slice(0, 4)),
    );
    if (from) out.set(r.id, from);
  }
  return out;
}
