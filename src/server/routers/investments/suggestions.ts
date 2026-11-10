/**
 * Suggested Performance and Roth-basis figures from SimpleFIN transactions (portfolioProcedure).
 * Read-only: forms prefill from these and save through the usual mutations, which record
 * what was counted (server/services/sync/fill-ledger.ts).
 */
import { z } from "zod/v4";
import { zYear } from "@/lib/utils/zod-fields";
import { and, eq } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getEmployerMatchSubType,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { getTransactionCoverageStart } from "@/server/services/sync/simplefin/sync";
import { addDays, utcDayOf } from "@/lib/utils/date";
import { mixFor } from "@/lib/pure/investments/flow-suggestions";
import {
  rowsPerAccount,
  snapshotNewMoney,
  suggestBasisRow,
} from "@/lib/pure/investments/fill-suggestions";
import {
  RECENT_ACTIVITY_DAYS,
  sentTransactions,
} from "@/lib/pure/sync/simplefin-feeds";
import { suggestSnapshotAmounts } from "@/lib/pure/net-worth/snapshot-suggestions";
import { loadContributionMix } from "@/server/services/contributions/contribution-mix";
import { loadFillRecord } from "@/server/services/sync/fill-ledger";
import { toNumber } from "@/lib/utils/numbers";
import {
  loadAccounts,
  loadClassifiedTransactions,
  loadFeedContext,
} from "@/server/data/investments";
import { savingsPace } from "@/lib/pure/savings/savings-pace";
import {
  loadLiveContributions,
  toPaceInput,
} from "@/server/services/investments/live-contributions";
import {
  loadPerformanceSuggestions,
  loadYearRows,
} from "@/server/services/investments/fill-suggestions";

export const investmentSuggestionsRouter = createTRPCRouter({
  /**
   * Suggested balances for a new portfolio snapshot, by snapshot
   * sub-account key, from linked SimpleFIN accounts.
   */
  suggestSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const [context, accounts, mix, perfAccounts] = await Promise.all([
      loadFeedContext(ctx.db),
      loadAccounts(ctx.db),
      loadContributionMix(ctx.db, ctx.scope.asOf),
      ctx.db
        .select({
          id: schema.performanceAccounts.id,
          accountType: schema.performanceAccounts.accountType,
        })
        .from(schema.performanceAccounts),
    ]);
    const { feeds, subs, snapshotDate, lastTransactionDay } = context;
    const today = utcDayOf(ctx.scope.asOf);
    const recentSince = addDays(today, -RECENT_ACTIVITY_DAYS);
    // Placing contributions uses this year's paycheck setup at a flat rate,
    // which isn't fair across a year end or a long gap; then the change is
    // just divided by size.
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
        // A feed that now sends only a balance counts as balance-only here,
        // even if it sent transactions before.
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
  listPerformanceSuggestions: portfolioProcedure
    .input(z.object({ year: zYear }))
    .query(async ({ ctx, input }) => ({
      year: input.year,
      accounts: await loadPerformanceSuggestions(
        ctx.db,
        input.year,
        ctx.scope.asOf,
      ),
    })),

  /**
   * Saved so far this year against the paycheck plan, per tracked account
   * and for the household (Dashboard).
   */
  computeSavingsThisYear: portfolioProcedure.query(async ({ ctx }) =>
    savingsPace(
      (await loadLiveContributions(ctx.db, ctx.scope.asOf)).map(toPaceInput),
    ),
  ),

  /**
   * The year's Roth basis rows plus Roth contributions and conversions no saved fill
   * counted yet (added onto the cumulative basis); money out reduces contributions first.
   */
  listBasisSuggestions: portfolioProcedure
    .input(z.object({ year: zYear }))
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
          loadContributionMix(ctx.db, ctx.scope.asOf),
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
