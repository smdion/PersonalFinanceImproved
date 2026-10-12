/**
 * One suggestion per row for the three fills — a new portfolio snapshot,
 * the year's Performance rows, and the year's Roth-basis rows — from what
 * SimpleFIN sent since each row was last filled. Pure: the router loads the
 * rows, feeds, paycheck setup and fill ledger and calls these per row.
 * The flow arithmetic itself lives in flow-suggestions.ts.
 */
import { roundToCents } from "@/lib/utils/math";
import { HALF_CENT } from "@/lib/constants";
import { addDays } from "@/lib/utils/date";
import {
  attributeFeeds,
  estimateFromPaycheck,
  flowsSinceFill,
  initialBaseline,
  reduceBasis,
  splitContributions,
  type ContributionMix,
  type FeedAccount,
  type FlowRow,
  type SubAccountRef,
} from "./flow-suggestions";
import { sentTransactions } from "./simplefin-feeds";
import type { NewMoney } from "./snapshot-suggestions";

/** A classified transaction as the fills read it. */
export type FillRow = FlowRow & {
  simplefinAccountId: number;
  pending: boolean;
  voided: boolean;
  uncertain: boolean;
  /** Probably money already recorded (in Performance) as moved in from this account. */
  recordedMoveFrom: string | null;
};

/** What the fill ledger kept for one year of one fill (see server/helpers/fill-ledger.ts). */
export type FillLedger = {
  baselines: Readonly<Record<number, string>>;
  counted: Readonly<Record<string, string>>;
  estimatedThrough?: Readonly<Record<number, string>>;
};

/**
 * Deposits that are probably money the household already recorded (in
 * Performance) as moved in from another account count for nothing in a
 * fill — kind "other", so one counted by an earlier fill is taken back out.
 */
export function withoutRecordedMoves<
  R extends { recordedMoveFrom: string | null; kind: string },
>(rows: readonly R[]): R[] {
  return rows.map((r) =>
    r.recordedMoveFrom ? { ...r, kind: "other" as const } : r,
  );
}

/** What a fill leaves out as already-recorded moves, after `after`. */
export function recordedMovesSince(
  rows: readonly FillRow[],
  after: string,
): { amount: number; from: string } | null {
  const left = rows.filter(
    (r) => r.recordedMoveFrom && r.posted > after && !r.pending && !r.voided,
  );
  return left.length === 0
    ? null
    : {
        amount: roundToCents(left.reduce((t, r) => t + r.amount, 0)),
        from: left[0]!.recordedMoveFrom!,
      };
}

/** First day SimpleFIN transactions reach, when that's after `baseline`'s next day. */
export function gapAfter(coverageStart: string | null, baseline: string) {
  return coverageStart === null || coverageStart > addDays(baseline, 1)
    ? coverageStart
    : null;
}

/** How many rows each tracked account has (one per person, or one in all). */
export function rowsPerAccount(
  rows: readonly { performanceAccountId: number }[],
): Map<number, number> {
  const n = new Map<number, number>();
  for (const r of rows)
    n.set(r.performanceAccountId, (n.get(r.performanceAccountId) ?? 0) + 1);
  return n;
}

/**
 * Contributions since the snapshot into one account's whole-account feeds,
 * split by the paycheck setup — or estimated from it when the feeds send
 * only a balance. Null when there's nothing to place (no setup, no
 * snapshot, or the snapshot is too old for this year's setup to say).
 */
export function snapshotNewMoney(a: {
  mix: ContributionMix | undefined;
  snapshotDate: string | null;
  snapshotTooOld: boolean;
  /** The account's whole-account feeds. */
  feeds: readonly { id: number; balanceDay: string | null }[];
  /** Feeds that sent a transaction recently. */
  sendsTransactions: boolean;
  /** Settled contributions after the snapshot, all feeds. */
  contributions: readonly FillRow[];
  today: string;
}): NewMoney | null {
  const m = a.mix;
  if (!m || !a.snapshotDate || a.snapshotTooOld) return null;
  const all = m.employeePreTax + m.employeeRoth + m.employeeOther + m.employer;
  if (all <= 0) return null;
  const ids = a.feeds.map((f) => f.id);
  // Only money the reported balance already includes.
  const asOf = a.feeds.map((f) => f.balanceDay ?? a.today).sort()[0] ?? a.today;
  const balanceOnly = !a.sendsTransactions;
  // Deposits on the snapshot day itself are taken to be in the snapshot.
  const total = balanceOnly
    ? (() => {
        const e = estimateFromPaycheck(m, a.snapshotDate, asOf);
        return e.employee + e.employer;
      })()
    : a.contributions
        .filter((r) => ids.includes(r.simplefinAccountId) && r.posted <= asOf)
        .reduce((t, r) => t + r.amount, 0);
  const part = (v: number) => (total * v) / all;
  return {
    employeeRoth: part(m.employeeRoth),
    employeePreTax: part(m.employeePreTax),
    employeeOther: part(m.employeeOther),
    employer: part(m.employer),
    employerRoth: part(m.employerRoth),
    estimated: balanceOnly,
  };
}

/** A Performance row's stored figures (numbers). */
export type StoredPerformanceRow = {
  id: number;
  performanceAccountId: number;
  ownerPersonId: number | null;
  totalContributions: number;
  employerContributions: number;
  distributions: number;
  fees: number;
  rollovers: number;
};

/** One Performance row's suggestion: what's new since its last fill, added onto the stored figures. */
export function suggestPerformanceRow(
  r: StoredPerformanceRow,
  c: {
    year: number;
    /** When Performance was last saved (UTC day), if ever. */
    stamped: string | null;
    rowsOnAccount: number;
    feeds: readonly FeedAccount[];
    subs: readonly SubAccountRef[];
    lastTransactionDay: ReadonlyMap<number, string>;
    accountMix: ContributionMix | null;
    ledger: FillLedger;
    flows: readonly FillRow[];
    coverageStart: string | null;
    today: string;
  },
) {
  const empty = [
    r.totalContributions,
    r.distributions,
    r.fees,
    r.rollovers,
  ].every((v) => v === 0);
  const baseline =
    c.ledger.baselines[r.id] ?? initialBaseline(c.year, c.stamped, empty);
  const feed = attributeFeeds(r, c.rowsOnAccount, c.feeds, c.subs);
  // Days an earlier paycheck estimate covered aren't counted again.
  const estimatedThrough = c.ledger.estimatedThrough?.[r.id];
  const countFrom =
    estimatedThrough && estimatedThrough > baseline
      ? estimatedThrough
      : baseline;
  const mine = c.flows.filter((f) =>
    feed.feedIds.includes(f.simplefinAccountId),
  );
  const { totals: t, counted } = flowsSinceFill(
    withoutRecordedMoves(mine),
    c.ledger.counted,
    countFrom,
  );
  const split = splitContributions(t.contributions, c.accountMix, false);
  // Linked, but the institution has never sent a transaction.
  const balanceOnly =
    feed.status === "linked" &&
    !sentTransactions(feed.feedIds, c.lastTransactionDay);
  // No feed (or a balance-only one): what the paycheck setup should have sent instead.
  const yearEnd = `${c.year}-12-31`;
  const estimateTo = c.today < yearEnd ? c.today : yearEnd;
  const estimate =
    (feed.status === "none" || balanceOnly) && c.accountMix
      ? {
          ...estimateFromPaycheck(c.accountMix, countFrom, estimateTo),
          through: estimateTo,
        }
      : null;
  if (estimate && estimate.employee + estimate.employer === 0)
    estimate.through = countFrom;
  if (estimate) {
    split.employee += estimate.employee;
    split.employer += estimate.employer;
  }
  const storedEmployee = r.totalContributions - r.employerContributions;
  return {
    accountPerformanceId: r.id,
    performanceAccountId: r.performanceAccountId,
    feed: feed.status,
    /** Linked, but the institution sends only a balance. */
    balanceOnly,
    baseline,
    /** New money is counted after this day. */
    since: countFrom,
    missingBefore: estimate ? null : gapAfter(c.coverageStart, countFrom),
    added: { ...t, ...split },
    estimate,
    /** Deposits left out as money already recorded as moved in. */
    leftOut: recordedMovesSince(mine, countFrom),
    uncertainCount: mine.filter(
      (f) => f.uncertain && !f.voided && f.posted > baseline,
    ).length,
    suggested: {
      employeeContrib: roundToCents(storedEmployee + split.employee),
      employerContributions: roundToCents(
        r.employerContributions + split.employer,
      ),
      distributions: roundToCents(r.distributions + t.distributions),
      rollovers: roundToCents(r.rollovers + t.rollovers),
      fees: roundToCents(r.fees + t.fees),
      endingBalance: feed.balance,
    },
    counted,
  };
}

/** A Roth-basis row's stored figures (numbers). */
export type StoredBasisRow = {
  id: number;
  performanceAccountId: number;
  ownerPersonId: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  /** Carried forward at year end. */
  isSeeded: boolean;
  /** UTC day it was last saved. */
  updatedDay: string;
  /** Same account and owner's row last year, if any. */
  prior: { contributionBasis: number; conversionBasis: number } | null;
};

/**
 * One Roth-basis row's suggestion: Roth contributions and conversions no
 * saved fill has counted, added onto the stored figures; money out of an
 * all-Roth feed reduces them (contributions first, then conversions).
 */
export function suggestBasisRow(
  r: StoredBasisRow,
  c: {
    year: number;
    rowsOnAccount: number;
    feeds: readonly FeedAccount[];
    subs: readonly (SubAccountRef & { taxType: string | null })[];
    accountMix: ContributionMix | null;
    ledger: FillLedger;
    flows: readonly FillRow[];
    coverageStart: string | null;
    /** Whether a tax type is a tax-free (Roth) bucket. */
    isRothTaxType: (taxType: string) => boolean;
  },
) {
  // A row carried forward at year end — or saved later but still holding
  // last year's figures — hasn't seen this year's money.
  const sameAsLastYear =
    r.prior !== null &&
    Math.abs(r.prior.contributionBasis - r.contributionBasis) < HALF_CENT &&
    Math.abs(r.prior.conversionBasis - r.conversionBasis) < HALF_CENT;
  const baseline =
    c.ledger.baselines[r.id] ??
    initialBaseline(c.year, r.updatedDay, r.isSeeded || sameAsLastYear);
  const feed = attributeFeeds(r, c.rowsOnAccount, c.feeds, c.subs);
  const isRoth = (key: string | null) => {
    const accountSubs = c.subs.filter(
      (s) => s.performanceAccountId === r.performanceAccountId,
    );
    const relevant = key
      ? accountSubs.filter((s) => s.key === key)
      : accountSubs;
    return (
      relevant.length > 0 &&
      relevant.every((s) => s.taxType !== null && c.isRothTaxType(s.taxType))
    );
  };
  let roth = 0;
  let conversions = 0;
  let outflow = 0;
  let estimated = false;
  let latestConversionYear = r.latestConversionYear;
  let count = 0;
  const counted: Record<string, string> = {};
  const leftOut: { amount: number; from: string | null } = {
    amount: 0,
    from: null,
  };
  for (const id of feed.feedIds) {
    const f = c.feeds.find((x) => x.id === id)!;
    const accountIsRoth = isRoth(f.subKey);
    const feedRows = c.flows.filter((x) => x.simplefinAccountId === id);
    const { totals: t, counted: got } = flowsSinceFill(
      withoutRecordedMoves(feedRows),
      c.ledger.counted,
      baseline,
    );
    const out = recordedMovesSince(feedRows, baseline);
    if (out) {
      leftOut.amount += out.amount;
      leftOut.from ??= out.from;
    }
    Object.assign(counted, got);
    const split = splitContributions(
      t.contributions,
      c.accountMix,
      accountIsRoth,
    );
    roth += split.employeeRoth;
    estimated ||= split.estimated && split.employeeRoth !== 0;
    conversions += t.conversionsIn;
    // Money leaving a mixed (Roth + pre-tax) account can't be pinned to the
    // Roth part, so only all-Roth feeds reduce basis.
    if (accountIsRoth) outflow += t.distributions + t.transfersOut;
    if (t.latestConversionYear !== null)
      latestConversionYear = Math.max(
        latestConversionYear ?? 0,
        t.latestConversionYear,
      );
    count += t.count;
  }
  const reduced = reduceBasis(
    {
      contributionBasis: r.contributionBasis + roth,
      conversionBasis: r.conversionBasis + conversions,
    },
    outflow,
  );
  return {
    accountBasisId: r.id,
    performanceAccountId: r.performanceAccountId,
    ownerPersonId: r.ownerPersonId,
    baseline,
    missingBefore: gapAfter(c.coverageStart, baseline),
    /** Deposits left out as money already recorded as moved in. */
    leftOut:
      leftOut.amount !== 0 && leftOut.from
        ? { amount: roundToCents(leftOut.amount), from: leftOut.from }
        : null,
    feed: feed.status,
    added: {
      contributions: roundToCents(roth),
      conversions: roundToCents(conversions),
      outflow: roundToCents(outflow),
      estimated,
      count,
    },
    suggested: {
      ...reduced,
      latestConversionYear:
        reduced.conversionBasis > 0 ? latestConversionYear : null,
    },
    counted,
  };
}
