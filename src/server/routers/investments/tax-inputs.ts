/**
 * The investment side of the Roth IRA MAGI estimate (portfolioProcedure —
 * built from transactions and account balances): taxable investment income
 * for the year, each person's pre-tax IRA balance (pro-rata), and what the
 * estimate can't see. Fetch and map only — the rules are in lib/pure
 * (investment-income.ts, roth-ira.ts).
 */
import { z } from "zod/v4";
import { min } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getTransactionCoverageStart,
  getWindowLimitDays,
} from "@/lib/simplefin/sync";
import { addDays, utcDayOf } from "@/lib/utils/date";
import {
  estimateTaxableInvestmentIncome,
  investmentIncomeGaps,
} from "@/lib/pure/investment-income";
import {
  PENDING_CONVERSION_WINDOW_DAYS,
  pendingConversion,
  preTaxIraByPerson,
} from "@/lib/pure/contributions/roth-ira";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import {
  loadAccounts,
  loadBalanceHistory,
  loadClassifiedTransactions,
} from "./_shared";

export const investmentTaxInputsRouter = createTRPCRouter({
  getRothIraInputs: portfolioProcedure
    .input(z.object({ taxYear: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const since = `${input.taxYear - 1}-01-01`;
      const t = schema.investmentTransactions;
      const [
        accounts,
        rows,
        coverage,
        windowDays,
        firstSeen,
        subs,
        names,
        balanceHistory,
      ] = await Promise.all([
        loadAccounts(ctx.db),
        loadClassifiedTransactions(ctx.db, { since }),
        getTransactionCoverageStart(ctx.db),
        getWindowLimitDays(ctx.db),
        ctx.db
          .select({ id: t.simplefinAccountId, first: min(t.firstSeenAt) })
          .from(t)
          .groupBy(t.simplefinAccountId),
        loadLatestSubAccounts(ctx.db),
        loadTrackedAccountNames(ctx.db),
        loadBalanceHistory(ctx.db),
      ]);
      // A feed's history starts a sync window before it was first synced
      // (never before the household's own first sync window).
      const householdStart = coverage ? utcDayOf(coverage) : null;
      const firstSeenById = new Map(
        firstSeen.map((f) => [f.id, f.first ? new Date(f.first) : null]),
      );
      const feeds = [...accounts.values()].map((a) => {
        const first = firstSeenById.get(a.id);
        const feedStart = first ? addDays(utcDayOf(first), -windowDays) : null;
        return {
          id: a.id,
          label: a.label,
          accountType: a.accountType,
          performanceAccountId: a.performanceAccountId,
          coverageStart:
            feedStart === null || householdStart === null
              ? null
              : feedStart > householdStart
                ? feedStart
                : householdStart,
        };
      });
      const investmentIncome = estimateTaxableInvestmentIncome({
        feeds,
        rows: rows
          .filter((r) => r.posted >= since)
          .map((r) => ({
            feedId: r.simplefinAccountId,
            posted: r.posted,
            kind: r.kind,
            amount: r.amount,
            pending: r.pending,
            voided: r.voided,
          })),
        taxYear: input.taxYear,
        today: ctx.scope.today,
      });
      const preTax = preTaxIraByPerson(subs);
      // A deposit waiting in a pre-tax IRA part, from its own feed's
      // balances (the part's feed is linked by the part's key).
      const today = ctx.scope.today;
      const windowStart = addDays(today, -PENDING_CONVERSION_WINDOW_DAYS);
      const pendingByPerson = new Map<number, number>();
      for (const sub of subs) {
        if (sub.ownerPersonId === null) continue;
        const feeds = [...accounts.values()].filter(
          (a) => a.subKey === sub.key,
        );
        if (feeds.length !== 1) continue;
        const amount = pendingConversion(
          balanceHistory.get(feeds[0]!.id) ?? [],
          today,
          windowStart,
        );
        if (amount > 0)
          pendingByPerson.set(
            sub.ownerPersonId,
            (pendingByPerson.get(sub.ownerPersonId) ?? 0) + amount,
          );
      }
      return {
        investmentIncome,
        ...investmentIncomeGaps({
          feeds,
          accounts: subs,
          accountName: (id) => names.get(id) ?? "Unnamed account",
        }),
        preTaxIraByPerson: [...preTax.byPerson].map(([personId, amount]) => ({
          personId,
          amount,
        })),
        unownedPreTaxIra: preTax.unowned,
        pendingConversionByPerson: [...pendingByPerson].map(
          ([personId, amount]) => ({ personId, amount }),
        ),
      };
    }),
});
