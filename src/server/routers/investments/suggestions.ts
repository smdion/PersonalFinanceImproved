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
import { savingsPace } from "@/lib/pure/savings-pace";
import { loadLiveContributions, toPaceInput } from "./live-contributions";
import { loadPerformanceSuggestions, loadYearRows } from "./fills";

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
  getSavingsThisYear: portfolioProcedure.query(async ({ ctx }) =>
    savingsPace((await loadLiveContributions(ctx.db)).map(toPaceInput)),
  ),

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
