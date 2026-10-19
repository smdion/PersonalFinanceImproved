/**
 * Taxable investment income for the year (dividends, interest, capital-gain
 * distributions) from classified SimpleFIN transactions — part of the AGI /
 * Roth IRA MAGI estimate.
 *
 * Only accounts whose type is taxable count — from the account-type config
 * (`taxBucketKey === "afterTax"`, i.e. brokerage), never the account's
 * Retirement/Portfolio tag: IRA/401k/HSA income isn't taxed in the year.
 *
 * Dividends are lumpy and capital-gain distributions land in December, so
 * plain annualizing is unsound. Each feed's estimate is this year's income
 * so far plus last year's income for the rest of the year (same calendar
 * window); only when that feed's stored history doesn't reach last year's
 * same date is its covered stretch of this year annualized instead (which
 * misses a December distribution — the basis says so). Coverage is per
 * feed: a feed added later has no history before it was first synced.
 * Pure — no DB.
 */
import {
  getAccountTypeConfig,
  getAllCategories,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import {
  INVESTMENT_INCOME_KINDS,
  type InvestmentTransactionKind,
} from "@/lib/config/enum-values";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { addDays } from "@/lib/utils/date";

export type IncomeTransaction = {
  feedId: number;
  posted: string; // YYYY-MM-DD
  kind: InvestmentTransactionKind;
  amount: number;
  pending: boolean;
  voided: boolean;
};

export type InvestmentIncomeBasis =
  /** The whole tax year is in the past and covered. */
  | "actual"
  /** This year so far + last year's rest-of-year. */
  | "ytdPlusLastYear"
  /** This year's covered stretch, annualized (no last-year data). */
  | "annualized"
  /** No stored transactions reach this year. */
  | "none";

/** Worst first — a household's basis is its least-certain feed's. */
const BASIS_RANK: Record<InvestmentIncomeBasis, number> = {
  actual: 0,
  ytdPlusLastYear: 1,
  annualized: 2,
  none: 3,
};

export type InvestmentIncomeEstimate = {
  estimate: number;
  ytd: number;
  lastYearRemainder: number;
  basis: InvestmentIncomeBasis;
};

/** Whether an account type's money is taxed as it earns (a taxable account). */
export function isTaxableAccountType(accountType: string | null): boolean {
  if (accountType === null) return false;
  if (!getAllCategories().includes(accountType as AccountCategory))
    return false;
  return (
    getAccountTypeConfig(accountType as AccountCategory).taxBucketKey ===
    "afterTax"
  );
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** One feed's estimate from its own rows and coverage. */
export function estimateFeedIncome(args: {
  rows: readonly Omit<IncomeTransaction, "feedId">[];
  taxYear: number;
  /** Today (YYYY-MM-DD). */
  today: string;
  /** First day this feed's stored transactions cover; null = none. */
  coverageStart: string | null;
}): InvestmentIncomeEstimate {
  const { taxYear, today, coverageStart } = args;
  const none = { estimate: 0, ytd: 0, lastYearRemainder: 0 };
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;
  if (coverageStart === null || coverageStart > yearEnd || today < yearStart)
    return { ...none, basis: "none" };

  const income = args.rows.filter(
    (r) => !r.pending && !r.voided && INVESTMENT_INCOME_KINDS.has(r.kind),
  );
  const sumBetween = (from: string, to: string) =>
    roundToCents(
      sumBy(
        income.filter((r) => r.posted >= from && r.posted <= to),
        (r) => r.amount,
      ),
    );

  const through = today < yearEnd ? today : yearEnd;
  const ytd = sumBetween(yearStart, through);
  if (through === yearEnd && coverageStart <= yearStart)
    return { estimate: ytd, ytd, lastYearRemainder: 0, basis: "actual" };

  // Last year's rest-of-year: the day after today's date, a year back.
  const monthDay = through.slice(5);
  const lastYear = taxYear - 1;
  const lastYearSameDay =
    monthDay === "02-29" ? `${lastYear}-02-28` : `${lastYear}-${monthDay}`;
  if (coverageStart <= lastYearSameDay) {
    const lastYearRemainder = sumBetween(
      addDays(lastYearSameDay, 1),
      `${lastYear}-12-31`,
    );
    return {
      estimate: roundToCents(ytd + lastYearRemainder),
      ytd,
      lastYearRemainder,
      basis: "ytdPlusLastYear",
    };
  }

  const from = coverageStart > yearStart ? coverageStart : yearStart;
  const coveredDays = dayNumber(through) - dayNumber(from) + 1;
  const yearDays = dayNumber(yearEnd) - dayNumber(yearStart) + 1;
  const covered = sumBetween(from, through);
  return {
    estimate:
      coveredDays > 0 ? roundToCents((covered * yearDays) / coveredDays) : 0,
    ytd,
    lastYearRemainder: 0,
    basis: "annualized",
  };
}

export type IncomeFeed = {
  id: number;
  label: string;
  /** The linked tracked account's type; null when the feed isn't linked. */
  accountType: string | null;
  /** First day this feed's stored transactions cover; null = none stored. */
  coverageStart: string | null;
};

/**
 * The household's taxable investment income: each taxable feed estimated on
 * its own coverage, summed. The basis is the least certain feed's; feeds
 * that had to be annualized are named.
 */
export function estimateTaxableInvestmentIncome(args: {
  feeds: readonly IncomeFeed[];
  rows: readonly IncomeTransaction[];
  taxYear: number;
  today: string;
}): InvestmentIncomeEstimate & {
  /** Taxable feeds whose history didn't reach last year — annualized. */
  annualizedFeeds: string[];
  /** Taxable feeds with no stored history for the year at all — not counted. */
  noHistoryFeeds: string[];
} {
  const taxable = args.feeds.filter((f) => isTaxableAccountType(f.accountType));
  const perFeed = taxable.map((f) => ({
    feed: f,
    est: estimateFeedIncome({
      rows: args.rows.filter((r) => r.feedId === f.id),
      taxYear: args.taxYear,
      today: args.today,
      coverageStart: f.coverageStart,
    }),
  }));
  // Feeds with no history this year say nothing; a household with none at
  // all is "none".
  const counted = perFeed.filter((p) => p.est.basis !== "none");
  const basis = counted.length
    ? counted.reduce<InvestmentIncomeBasis>(
        (worst, p) =>
          BASIS_RANK[p.est.basis] > BASIS_RANK[worst] ? p.est.basis : worst,
        "actual",
      )
    : "none";
  return {
    estimate: roundToCents(sumBy(counted, (p) => p.est.estimate)),
    ytd: roundToCents(sumBy(counted, (p) => p.est.ytd)),
    lastYearRemainder: roundToCents(
      sumBy(counted, (p) => p.est.lastYearRemainder),
    ),
    basis,
    annualizedFeeds: counted
      .filter((p) => p.est.basis === "annualized")
      .map((p) => p.feed.label),
    noHistoryFeeds: perFeed
      .filter((p) => p.est.basis === "none")
      .map((p) => p.feed.label),
  };
}

/**
 * What the estimate can't see: feeds not linked to a tracked account
 * (unknown tax treatment), taxable tracked accounts with a balance but no
 * feed, and pre-tax IRA money with no owner (left out of pro-rata).
 */
export function investmentIncomeGaps(args: {
  feeds: readonly { performanceAccountId: number | null }[];
  accounts: readonly {
    performanceAccountId: number;
    accountType: string;
    amount: number;
  }[];
  accountName: (performanceAccountId: number) => string;
}): { unlinkedFeedCount: number; unfedTaxableAccounts: string[] } {
  const fed = new Set(
    args.feeds.flatMap((f) =>
      f.performanceAccountId !== null ? [f.performanceAccountId] : [],
    ),
  );
  return {
    unlinkedFeedCount: args.feeds.filter((f) => f.performanceAccountId === null)
      .length,
    unfedTaxableAccounts: [
      ...new Set(
        args.accounts
          .filter(
            (a) =>
              a.amount > 0 &&
              isTaxableAccountType(a.accountType) &&
              !fed.has(a.performanceAccountId),
          )
          .map((a) => a.performanceAccountId),
      ),
    ].map(args.accountName),
  };
}
