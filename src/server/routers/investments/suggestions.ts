/**
 * Suggested Performance and Roth-basis figures from SimpleFIN transactions
 * (portfolioProcedure — built from transaction-level detail). Read-only:
 * the Performance and basis forms prefill from these and the household
 * saves through the usual mutations, which record what was counted (see
 * server/helpers/fill-ledger.ts).
 */
import { z } from "zod/v4";
import { and, eq, isNotNull } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { isTaxFreeBucket } from "@/lib/config/account-types";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { utcDayOf } from "@/lib/simplefin/ingest";
import { roundToCents } from "@/lib/utils/math";
import {
  attributeFeeds,
  estimateFromPaycheck,
  flowsSinceFill,
  initialBaseline,
  reduceBasis,
  splitContributions,
  type FeedAccount,
} from "@/lib/pure/flow-suggestions";
import { suggestSnapshotAmounts } from "@/lib/pure/snapshot-suggestions";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { loadFillRecord } from "@/server/helpers/fill-ledger";
import { toNumber } from "@/server/helpers/transforms";
import { loadClassifiedTransactions } from "./_shared";

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
      .where(isNotNull(schema.simplefinAccounts.linkedPerformanceAccountId)),
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

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcDayOf(d);
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

export const investmentSuggestionsRouter = createTRPCRouter({
  /**
   * Suggested balances for a new portfolio snapshot, by snapshot
   * sub-account key, from linked SimpleFIN accounts.
   */
  suggestSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const [feeds, subs] = await Promise.all([
      ctx.db
        .select({
          performanceAccountId:
            schema.simplefinAccounts.linkedPerformanceAccountId,
          subKey: schema.simplefinAccounts.linkedSubKey,
          balance: schema.simplefinAccounts.lastBalance,
          balanceDate: schema.simplefinAccounts.lastBalanceDate,
        })
        .from(schema.simplefinAccounts)
        .where(isNotNull(schema.simplefinAccounts.linkedPerformanceAccountId)),
      loadLatestSubAccounts(ctx.db),
    ]);
    const suggestions = suggestSnapshotAmounts(
      subs.map((s) => ({
        key: s.key,
        performanceAccountId: s.performanceAccountId,
        amount: s.amount,
      })),
      feeds.map((f) => ({
        performanceAccountId: f.performanceAccountId!,
        subKey: f.subKey,
        balance: toNumber(f.balance),
        balanceDate: f.balanceDate ? utcDayOf(f.balanceDate) : null,
      })),
    );
    return [...suggestions].map(([key, s]) => ({ key, ...s }));
  }),

  /**
   * The year's Performance rows with what SimpleFIN has seen that no saved
   * fill has counted yet, added onto the stored figures.
   */
  suggestPerformance: portfolioProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [perfRows, stamp, coverage, { feeds, subs }, mix, ledger, flows] =
        await Promise.all([
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
          mine,
          ledger.counted,
          countFrom,
        );
        const accountMix = mix.get(r.performanceAccountId) ?? null;
        const split = splitContributions(t.contributions, accountMix, false);
        // No feed: what the paycheck setup should have sent instead.
        const estimateTo = today < yearEnd ? today : yearEnd;
        const estimate =
          feed.status === "none" && accountMix
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
          baseline,
          /** New money is counted after this day. */
          since: countFrom,
          missingBefore: estimate ? null : gapAfter(coverageStart, countFrom),
          added: { ...t, ...split },
          estimate,
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
      const [basisRows, coverage, { feeds, subs }, mix, ledger, flows] =
        await Promise.all([
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
        ]);
      const coverageStart = coverage ? utcDayOf(coverage) : null;
      const perAccount = rowsPerAccount(basisRows);
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
        // A row carried forward at year end hasn't seen this year's money.
        const baseline =
          ledger.baselines[r.id] ??
          initialBaseline(input.year, utcDayOf(r.updatedAt), r.isSeeded);
        const feed = attributeFeeds(
          r,
          perAccount.get(r.performanceAccountId) ?? 1,
          feeds,
          subs,
        );
        const accountMix = mix.get(r.performanceAccountId) ?? null;
        let roth = 0;
        let conversions = 0;
        let outflow = 0;
        let estimated = false;
        let latestConversionYear = r.latestConversionYear;
        let count = 0;
        const counted: Record<string, string> = {};
        for (const id of feed.feedIds) {
          const f = feeds.find((x) => x.id === id)!;
          const accountIsRoth = isRoth(f.subKey, r.performanceAccountId);
          const { totals: t, counted: c } = flowsSinceFill(
            flows.filter((x) => x.simplefinAccountId === id),
            ledger.counted,
            baseline,
          );
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
