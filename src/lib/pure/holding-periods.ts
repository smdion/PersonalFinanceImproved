/**
 * Dated holding periods — "held these funds, in these shares, from … to …"
 * per tracked account, or per part of an account whose feeds are linked per
 * part (accountSplits: e.g. a joint IRA with one feed per person and tax
 * type). Every other account — a 401(k) whose parts share one feed — has
 * one whole-account history.
 *
 * Observed periods are derived here from daily SimpleFIN holdings on read
 * (never stored — one source of truth): consecutive days holding the same
 * funds collapse into one period. Entered (user) and inferred periods are
 * stored (holding_periods) and validated here. Priority where they
 * overlap: observed → user → inferred.
 */
import { HOLDING_PERIODS } from "@/lib/config/benchmarks";
import { tradingDaysBetween } from "@/lib/pure/market-calendar";
import { sumBy } from "@/lib/utils/math";

export type PeriodBasis = "observed" | "user" | "inferred";

export type HoldingPeriod = {
  /** Stored periods only. */
  id: number | null;
  performanceAccountId: number;
  /** The part (snapshotAccountKey) of a split account; null = the whole account. */
  subKey: string | null;
  start: string;
  /** null = still held. */
  end: string | null;
  basis: PeriodBasis;
  /** securityId → share of the account (sums to 1). For an observed
   *  period, the shares on its first day — display only (they move with
   *  prices every day; the matched mix reads the daily observations). */
  weights: Record<number, number>;
};

/** One fund's value in an account on a day, from one feed (latest-day rule
 *  already applied, 0-share rows dropped). */
export type DailyPosition = {
  performanceAccountId: number;
  /** The feed's part (its linked_sub_key); null = a whole-account feed. */
  subKey: string | null;
  /** The SimpleFIN feed it came from — an account can have several. */
  feedId: number;
  day: string;
  securityId: number;
  value: number;
};

function weightsOf(
  positions: readonly DailyPosition[],
): Record<number, number> {
  const total = sumBy(positions, (p) => Math.max(0, p.value));
  const w: Record<number, number> = {};
  if (total <= 0) return w;
  for (const p of positions)
    w[p.securityId] = (w[p.securityId] ?? 0) + Math.max(0, p.value) / total;
  return w;
}

/** One holder of a history: an account, or one part of a split account. */
export const holderKey = (
  performanceAccountId: number,
  subKey: string | null,
) => `${performanceAccountId}|${subKey ?? ""}`;

/**
 * Holdings per day for each group of positions (ascending) — an account,
 * or one part of it. A group fed by several feeds that report on different
 * days gets, on each day, every feed's most recent holdings within the
 * allowed gap — so a day where only one feed reported isn't read as a
 * change of funds.
 */
function holdingsByDay<K>(
  positions: readonly DailyPosition[],
  groupOf: (p: DailyPosition) => K,
): Map<K, { day: string; positions: DailyPosition[] }[]> {
  // group → feed → day → positions
  const tree = new Map<K, Map<number, Map<string, DailyPosition[]>>>();
  for (const p of positions) {
    const g = groupOf(p);
    const feeds = tree.get(g) ?? new Map();
    const days = feeds.get(p.feedId) ?? new Map<string, DailyPosition[]>();
    const list = days.get(p.day);
    if (list) list.push(p);
    else days.set(p.day, [p]);
    feeds.set(p.feedId, days);
    tree.set(g, feeds);
  }
  const out = new Map<K, { day: string; positions: DailyPosition[] }[]>();
  for (const [group, feeds] of tree) {
    const allDays = [
      ...new Set([...feeds.values()].flatMap((d) => [...d.keys()])),
    ].sort();
    const feedDays = [...feeds].map(([, days]) => ({
      days,
      sorted: [...days.keys()].sort(),
      at: -1,
    }));
    const rows: { day: string; positions: DailyPosition[] }[] = [];
    for (const day of allDays) {
      const positionsToday: DailyPosition[] = [];
      for (const f of feedDays) {
        while (f.at + 1 < f.sorted.length && f.sorted[f.at + 1]! <= day) f.at++;
        if (f.at < 0) continue;
        const last = f.sorted[f.at]!;
        if (!withinObservedGap(last, day)) continue;
        positionsToday.push(...f.days.get(last)!);
      }
      rows.push({ day, positions: positionsToday });
    }
    out.set(group, rows);
  }
  return out;
}

/** `later` is close enough after `earlier` to count as the same run of
 *  daily data (HOLDING_PERIODS.observedMaxGapTradingDays). */
function withinObservedGap(earlier: string, later: string): boolean {
  return (
    tradingDaysBetween(earlier, later) <=
    HOLDING_PERIODS.observedMaxGapTradingDays + 1
  );
}

/** Each account's holdings per day across all its feeds (its parts
 *  pooled by value — the account's real mix). */
export function holdingsByAccountDay(
  positions: readonly DailyPosition[],
): Map<number, { day: string; positions: DailyPosition[] }[]> {
  return holdingsByDay(positions, (p) => p.performanceAccountId);
}

function toDailyWeights(rows: { day: string; positions: DailyPosition[] }[]) {
  return rows
    .map((r) => ({ day: r.day, weights: weightsOf(r.positions) }))
    .filter((d) => Object.keys(d.weights).length > 0);
}

/** Each account's fund weights per observed day (ascending) — what the
 *  matched mix reads in the observed window. */
export function dailyWeightsByAccount(
  positions: readonly DailyPosition[],
): Map<number, { day: string; weights: Record<number, number> }[]> {
  return new Map(
    [...holdingsByAccountDay(positions)].map(([id, rows]) => [
      id,
      toDailyWeights(rows),
    ]),
  );
}

/** The same per holder (holderKey) — each part of a split account on its
 *  own. */
export function dailyWeightsByHolder(
  positions: readonly DailyPosition[],
): Map<string, { day: string; weights: Record<number, number> }[]> {
  return new Map(
    [
      ...holdingsByDay(positions, (p) =>
        holderKey(p.performanceAccountId, p.subKey),
      ),
    ].map(([key, rows]) => [key, toDailyWeights(rows)]),
  );
}

function sameFunds(a: Record<number, number>, b: Record<number, number>) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b);
}

/**
 * Observed periods per holder — the account, or each part of an account
 * whose feeds are linked per part (a whole-account feed's subKey is null,
 * so an account with one feed for all its parts has one history). A new
 * period starts when the set of funds changes or the daily data skips more
 * trading days than allowed (shares move with prices every day, so they
 * never split a period). The last period stays open (still held) while it
 * reaches the account's latest feed day, within the same allowed gap (a
 * part's feed a day behind the others isn't closed); a closed or unlinked
 * feed's last period ends on its last day, so it can't mask entered
 * history forever.
 */
export function deriveObservedPeriods(
  positions: readonly DailyPosition[],
  /** Each account's latest day of holdings data from its feeds. */
  latestFeedDay: ReadonlyMap<number, string>,
): HoldingPeriod[] {
  const out: HoldingPeriod[] = [];
  const groups = holdingsByDay(positions, (p) =>
    holderKey(p.performanceAccountId, p.subKey),
  );
  for (const rows of groups.values()) {
    const first = rows.find((r) => r.positions.length > 0)?.positions[0];
    if (!first) continue;
    const { performanceAccountId: accountId, subKey } = first;
    let open: HoldingPeriod | null = null;
    let lastDay: string | null = null;
    for (const { day, positions: today } of rows) {
      const w = weightsOf(today);
      if (Object.keys(w).length === 0) continue;
      const gap = lastDay !== null && !withinObservedGap(lastDay, day);
      if (open && (gap || !sameFunds(open.weights, w))) {
        open.end = lastDay;
        out.push(open);
        open = null;
      }
      if (!open)
        open = {
          id: null,
          performanceAccountId: accountId,
          subKey,
          start: day,
          end: null,
          basis: "observed",
          weights: w,
        };
      lastDay = day;
    }
    if (open) {
      const latest = latestFeedDay.get(accountId);
      if (latest === undefined || !withinObservedGap(lastDay!, latest))
        open.end = lastDay;
      out.push(open);
    }
  }
  return out;
}

/**
 * Which accounts' history is kept per part: one with a counted feed linked
 * to a part, or with stored part periods while no whole-account feed
 * replaced them (sticky — unlinking or unchecking a part feed doesn't
 * orphan entered history). An account with both part and whole-account
 * feeds is a conflict, shown to the household and never resolved
 * silently. Accounts not in the map keep one whole-account history.
 */
export function accountSplits(
  feeds: readonly { performanceAccountId: number; subKey: string | null }[],
  storedPeriods: readonly {
    performanceAccountId: number;
    subKey: string | null;
  }[],
): Map<number, { conflict: boolean }> {
  const flags = new Map<
    number,
    { partFeed: boolean; wholeFeed: boolean; partPeriod: boolean }
  >();
  const at = (id: number) => {
    const f = flags.get(id) ?? {
      partFeed: false,
      wholeFeed: false,
      partPeriod: false,
    };
    flags.set(id, f);
    return f;
  };
  for (const f of feeds)
    if (f.subKey) at(f.performanceAccountId).partFeed = true;
    else at(f.performanceAccountId).wholeFeed = true;
  for (const p of storedPeriods)
    if (p.subKey) at(p.performanceAccountId).partPeriod = true;
  const out = new Map<number, { conflict: boolean }>();
  for (const [id, f] of flags)
    if (f.partFeed || (f.partPeriod && !f.wholeFeed))
      out.set(id, { conflict: f.partFeed && f.wholeFeed });
  return out;
}

/** A part key (snapshotAccountKey) names a part of this account. A feed
 *  link that doesn't (or is empty) is treated as a whole-account link. */
export function partKeyOf(
  performanceAccountId: number,
  subKey: string | null | undefined,
): string | null {
  return subKey && subKey.startsWith(`${performanceAccountId}_`)
    ? subKey
    : null;
}

/**
 * A stored or observed period no holder takes: its part is gone, or it no
 * longer fits how the account's feeds are linked — including an entered
 * whole-account period on an account now kept per part (a conflict
 * account's whole holder shows only its feed's observed history). Shown to
 * be moved or deleted; never counted.
 */
export function isOrphaned(
  p: {
    performanceAccountId: number;
    subKey: string | null;
    basis: PeriodBasis;
  },
  held: ReadonlySet<string>,
  splits: ReadonlyMap<number, unknown>,
): boolean {
  if (!held.has(holderKey(p.performanceAccountId, p.subKey))) return true;
  return (
    p.basis !== "observed" &&
    p.subKey === null &&
    splits.has(p.performanceAccountId)
  );
}

/**
 * The holders an account's history is kept for: the whole account, or each
 * of its parts when it's split (plus the whole account when it's in
 * conflict, so its whole-account feed's history still shows). A stored
 * period with no holder here is orphaned — shown to be moved or deleted,
 * never counted.
 */
export function historyHolders(
  accountIds: readonly number[],
  splits: ReadonlyMap<number, { conflict: boolean }>,
  /** Split account → every part it has had (snapshots + feed links). */
  parts: ReadonlyMap<number, readonly string[]>,
): { performanceAccountId: number; subKey: string | null }[] {
  return accountIds.flatMap((id) => {
    const split = splits.get(id);
    if (!split) return [{ performanceAccountId: id, subKey: null }];
    return [
      ...(parts.get(id) ?? []).map((subKey) => ({
        performanceAccountId: id,
        subKey,
      })),
      ...(split.conflict ? [{ performanceAccountId: id, subKey: null }] : []),
    ];
  });
}

/** One account's parts in one snapshot: part key → amount. */
export type SnapshotParts = {
  date: string;
  amounts: ReadonlyMap<string, number>;
};

/**
 * Each part's share of an account on a day: from the latest snapshot on or
 * before it (before the first snapshot, the earliest one's — older years
 * are approximate). A part not in that snapshot has 0. Empty when there is
 * no snapshot or no money.
 */
export function partSharesOn(
  /** The account's snapshots, ascending by date. */
  snapshots: readonly SnapshotParts[],
  day: string,
): Map<string, number> {
  let pick: SnapshotParts | undefined = snapshots[0];
  for (const snap of snapshots) if (snap.date <= day) pick = snap;
  const out = new Map<string, number>();
  if (!pick) return out;
  const total = sumBy([...pick.amounts.values()], (v) => Math.max(0, v));
  if (total <= 0) return out;
  for (const [key, v] of pick.amounts) if (v > 0) out.set(key, v / total);
  return out;
}

export type PeriodProblem =
  | "weightsDontSum"
  | "badWeight"
  | "endBeforeStart"
  | "overlapsEntered"
  | "noFunds"
  | "duplicateFund";

/** Problems with an entered period, against the account's other periods
 *  of the same basis (an inferred proposal never blocks a user entry). */
export function validateHoldingPeriod(
  period: {
    id: number | null;
    start: string;
    end: string | null;
    weights: readonly { securityId: number; weight: number }[];
  },
  others: readonly { id: number | null; start: string; end: string | null }[],
): PeriodProblem[] {
  const problems: PeriodProblem[] = [];
  if (period.weights.length === 0) problems.push("noFunds");
  if (
    new Set(period.weights.map((w) => w.securityId)).size !==
    period.weights.length
  )
    problems.push("duplicateFund");
  if (period.weights.some((w) => !(w.weight > 0 && w.weight <= 1)))
    problems.push("badWeight");
  const sum = sumBy(period.weights, (w) => w.weight);
  if (
    period.weights.length > 0 &&
    Math.abs(sum - 1) > HOLDING_PERIODS.weightSumTolerance
  )
    problems.push("weightsDontSum");
  if (period.end !== null && period.end < period.start)
    problems.push("endBeforeStart");
  const endOf = (e: string | null) => e ?? "9999-12-31";
  if (
    others.some(
      (o) =>
        o.id !== period.id &&
        o.start <= endOf(period.end) &&
        period.start <= endOf(o.end),
    )
  )
    problems.push("overlapsEntered");
  return problems;
}

/**
 * The period that applies to a holder (an account, or one part of a split
 * account) on a day, by priority: observed, then user-entered, then
 * inferred. null = not covered.
 */
export function periodOn(
  periods: readonly HoldingPeriod[],
  performanceAccountId: number,
  subKey: string | null,
  day: string,
): HoldingPeriod | null {
  const rank: Record<PeriodBasis, number> = {
    observed: 0,
    user: 1,
    inferred: 2,
  };
  return (
    periods
      .filter(
        (p) =>
          p.performanceAccountId === performanceAccountId &&
          p.subKey === subKey &&
          p.start <= day &&
          (p.end === null || day <= p.end),
      )
      .sort((a, b) => rank[a.basis] - rank[b.basis])[0] ?? null
  );
}
