/**
 * Turn classified investment transactions into suggested Performance and
 * Roth-basis entries. Pure; suggestions only — the household reviews every
 * figure before it's saved.
 *
 * Money flows map onto the Performance fields the way computeGainLoss reads
 * them: deposits are contributions, money out is distributions, fees are
 * fees, and moves between the household's own accounts are rollovers
 * (signed: in +, out −), never contributions. Feeds report a deposit as one
 * amount, so its employee/employer and Roth/pre-tax split is estimated from
 * the paycheck setup and labelled as such.
 *
 * What a saved fill already counted is kept as a ledger of transaction ids
 * (not a date), so rows that arrive late, settle later or get their kind
 * later are still offered, and a counted row whose kind changes is
 * corrected rather than counted twice.
 */
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";
import { roundToCents } from "@/lib/utils/math";

export type FlowRow = {
  id: number;
  posted: string;
  amount: number;
  kind: InvestmentTransactionKind;
  /** Set when this row is one side of a move between the household's own accounts. */
  transfer: { conversion: boolean } | null;
};

export type FlowTotals = {
  contributions: number;
  /** Money taken out, as a positive amount. */
  distributions: number;
  /** Fees, as a positive amount. */
  fees: number;
  /** Signed: money moved in from another of the household's accounts is +. */
  rollovers: number;
  /** Money moved out to another of the household's accounts, as a positive amount (part of `rollovers`). */
  transfersOut: number;
  /** Signed moves with no matching side found (marked by hand); part of `rollovers`. */
  unmatchedTransfers: number;
  /** Traditional → Roth conversions received (part of `rollovers`). */
  conversionsIn: number;
  /** Tax year of the latest conversion received, if any. */
  latestConversionYear: number | null;
  count: number;
};

/** Kinds that change a Performance or basis figure. */
const COUNTED_KINDS = new Set<InvestmentTransactionKind>([
  "contribution",
  "withdrawal",
  "fee",
  "transfer",
]);

/** How a row was counted — kind plus the conversion flag. */
export function countedAs(row: Pick<FlowRow, "kind" | "transfer">): string {
  return row.transfer?.conversion ? `${row.kind}:conversion` : row.kind;
}

function fromCountedAs(key: string): Pick<FlowRow, "kind" | "transfer"> {
  const [kind, flag] = key.split(":") as [InvestmentTransactionKind, string?];
  return {
    kind,
    transfer: flag === "conversion" ? { conversion: true } : null,
  };
}

const ZERO: FlowTotals = {
  contributions: 0,
  distributions: 0,
  fees: 0,
  rollovers: 0,
  transfersOut: 0,
  unmatchedTransfers: 0,
  conversionsIn: 0,
  latestConversionYear: null,
  count: 0,
};

function addRow(t: FlowTotals, r: FlowRow, sign: 1 | -1) {
  const amount = sign * r.amount;
  switch (r.kind) {
    case "contribution":
      t.contributions += amount;
      break;
    case "withdrawal":
      t.distributions -= amount;
      break;
    case "fee":
      t.fees -= amount;
      break;
    case "transfer":
      t.rollovers += amount;
      if (r.amount < 0) t.transfersOut -= amount;
      if (!r.transfer) t.unmatchedTransfers += amount;
      if (r.transfer?.conversion && r.amount > 0) {
        t.conversionsIn += amount;
        if (sign > 0)
          t.latestConversionYear = Math.max(
            t.latestConversionYear ?? 0,
            Number(r.posted.slice(0, 4)),
          );
      }
      break;
    default:
      return; // dividends, interest, trades… stay inside the account
  }
  t.count += sign;
}

function rounded(t: FlowTotals): FlowTotals {
  return {
    ...t,
    contributions: roundToCents(t.contributions),
    distributions: roundToCents(t.distributions),
    fees: roundToCents(t.fees),
    rollovers: roundToCents(t.rollovers),
    transfersOut: roundToCents(t.transfersOut),
    unmatchedTransfers: roundToCents(t.unmatchedTransfers),
    conversionsIn: roundToCents(t.conversionsIn),
  };
}

export function sumFlows(rows: readonly FlowRow[]): FlowTotals {
  const t = { ...ZERO };
  for (const r of rows) addRow(t, r, 1);
  return rounded(t);
}

/**
 * What changed since the last saved fill, for one row's feeds: rows after
 * the row's baseline not yet counted, plus counted rows whose kind changed
 * or that were voided since (taken back out as they were counted).
 * `rows` should include voided rows; pending ones wait until they settle.
 * Returns the net totals and the ledger entries to save with them.
 */
export function flowsSinceFill(
  rows: readonly (FlowRow & { pending: boolean; voided: boolean })[],
  counted: Readonly<Record<string, string>>,
  baseline: string,
): { totals: FlowTotals; counted: Record<string, string> } {
  const t = { ...ZERO };
  const next: Record<string, string> = {};
  for (const r of rows) {
    if (r.pending) continue;
    const was = counted[r.id];
    const now = r.voided || !COUNTED_KINDS.has(r.kind) ? null : countedAs(r);
    if (was === undefined || was === "removed") {
      if (now === null || r.posted <= baseline) continue;
      addRow(t, r, 1);
      next[r.id] = now;
    } else if (was !== now) {
      addRow(t, { ...r, ...fromCountedAs(was) }, -1);
      if (now !== null) addRow(t, r, 1);
      next[r.id] = now ?? "removed";
    }
  }
  return { totals: rounded(t), counted: next };
}

/** Annual amounts the paycheck setup sends to one tracked account. */
export type ContributionMix = {
  employeePreTax: number;
  employeeRoth: number;
  /** After-tax, HSA and anything else the employee puts in. */
  employeeOther: number;
  employer: number;
  /** The Roth part of `employer` (plans that match into Roth). */
  employerRoth: number;
};

export type ContributionSplit = {
  employee: number;
  employer: number;
  /** The employee's Roth part (Roth contribution basis). */
  employeeRoth: number;
  /** True when the split came from the paycheck setup rather than the feed. */
  estimated: boolean;
};

/**
 * Split deposits by the paycheck setup's proportions. With no setup (an IRA
 * or brokerage the household funds directly) everything is the employee's,
 * and Roth when the account itself is Roth. Deposits into a Roth account
 * with a setup are the employee's Roth money plus any employer Roth match —
 * only the employee's part is contribution basis.
 */
export function splitContributions(
  total: number,
  mix: ContributionMix | null,
  accountIsRoth: boolean,
): ContributionSplit {
  if (accountIsRoth) {
    const rothIn = mix ? mix.employeeRoth + mix.employerRoth : 0;
    if (!mix || rothIn <= 0 || mix.employerRoth <= 0)
      return {
        employee: total,
        employer: 0,
        employeeRoth: total,
        estimated: false,
      };
    const employer = roundToCents((total * mix.employerRoth) / rothIn);
    const employee = roundToCents(total - employer);
    return { employee, employer, employeeRoth: employee, estimated: true };
  }
  const employeeTotal = mix
    ? mix.employeePreTax + mix.employeeRoth + mix.employeeOther
    : 0;
  const all = mix ? employeeTotal + mix.employer : 0;
  if (!mix || all <= 0)
    return { employee: total, employer: 0, employeeRoth: 0, estimated: false };
  const employer = roundToCents((total * mix.employer) / all);
  const employee = roundToCents(total - employer);
  const employeeRoth =
    employeeTotal > 0
      ? roundToCents((employee * mix.employeeRoth) / employeeTotal)
      : 0;
  // A single-part setup splits nothing — the feed's figure stands as is.
  const parts = [
    mix.employeePreTax,
    mix.employeeRoth,
    mix.employeeOther,
    mix.employer,
  ].filter((v) => v > 0).length;
  return { employee, employer, employeeRoth, estimated: parts > 1 };
}

/**
 * Roth basis after money leaves the account. Under the IRS ordering rules
 * withdrawals come out of contributions first, then conversions — so both
 * are reduced in that order (never below zero). Conservative: earnings are
 * assumed untouched, so basis is never overstated.
 */
export function reduceBasis(
  basis: { contributionBasis: number; conversionBasis: number },
  outflow: number,
): { contributionBasis: number; conversionBasis: number } {
  if (outflow <= 0) return basis;
  const fromContributions = Math.min(basis.contributionBasis, outflow);
  const fromConversions = Math.min(
    basis.conversionBasis,
    outflow - fromContributions,
  );
  return {
    contributionBasis: roundToCents(
      basis.contributionBasis - fromContributions,
    ),
    conversionBasis: roundToCents(basis.conversionBasis - fromConversions),
  };
}

/** A SimpleFIN account linked to a tracked account. */
export type FeedAccount = {
  id: number;
  performanceAccountId: number;
  /** Null for a whole-account link. */
  subKey: string | null;
  /** From the sub-account link (null for a whole-account or joint link). */
  ownerPersonId: number | null;
  balance: number;
};

export type SubAccountRef = {
  key: string;
  performanceAccountId: number;
  ownerPersonId: number | null;
};

export type FeedAttribution = {
  /** "ambiguous": linked to the whole account, but the account is tracked per person. */
  status: "linked" | "none" | "ambiguous";
  feedIds: number[];
  /** The feeds' combined balance, when they cover every sub-account of the row. */
  balance: number | null;
};

/**
 * Which feeds belong to one tracked row — a Performance or basis row for
 * (tracked account, owner). An account tracked as a single row takes every
 * feed linked to it; one tracked per person takes the feeds linked to that
 * person's sub-accounts, and can't use a whole-account link (it can't tell
 * whose money a deposit was).
 */
export function attributeFeeds(
  row: { performanceAccountId: number; ownerPersonId: number | null },
  rowsOnAccount: number,
  feeds: readonly FeedAccount[],
  subs: readonly SubAccountRef[],
): FeedAttribution {
  const onAccount = feeds.filter(
    (f) => f.performanceAccountId === row.performanceAccountId,
  );
  const accountSubs = subs.filter(
    (s) => s.performanceAccountId === row.performanceAccountId,
  );
  const sum = (fs: readonly FeedAccount[]) =>
    roundToCents(fs.reduce((t, f) => t + f.balance, 0));
  const covers = (fs: readonly FeedAccount[], need: readonly SubAccountRef[]) =>
    need.length > 0 && need.every((s) => fs.some((f) => f.subKey === s.key));

  if (onAccount.length === 0)
    return { status: "none", feedIds: [], balance: null };
  if (rowsOnAccount <= 1) {
    const whole = onAccount.some((f) => f.subKey === null);
    return {
      status: "linked",
      feedIds: onAccount.map((f) => f.id),
      balance: whole || covers(onAccount, accountSubs) ? sum(onAccount) : null,
    };
  }
  if (onAccount.some((f) => f.subKey === null))
    return { status: "ambiguous", feedIds: [], balance: null };
  const mine = onAccount.filter((f) => f.ownerPersonId === row.ownerPersonId);
  if (mine.length === 0) return { status: "none", feedIds: [], balance: null };
  const need = accountSubs.filter((s) => s.ownerPersonId === row.ownerPersonId);
  return {
    status: "linked",
    feedIds: mine.map((f) => f.id),
    balance: covers(mine, need) ? sum(mine) : null,
  };
}

/**
 * The day a row's stored figures already run through, before any fill:
 * the prior year's end for a row with nothing entered yet (a fresh year),
 * otherwise the day it was last saved, kept inside the row's year.
 */
export function initialBaseline(
  year: number,
  savedOn: string | null,
  empty: boolean,
): string {
  const start = `${year - 1}-12-31`;
  const end = `${year}-12-31`;
  if (empty || !savedOn) return start;
  return savedOn < start ? start : savedOn > end ? end : savedOn;
}

/**
 * Contributions the paycheck setup should have sent between two days (after
 * `from`, through `to`), for an account with no feed. A pro-rated estimate —
 * pay dates and mid-year changes aren't modelled — so it's always labelled.
 */
export function estimateFromPaycheck(
  mix: ContributionMix,
  from: string,
  to: string,
): { employee: number; employer: number } {
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000;
  if (!(days > 0)) return { employee: 0, employer: 0 };
  const year = Number(to.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const share = days / (leap ? 366 : 365);
  return {
    employee: roundToCents(
      (mix.employeePreTax + mix.employeeRoth + mix.employeeOther) * share,
    ),
    employer: roundToCents(mix.employer * share),
  };
}
