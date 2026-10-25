/**
 * Reconciliation checks for Performance account rows — figures that don't
 * fit together, found from the rows themselves and the year's last
 * snapshot. Informational: each names a gap and what usually causes it.
 * Some gaps are legitimate (a provider's gain entered on purpose, money from
 * an account that isn't tracked); the household can accept one with a
 * reason, and it stays quiet only while the gap is the one accepted.
 *
 * Rows are matched by account + person (an account held in parts is checked
 * per part, never pooled). Run over the same rows the rollups sum, inactive
 * ones included.
 */
import {
  PERF_CHECK_ROUNDING,
  PERF_YEAR_END_SNAPSHOT_DAYS,
} from "@/lib/constants";
import { computeGainLoss } from "@/lib/pure/performance";
import { roundToCents } from "@/lib/utils/math";

export const PERF_CHECK_KINDS = [
  "unbalanced",
  "chain",
  "transfers",
  "snapshot",
] as const;
export type PerfCheckKind = (typeof PERF_CHECK_KINDS)[number];

type CheckBase = {
  /** The gap, in dollars (rounded to cents). */
  amount: number;
  /** The household accepted this gap (same amount, to the cent). */
  accepted: boolean;
};

export type PerfCheck = CheckBase &
  (
    | /** what the row's own figures leave unexplained (computeGainLoss − gain) */
      { kind: "unbalanced" }
      /** beginning − the same account's (part's) ending the year before */
    | { kind: "chain"; previousYear: number; previousEnding: number }
    /** what the year's open rollovers across tracked accounts net to */
    | { kind: "transfers" }
    /** ending − the year's last snapshot balance for the account (part) */
    | { kind: "snapshot"; snapshotDate: string; snapshotBalance: number }
  );

/** A check before it's matched against what the household accepted. */
type FoundCheck = PerfCheck extends infer C
  ? C extends PerfCheck
    ? Omit<C, "accepted">
    : never
  : never;

export type CheckRow = {
  id: number;
  year: number;
  performanceAccountId: number | null;
  ownerPersonId: number | null;
  beginningBalance: number;
  totalContributions: number;
  yearlyGainLoss: number;
  endingBalance: number;
  distributions: number;
  fees: number;
  rollovers: number;
  /** Accepted gaps by kind. For `transfers` the amount is this row's own
   *  rollover: "this one has no tracked other side". */
  accepted?: Partial<Record<PerfCheckKind, number>>;
};

/** A year's last snapshot: balances per account and per (account, person). */
export type YearEndSnapshot = {
  year: number;
  date: string;
  byAccount: Map<number, number>;
  byAccountOwner: Map<string, number>;
};

export const ownerKey = (
  performanceAccountId: number,
  ownerPersonId: number | null,
) => `${performanceAccountId}|${ownerPersonId ?? ""}`;

const cents = roundToCents;
const isGap = (n: number) =>
  Math.abs(cents(n)) > PERF_CHECK_ROUNDING + Number.EPSILON;
const sameCents = (a: number | undefined, b: number) =>
  a !== undefined && Math.round(a * 100) === Math.round(b * 100);

export function performanceChecks(
  rows: CheckRow[],
  snapshots: YearEndSnapshot[],
): Map<number, PerfCheck[]> {
  const out = new Map<number, PerfCheck[]>();
  const add = (r: CheckRow, check: FoundCheck) => {
    const amountAccepted =
      check.kind === "transfers" ? r.rollovers : check.amount;
    const c = {
      ...check,
      accepted: sameCents(r.accepted?.[check.kind], amountAccepted),
    } as PerfCheck;
    out.set(r.id, [...(out.get(r.id) ?? []), c]);
  };

  // Rows per account-year (more than one: held in parts) and per
  // account-person-year (more than one: duplicates — nothing to compare).
  const count = new Map<string, number>();
  const byPart = new Map<string, CheckRow>();
  for (const r of rows) {
    if (r.performanceAccountId == null) continue;
    const acct = `${r.performanceAccountId}|${r.year}`;
    const part = `${ownerKey(r.performanceAccountId, r.ownerPersonId)}|${r.year}`;
    count.set(acct, (count.get(acct) ?? 0) + 1);
    count.set(part, (count.get(part) ?? 0) + 1);
    byPart.set(part, r);
  }
  const inParts = (perf: number, year: number) =>
    (count.get(`${perf}|${year}`) ?? 0) > 1;
  /** The single comparable row for this account (part) in `year`. */
  const counterpart = (r: CheckRow, year: number): CheckRow | null => {
    const perf = r.performanceAccountId!;
    if (inParts(perf, r.year) !== inParts(perf, year)) return null;
    const part = `${ownerKey(perf, r.ownerPersonId)}|${year}`;
    return count.get(part) === 1 ? (byPart.get(part) ?? null) : null;
  };

  // The latest year's snapshot is its current balance; an earlier year's
  // last snapshot speaks for its ending only if taken at year end.
  const latestYear = Math.max(...snapshots.map((s) => s.year));
  const atYearEnd = (s: YearEndSnapshot) =>
    s.year === latestYear ||
    s.date >=
      `${s.year}-12-${String(31 - PERF_YEAR_END_SNAPSHOT_DAYS).padStart(2, "0")}`;
  const snapshotFor = new Map(
    snapshots.filter(atYearEnd).map((s) => [s.year, s]),
  );
  // Transfers net over the rollovers nobody has accepted as one-sided.
  const openNet = new Map<number, number>();
  const isOpenTransfer = (r: CheckRow) =>
    isGap(r.rollovers) && !sameCents(r.accepted?.transfers, r.rollovers);
  for (const r of rows)
    if (isOpenTransfer(r))
      openNet.set(r.year, (openNet.get(r.year) ?? 0) + r.rollovers);

  for (const r of rows) {
    const gap = computeGainLoss(r) - r.yearlyGainLoss;
    if (isGap(gap)) add(r, { kind: "unbalanced", amount: cents(gap) });

    if (r.performanceAccountId != null) {
      const prev = counterpart(r, r.year - 1);
      if (prev && isGap(r.beginningBalance - prev.endingBalance))
        add(r, {
          kind: "chain",
          amount: cents(r.beginningBalance - prev.endingBalance),
          previousYear: r.year - 1,
          previousEnding: cents(prev.endingBalance),
        });

      const snap = snapshotFor.get(r.year);
      const own = `${ownerKey(r.performanceAccountId, r.ownerPersonId)}|${r.year}`;
      const snapBal =
        !snap || count.get(own) !== 1
          ? undefined
          : inParts(r.performanceAccountId, r.year)
            ? snap.byAccountOwner.get(
                ownerKey(r.performanceAccountId, r.ownerPersonId),
              )
            : snap.byAccount.get(r.performanceAccountId);
      if (snap && snapBal !== undefined && isGap(r.endingBalance - snapBal))
        add(r, {
          kind: "snapshot",
          amount: cents(r.endingBalance - snapBal),
          snapshotDate: snap.date,
          snapshotBalance: cents(snapBal),
        });
    }

    if (isGap(r.rollovers)) {
      const net = openNet.get(r.year) ?? 0;
      if (!isOpenTransfer(r) || isGap(net))
        add(r, {
          kind: "transfers",
          amount: cents(isOpenTransfer(r) ? net : r.rollovers),
        });
    }
  }
  return out;
}
