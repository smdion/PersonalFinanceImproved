/**
 * Suggested Performance and Roth-basis figures from SimpleFIN transactions
 * (portfolioProcedure — built from transaction-level detail). Read-only:
 * the Performance and basis forms prefill from these and the household
 * saves through the usual mutations, which record what was counted (see
 * server/helpers/fill-ledger.ts).
 */
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getEmployerMatchSubType,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { addDays, utcDayOf } from "@/lib/utils/date";
import { mixFor } from "@/lib/pure/flow-suggestions";
import {
  rowsPerAccount,
  snapshotNewMoney,
  suggestBasisRow,
  suggestPerformanceRow,
} from "@/lib/pure/fill-suggestions";
import {
  RECENT_ACTIVITY_DAYS,
  sentTransactions,
} from "@/lib/pure/simplefin-feeds";
import { suggestSnapshotAmounts } from "@/lib/pure/snapshot-suggestions";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { loadFillRecord } from "@/server/helpers/fill-ledger";
import { toNumber } from "@/server/helpers/transforms";
import {
  loadAccounts,
  loadClassifiedTransactions,
  loadFeedContext,
} from "./_shared";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import { savingsPace } from "@/lib/pure/savings-pace";
import { localDateStr } from "@/lib/utils/date";

type Db = Parameters<typeof loadFeedContext>[0];

/** The year's transactions (voided ones too, so a fill can take them back out). */
async function loadYearRows(db: Db, year: number) {
  const rows = await loadClassifiedTransactions(db, {
    since: `${year}-01-01`,
    includeVoided: true,
  });
  return rows.filter((r) => r.posted <= `${year}-12-31`);
}

/**
 * The year's (unfinalized) Performance rows with what SimpleFIN has seen
 * since each was last filled — shared by the Performance fill and the
 * "saved this year" pace so both count new money the same way.
 */
export async function loadPerformanceSuggestions(db: Db, year: number) {
  const [perfRows, stamp, coverage, context, mix, ledger, flows] =
    await Promise.all([
      db
        .select()
        .from(schema.accountPerformance)
        .where(
          and(
            eq(schema.accountPerformance.year, year),
            eq(schema.accountPerformance.isActive, true),
            eq(schema.accountPerformance.isFinalized, false),
          ),
        ),
      db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "performance_last_updated")),
      getTransactionCoverageStart(db),
      loadFeedContext(db),
      loadContributionMix(db),
      loadFillRecord(db, "performance", year),
      loadYearRows(db, year),
    ]);
  const perAccount = rowsPerAccount(perfRows);
  const shared = {
    year,
    stamped:
      typeof stamp[0]?.value === "string"
        ? utcDayOf(new Date(stamp[0].value))
        : null,
    feeds: context.feeds,
    subs: context.subs,
    lastTransactionDay: context.lastTransactionDay,
    ledger,
    flows,
    coverageStart: coverage ? utcDayOf(coverage) : null,
    today: utcDayOf(new Date()),
  };
  const accounts = perfRows.map((r) => {
    const rowsOnAccount = perAccount.get(r.performanceAccountId) ?? 1;
    return suggestPerformanceRow(
      {
        id: r.id,
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        totalContributions: toNumber(r.totalContributions),
        employerContributions: toNumber(r.employerContributions),
        distributions: toNumber(r.distributions),
        fees: toNumber(r.fees),
        rollovers: toNumber(r.rollovers),
      },
      {
        ...shared,
        rowsOnAccount,
        // A row tracked per person splits by that person's paycheck; a
        // single row for the account (even one stored under a person)
        // covers everyone's.
        accountMix: mixFor(
          mix,
          r.performanceAccountId,
          rowsOnAccount > 1 ? r.ownerPersonId : null,
        ),
      },
    );
  });
  return accounts;
}

export const investmentSuggestionsRouter = createTRPCRouter({
  /**
   * Suggested balances for a new portfolio snapshot, by snapshot
   * sub-account key, from linked SimpleFIN accounts.
   */
  suggestSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const [context, accounts, mix, perfAccounts] = await Promise.all([
      loadFeedContext(ctx.db),
      loadAccounts(ctx.db),
      loadContributionMix(ctx.db),
      ctx.db
        .select({
          id: schema.performanceAccounts.id,
          accountType: schema.performanceAccounts.accountType,
        })
        .from(schema.performanceAccounts),
    ]);
    const { feeds, subs, snapshotDate, lastTransactionDay } = context;
    const today = utcDayOf(new Date());
    const recentSince = addDays(today, -RECENT_ACTIVITY_DAYS);
    // Placing contributions uses this year's paycheck setup at a flat rate;
    // across a year end or a long gap that's no longer a fair estimate, so
    // the change is then just divided by size.
    const snapshotTooOld =
      snapshotDate !== null &&
      (snapshotDate.slice(0, 4) !== today.slice(0, 4) ||
        snapshotDate < recentSince);
    const contributions = snapshotDate
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

    const {
      amounts,
      accounts: notes,
      unplaced,
    } = suggestSnapshotAmounts(
      subs,
      feeds.map((f) => ({ ...f, balanceDate: f.balanceDay })),
      (performanceAccountId) => {
        // A feed that used to send transactions but now sends only a
        // balance counts as balance-only here.
        const whole = feeds.filter(
          (f) => f.performanceAccountId === performanceAccountId && !f.subKey,
        );
        return snapshotNewMoney({
          mix: mix.get(performanceAccountId),
          snapshotDate,
          snapshotTooOld,
          feeds: whole,
          sendsTransactions: sentTransactions(
            whole.map((f) => f.id),
            lastTransactionDay,
            recentSince,
          ),
          contributions,
          today,
        });
      },
      (performanceAccountId) => {
        const type = typeOf.get(performanceAccountId);
        return type ? getEmployerMatchSubType(type) : null;
      },
    );
    return {
      snapshotDate,
      snapshotTooOld,
      amounts: [...amounts].map(([key, amount]) => ({ key, amount })),
      accounts: [...notes].map(([performanceAccountId, note]) => ({
        performanceAccountId,
        ...note,
      })),
      /** Feeds whose money no part of the latest snapshot holds, by the institution's name. */
      unplaced: unplaced.map((u) => ({
        ...u,
        name: accounts.get(u.feedId)?.feedName ?? "",
      })),
    };
  }),

  /**
   * The year's Performance rows with what SimpleFIN has seen that no saved
   * fill has counted yet, added onto the stored figures.
   */
  suggestPerformance: portfolioProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => ({
      year: input.year,
      accounts: await loadPerformanceSuggestions(ctx.db, input.year),
    })),

  /**
   * Saved so far this year against the paycheck plan, per tracked account
   * and for the household (Dashboard).
   */
  getSavingsThisYear: portfolioProcedure.query(async ({ ctx }) => {
    const today = localDateStr();
    const year = Number(today.slice(0, 4));
    const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
    const [rows, pending, mix, names, context] = await Promise.all([
      ctx.db
        .select({
          performanceAccountId: schema.accountPerformance.performanceAccountId,
          totalContributions: schema.accountPerformance.totalContributions,
        })
        .from(schema.accountPerformance)
        .where(
          and(
            eq(schema.accountPerformance.year, year),
            eq(schema.accountPerformance.isActive, true),
          ),
        ),
      loadPerformanceSuggestions(ctx.db, year),
      loadContributionMix(ctx.db, dayDate(today)),
      loadTrackedAccountNames(ctx.db),
      loadFeedContext(ctx.db),
    ]);
    // An account whose feed sends transactions is known only through its
    // latest posted one; the plan between then and today is taken to be on
    // its way — the gap the Year-End Estimate view fills ("stale periods").
    const lastPosted = new Map<number, string>();
    for (const f of context.feeds) {
      const day = context.lastTransactionDay.get(f.id);
      if (
        day &&
        day < today &&
        day > (lastPosted.get(f.performanceAccountId) ?? "")
      )
        lastPosted.set(f.performanceAccountId, day);
    }
    const mixAt = new Map(
      await Promise.all(
        [...new Set(lastPosted.values())].map(
          async (day) =>
            [day, await loadContributionMix(ctx.db, dayDate(day))] as const,
        ),
      ),
    );
    const ids = new Set([
      ...rows.map((r) => r.performanceAccountId),
      ...mix.keys(),
    ]);
    return savingsPace(
      [...ids].map((id) => {
        const mine = pending.filter((p) => p.performanceAccountId === id);
        const m = mix.get(id);
        const estimated = mine.some((p) => p.estimate !== null);
        const posted = lastPosted.get(id);
        const then = posted ? mixAt.get(posted)?.get(id) : undefined;
        return {
          performanceAccountId: id,
          label: names.get(id) ?? "",
          recorded: rows
            .filter((r) => r.performanceAccountId === id)
            .reduce((t, r) => t + toNumber(r.totalContributions), 0),
          pending: mine.reduce(
            (t, p) => t + p.added.employee + p.added.employer,
            0,
          ),
          pendingEstimated: estimated,
          // A paycheck estimate already runs to today: nothing in between.
          unposted:
            m && then && !estimated
              ? Math.max(0, then.remainingThisYear - m.remainingThisYear)
              : 0,
          plan: m
            ? {
                yearly:
                  m.employeePreTax +
                  m.employeeRoth +
                  m.employeeOther +
                  m.employer,
                remaining: m.remainingThisYear,
                perContribution: m.perContribution,
              }
            : null,
        };
      }),
    );
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
      const [basisRows, coverage, context, mix, ledger, flows, priorRows] =
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
          loadFeedContext(ctx.db),
          loadContributionMix(ctx.db),
          loadFillRecord(ctx.db, "basis", input.year),
          loadYearRows(ctx.db, input.year),
          ctx.db
            .select()
            .from(schema.accountBasis)
            .where(eq(schema.accountBasis.year, input.year - 1)),
        ]);
      const perAccount = rowsPerAccount(basisRows);
      const accounts = basisRows.map((r) => {
        const prior = priorRows.find(
          (p) =>
            p.performanceAccountId === r.performanceAccountId &&
            p.ownerPersonId === r.ownerPersonId,
        );
        return suggestBasisRow(
          {
            id: r.id,
            performanceAccountId: r.performanceAccountId,
            ownerPersonId: r.ownerPersonId,
            contributionBasis: toNumber(r.contributionBasis),
            conversionBasis: toNumber(r.conversionBasis),
            latestConversionYear: r.latestConversionYear,
            isSeeded: r.isSeeded,
            updatedDay: utcDayOf(r.updatedAt),
            prior: prior
              ? {
                  contributionBasis: toNumber(prior.contributionBasis),
                  conversionBasis: toNumber(prior.conversionBasis),
                }
              : null,
          },
          {
            year: input.year,
            rowsOnAccount: perAccount.get(r.performanceAccountId) ?? 1,
            feeds: context.feeds,
            subs: context.subs,
            accountMix: mixFor(mix, r.performanceAccountId, r.ownerPersonId),
            ledger,
            flows,
            coverageStart: coverage ? utcDayOf(coverage) : null,
            isRothTaxType: isTaxFreeBucket,
          },
        );
      });
      return { year: input.year, accounts };
    }),
});
