/**
 * Suggested Performance and Roth-basis figures from SimpleFIN transactions
 * (portfolioProcedure — built from transaction-level detail). Read-only:
 * the Performance and basis forms prefill from these and the household
 * saves through the usual mutations, which record what was counted (see
 * server/helpers/fill-ledger.ts).
 */
import { z } from "zod/v4";
import { and, desc, eq, gte } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getEmployerMatchSubType,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { utcDayOf } from "@/lib/simplefin/ingest";
import { roundToCents } from "@/lib/utils/math";
import {
  attributeFeeds,
  estimateFromPaycheck,
  mixFor,
  flowsSinceFill,
  initialBaseline,
  reduceBasis,
  splitContributions,
  type FeedAccount,
} from "@/lib/pure/flow-suggestions";
import {
  suggestSnapshotAmounts,
  type NewMoney,
  type UnplacedFeed,
} from "@/lib/pure/snapshot-suggestions";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { loadFillRecord } from "@/server/helpers/fill-ledger";
import { toNumber } from "@/server/helpers/transforms";
import {
  countedFeed,
  loadAccounts,
  loadClassifiedTransactions,
} from "./_shared";

type Db = Parameters<typeof loadLatestSubAccounts>[0];

async function loadFeeds(db: Db) {
  const [rows, subs] = await Promise.all([
    db
      .select({
        id: schema.simplefinAccounts.id,
        performanceAccountId:
          schema.simplefinAccounts.linkedPerformanceAccountId,
        subKey: schema.simplefinAccounts.linkedSubKey,
        balance: schema.simplefinAccounts.lastBalance,
      })
      .from(schema.simplefinAccounts)
      .where(countedFeed),
    loadLatestSubAccounts(db),
  ]);
  const subByKey = new Map(subs.map((s) => [s.key, s]));
  const feeds: FeedAccount[] = rows.map((r) => ({
    id: r.id,
    performanceAccountId: r.performanceAccountId!,
    subKey: r.subKey,
    ownerPersonId: r.subKey
      ? (subByKey.get(r.subKey)?.ownerPersonId ?? null)
      : null,
    balance: toNumber(r.balance),
  }));
  return { feeds, subs };
}

/** The year's transactions (voided ones too, so a fill can take them back out). */
async function loadYearRows(db: Db, year: number) {
  const rows = await loadClassifiedTransactions(db, {
    since: `${year}-01-01`,
    includeVoided: true,
  });
  return rows.filter((r) => r.posted <= `${year}-12-31`);
}

/** How far back a feed must have sent a transaction not to count as balance-only. */
const RECENT_DAYS = 90;

/**
 * SimpleFIN accounts that have sent a transaction (since a day, if given). Some institutions
 * send only a balance for an account; its contributions are estimated the
 * way an unlinked account's are.
 */
async function feedsWithTransactions(
  db: Db,
  since?: string,
): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ id: schema.investmentTransactions.simplefinAccountId })
    .from(schema.investmentTransactions)
    .where(
      since ? gte(schema.investmentTransactions.posted, since) : undefined,
    );
  return new Set(rows.map((r) => r.id));
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcDayOf(d);
}

/**
 * Deposits that are probably money the household already recorded (in
 * Performance) as moved in from another account count for nothing in a
 * fill — kind "other", so one counted by an earlier fill is taken back out.
 */
function withoutRecordedMoves<
  R extends { recordedMoveFrom: string | null; kind: string },
>(rows: readonly R[]): R[] {
  return rows.map((r) =>
    r.recordedMoveFrom ? { ...r, kind: "other" as const } : r,
  );
}

/** What a fill leaves out as already-recorded moves, after `after`. */
function recordedMovesSince(
  rows: readonly {
    recordedMoveFrom: string | null;
    posted: string;
    amount: number;
    pending: boolean;
    voided: boolean;
  }[],
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
function gapAfter(coverageStart: string | null, baseline: string) {
  return coverageStart === null || coverageStart > nextDay(baseline)
    ? coverageStart
    : null;
}

function rowsPerAccount(rows: readonly { performanceAccountId: number }[]) {
  const n = new Map<number, number>();
  for (const r of rows)
    n.set(r.performanceAccountId, (n.get(r.performanceAccountId) ?? 0) + 1);
  return n;
}

/** Unplaced feeds with the SimpleFIN account's name, for the warning. */
export async function namedUnplaced(db: Db, unplaced: readonly UnplacedFeed[]) {
  if (unplaced.length === 0) return [];
  const accounts = await loadAccounts(db);
  return unplaced.map((u) => {
    const a = accounts.get(u.feedId);
    return {
      ...u,
      name: `${a?.institution ?? ""} ${a?.accountName ?? ""}`.trim(),
    };
  });
}

export const investmentSuggestionsRouter = createTRPCRouter({
  /**
   * Suggested balances for a new portfolio snapshot, by snapshot
   * sub-account key, from linked SimpleFIN accounts.
   */
  suggestSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const [feeds, subs, latest, mix, withTransactions, perfAccounts] =
      await Promise.all([
        ctx.db
          .select({
            id: schema.simplefinAccounts.id,
            performanceAccountId:
              schema.simplefinAccounts.linkedPerformanceAccountId,
            subKey: schema.simplefinAccounts.linkedSubKey,
            balance: schema.simplefinAccounts.lastBalance,
            balanceDate: schema.simplefinAccounts.lastBalanceDate,
          })
          .from(schema.simplefinAccounts)
          .where(countedFeed),
        loadLatestSubAccounts(ctx.db),
        ctx.db
          .select({ date: schema.portfolioSnapshots.snapshotDate })
          .from(schema.portfolioSnapshots)
          .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
          .limit(1),
        loadContributionMix(ctx.db),
        // A feed that used to send transactions but now sends only a
        // balance counts as balance-only here.
        feedsWithTransactions(
          ctx.db,
          utcDayOf(new Date(Date.now() - RECENT_DAYS * 86_400_000)),
        ),
        ctx.db
          .select({
            id: schema.performanceAccounts.id,
            accountType: schema.performanceAccounts.accountType,
          })
          .from(schema.performanceAccounts),
      ]);
    const snapshotDate = latest[0]?.date ?? null;
    const today = utcDayOf(new Date());
    // Placing contributions uses this year's paycheck setup at a flat rate;
    // across a year end or a long gap that's no longer a fair estimate, so
    // the change is then just divided by size.
    const snapshotTooOld =
      snapshotDate !== null &&
      (snapshotDate.slice(0, 4) !== today.slice(0, 4) ||
        Date.parse(today) - Date.parse(snapshotDate) >
          RECENT_DAYS * 86_400_000);
    const flows = snapshotDate
      ? (
          await loadClassifiedTransactions(ctx.db, { since: snapshotDate })
        ).filter(
          (r) =>
            r.posted > snapshotDate &&
            !r.pending &&
            !r.voided &&
            r.kind === "contribution",
        )
      : [];
    const typeOf = new Map(perfAccounts.map((p) => [p.id, p.accountType]));

    /** Contributions since the snapshot into an account's whole-account feeds. */
    const newMoneyFor = (performanceAccountId: number): NewMoney | null => {
      const m = mix.get(performanceAccountId);
      if (!m || !snapshotDate || snapshotTooOld) return null;
      const all =
        m.employeePreTax + m.employeeRoth + m.employeeOther + m.employer;
      if (all <= 0) return null;
      const whole = feeds.filter(
        (f) => f.performanceAccountId === performanceAccountId && !f.subKey,
      );
      const ids = whole.map((f) => f.id);
      // Only money the reported balance already includes.
      const dates = whole.map((f) =>
        f.balanceDate ? utcDayOf(f.balanceDate) : today,
      );
      const asOf = dates.sort()[0] ?? today;
      const balanceOnly = ids.every((id) => !withTransactions.has(id));
      // Deposits on the snapshot day itself are taken to be in the snapshot.
      const total = balanceOnly
        ? (() => {
            const e = estimateFromPaycheck(m, snapshotDate, asOf);
            return e.employee + e.employer;
          })()
        : flows
            .filter(
              (r) => ids.includes(r.simplefinAccountId) && r.posted <= asOf,
            )
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
    };
    const matchSubTypeFor = (performanceAccountId: number) => {
      const type = typeOf.get(performanceAccountId);
      return type ? getEmployerMatchSubType(type) : null;
    };

    const { amounts, accounts, unplaced } = suggestSnapshotAmounts(
      subs.map((s) => ({
        key: s.key,
        performanceAccountId: s.performanceAccountId,
        taxType: s.taxType,
        subType: s.subType,
        amount: s.amount,
      })),
      feeds.map((f) => ({
        id: f.id,
        performanceAccountId: f.performanceAccountId!,
        subKey: f.subKey,
        balance: toNumber(f.balance),
        balanceDate: f.balanceDate ? utcDayOf(f.balanceDate) : null,
      })),
      newMoneyFor,
      matchSubTypeFor,
    );
    return {
      snapshotDate,
      snapshotTooOld,
      amounts: [...amounts].map(([key, amount]) => ({ key, amount })),
      accounts: [...accounts].map(([performanceAccountId, note]) => ({
        performanceAccountId,
        ...note,
      })),
      unplaced: await namedUnplaced(ctx.db, unplaced),
    };
  }),

  /**
   * The year's Performance rows with what SimpleFIN has seen that no saved
   * fill has counted yet, added onto the stored figures.
   */
  suggestPerformance: portfolioProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [
        perfRows,
        stamp,
        coverage,
        { feeds, subs },
        mix,
        ledger,
        flows,
        withTransactions,
      ] = await Promise.all([
        ctx.db
          .select()
          .from(schema.accountPerformance)
          .where(
            and(
              eq(schema.accountPerformance.year, input.year),
              eq(schema.accountPerformance.isActive, true),
              eq(schema.accountPerformance.isFinalized, false),
            ),
          ),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "performance_last_updated")),
        getTransactionCoverageStart(ctx.db),
        loadFeeds(ctx.db),
        loadContributionMix(ctx.db),
        loadFillRecord(ctx.db, "performance", input.year),
        loadYearRows(ctx.db, input.year),
        feedsWithTransactions(ctx.db),
      ]);
      const stamped =
        typeof stamp[0]?.value === "string"
          ? utcDayOf(new Date(stamp[0].value))
          : null;
      const coverageStart = coverage ? utcDayOf(coverage) : null;
      const perAccount = rowsPerAccount(perfRows);
      const today = utcDayOf(new Date());
      const yearEnd = `${input.year}-12-31`;

      const accounts = perfRows.map((r) => {
        const empty = [
          r.totalContributions,
          r.distributions,
          r.fees,
          r.rollovers,
        ].every((v) => toNumber(v) === 0);
        const baseline =
          ledger.baselines[r.id] ?? initialBaseline(input.year, stamped, empty);
        const feed = attributeFeeds(
          r,
          perAccount.get(r.performanceAccountId) ?? 1,
          feeds,
          subs,
        );
        // Days an earlier paycheck estimate covered aren't counted again.
        const estimatedThrough = ledger.estimatedThrough?.[r.id];
        const countFrom =
          estimatedThrough && estimatedThrough > baseline
            ? estimatedThrough
            : baseline;
        const mine = flows.filter((f) =>
          feed.feedIds.includes(f.simplefinAccountId),
        );
        const { totals: t, counted } = flowsSinceFill(
          withoutRecordedMoves(mine),
          ledger.counted,
          countFrom,
        );
        const leftOut = recordedMovesSince(mine, countFrom);
        // A row tracked per person splits by that person's paycheck; a
        // single row for the account (even one stored under a person)
        // covers everyone's.
        const accountMix = mixFor(
          mix,
          r.performanceAccountId,
          (perAccount.get(r.performanceAccountId) ?? 1) > 1
            ? r.ownerPersonId
            : null,
        );
        const split = splitContributions(t.contributions, accountMix, false);
        // No feed: what the paycheck setup should have sent instead.
        const estimateTo = today < yearEnd ? today : yearEnd;
        const estimate =
          (feed.status === "none" ||
            (feed.status === "linked" &&
              feed.feedIds.every((id) => !withTransactions.has(id)))) &&
          accountMix
            ? {
                ...estimateFromPaycheck(accountMix, countFrom, estimateTo),
                through: estimateTo,
              }
            : null;
        if (estimate && estimate.employee + estimate.employer === 0)
          estimate.through = countFrom;
        if (estimate) {
          split.employee += estimate.employee;
          split.employer += estimate.employer;
        }
        const storedEmployer = toNumber(r.employerContributions);
        const storedEmployee = toNumber(r.totalContributions) - storedEmployer;
        return {
          accountPerformanceId: r.id,
          feed: feed.status,
          /** Linked, but the institution sends only a balance. */
          balanceOnly:
            feed.status === "linked" &&
            feed.feedIds.every((id) => !withTransactions.has(id)),
          baseline,
          /** New money is counted after this day. */
          since: countFrom,
          missingBefore: estimate ? null : gapAfter(coverageStart, countFrom),
          added: { ...t, ...split },
          estimate,
          /** Deposits left out as money already recorded as moved in. */
          leftOut,
          reviewCount: mine.filter(
            (f) => f.needsReview && !f.voided && f.posted > baseline,
          ).length,
          suggested: {
            employeeContrib: roundToCents(storedEmployee + split.employee),
            employerContributions: roundToCents(
              storedEmployer + split.employer,
            ),
            distributions: roundToCents(
              toNumber(r.distributions) + t.distributions,
            ),
            rollovers: roundToCents(toNumber(r.rollovers) + t.rollovers),
            fees: roundToCents(toNumber(r.fees) + t.fees),
            endingBalance: feed.balance,
          },
          counted,
        };
      });
      return { year: input.year, accounts };
    }),

  /**
   * The year's Roth basis rows with Roth contributions and conversions no
   * saved fill has counted yet. Basis is cumulative, so these add onto the
   * stored figures; money out of a Roth account reduces them (contributions
   * first, then conversions).
   */
  suggestBasis: portfolioProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [
        basisRows,
        coverage,
        { feeds, subs },
        mix,
        ledger,
        flows,
        priorRows,
      ] = await Promise.all([
        ctx.db
          .select()
          .from(schema.accountBasis)
          .where(
            and(
              eq(schema.accountBasis.year, input.year),
              eq(schema.accountBasis.isFinalized, false),
            ),
          ),
        getTransactionCoverageStart(ctx.db),
        loadFeeds(ctx.db),
        loadContributionMix(ctx.db),
        loadFillRecord(ctx.db, "basis", input.year),
        loadYearRows(ctx.db, input.year),
        ctx.db
          .select()
          .from(schema.accountBasis)
          .where(eq(schema.accountBasis.year, input.year - 1)),
      ]);
      const coverageStart = coverage ? utcDayOf(coverage) : null;
      const perAccount = rowsPerAccount(basisRows);
      /** Still holding exactly last year's figures: nothing of this year added yet. */
      const sameAsLastYear = (r: (typeof basisRows)[number]) => {
        const prior = priorRows.find(
          (p) =>
            p.performanceAccountId === r.performanceAccountId &&
            p.ownerPersonId === r.ownerPersonId,
        );
        return (
          !!prior &&
          Math.abs(
            toNumber(prior.contributionBasis) - toNumber(r.contributionBasis),
          ) < 0.005 &&
          Math.abs(
            toNumber(prior.conversionBasis) - toNumber(r.conversionBasis),
          ) < 0.005
        );
      };
      const isRoth = (key: string | null, performanceAccountId: number) => {
        const accountSubs = subs.filter(
          (s) => s.performanceAccountId === performanceAccountId,
        );
        const relevant = key
          ? accountSubs.filter((s) => s.key === key)
          : accountSubs;
        return (
          relevant.length > 0 &&
          relevant.every(
            (s) => s.taxType !== null && isTaxFreeBucket(s.taxType),
          )
        );
      };

      const accounts = basisRows.map((r) => {
        // A row carried forward at year end — or saved later but still
        // holding last year's figures — hasn't seen this year's money.
        const baseline =
          ledger.baselines[r.id] ??
          initialBaseline(
            input.year,
            utcDayOf(r.updatedAt),
            r.isSeeded || sameAsLastYear(r),
          );
        const feed = attributeFeeds(
          r,
          perAccount.get(r.performanceAccountId) ?? 1,
          feeds,
          subs,
        );
        const accountMix = mixFor(mix, r.performanceAccountId, r.ownerPersonId);
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
          const f = feeds.find((x) => x.id === id)!;
          const accountIsRoth = isRoth(f.subKey, r.performanceAccountId);
          const feedRows = flows.filter((x) => x.simplefinAccountId === id);
          const { totals: t, counted: c } = flowsSinceFill(
            withoutRecordedMoves(feedRows),
            ledger.counted,
            baseline,
          );
          const out = recordedMovesSince(feedRows, baseline);
          if (out) {
            leftOut.amount += out.amount;
            leftOut.from ??= out.from;
          }
          Object.assign(counted, c);
          const split = splitContributions(
            t.contributions,
            accountMix,
            accountIsRoth,
          );
          roth += split.employeeRoth;
          estimated ||= split.estimated && split.employeeRoth !== 0;
          conversions += t.conversionsIn;
          // Money leaving a mixed (Roth + pre-tax) account can't be pinned
          // to the Roth part, so only all-Roth feeds reduce basis.
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
            contributionBasis: toNumber(r.contributionBasis) + roth,
            conversionBasis: toNumber(r.conversionBasis) + conversions,
          },
          outflow,
        );
        return {
          accountBasisId: r.id,
          performanceAccountId: r.performanceAccountId,
          ownerPersonId: r.ownerPersonId,
          baseline,
          missingBefore: gapAfter(coverageStart, baseline),
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
      });
      return { year: input.year, accounts };
    }),
});
