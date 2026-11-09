import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { safeDivide } from "@/lib/utils/math";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import { getEffectiveOtherAssets } from "@/server/services/net-worth/other-assets";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { toNumber } from "@/lib/utils/numbers";
import { getEffectiveOtherLiabilities } from "@/server/services/debts/other-liabilities";

export const comparisonProcedures = {
  /**
   * Compare net worth at two dates.
   * Uses nearest portfolio snapshot for investment values, computes mortgage
   * balance at each date, and uses current values for home/cash/other (noted as limitation).
   */
  computeComparison: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string(), // YYYY-MM-DD
        dateTo: z.string(), // YYYY-MM-DD
        useMarketValue: z.boolean().optional().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { dateFrom, dateTo, useMarketValue } = input;
      const asOfDate = ctx.scope.asOf;

      // Fetch shared data needed for both dates
      const [mortgageLoans, extraPayments, settings, allSnapshots] =
        await Promise.all([
          ctx.db.select().from(schema.mortgageLoans),
          ctx.db
            .select()
            .from(schema.mortgageExtraPayments)
            .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
          ctx.db.select().from(schema.appSettings),
          ctx.db
            .select()
            .from(schema.portfolioSnapshots)
            .orderBy(asc(schema.portfolioSnapshots.snapshotDate)),
        ]);

      const setting = parseAppSettings(settings);
      const homeImprovements = setting("current_home_improvements", 0);
      const homeValue = (() => {
        const activeMortgage = getActiveMortgageLoan(mortgageLoans);
        if (!activeMortgage) return 0;
        if (useMarketValue) {
          return toNumber(
            activeMortgage.propertyValueEstimated ??
              activeMortgage.propertyValuePurchase,
          );
        }
        return (
          toNumber(activeMortgage.propertyValuePurchase) + homeImprovements
        );
      })();
      // Resolved once, threaded into getEffectiveCash/
      // getEffectiveCreditCardDebt, and run alongside otherAssets.
      const { asOf } = ctx.scope;
      const { getActiveBudgetApi } = await import("@/lib/budget-api");
      const activeBudgetApi = await getActiveBudgetApi(ctx.db);
      const [{ cash }, otherAssets] = await Promise.all([
        getEffectiveCash(ctx.db, settings, activeBudgetApi),
        getEffectiveOtherAssets(ctx.db, settings, asOf),
      ]);
      const otherLiabilities = (
        await getEffectiveOtherLiabilities(ctx.db, { activeBudgetApi, asOf })
      ).total;

      // Find nearest snapshot to a target date
      async function getSnapshotAtDate(targetDate: string) {
        if (allSnapshots.length === 0) {
          return {
            total: 0,
            byTaxType: {} as Record<string, number>,
            snapshotDate: null,
          };
        }

        // Find closest snapshot by absolute date distance
        let closest = allSnapshots[0]!;
        let closestDist = Math.abs(
          new Date(closest.snapshotDate).getTime() -
            new Date(targetDate).getTime(),
        );
        for (const s of allSnapshots) {
          const dist = Math.abs(
            new Date(s.snapshotDate).getTime() - new Date(targetDate).getTime(),
          );
          if (dist < closestDist) {
            closest = s;
            closestDist = dist;
          }
        }

        // Load accounts for this snapshot
        const accounts = await ctx.db
          .select()
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, closest.id));

        const total = accounts.reduce((s, a) => s + toNumber(a.amount), 0);
        const byTaxType: Record<string, number> = {};
        for (const a of accounts) {
          const key = a.taxType;
          byTaxType[key] = (byTaxType[key] ?? 0) + toNumber(a.amount);
        }

        return { total, byTaxType, snapshotDate: closest.snapshotDate };
      }

      const [fromSnapshot, toSnapshot] = await Promise.all([
        getSnapshotAtDate(dateFrom),
        getSnapshotAtDate(dateTo),
      ]);

      // Compute mortgage balance at each date
      const mortgageFrom = computeMortgageBalance(
        mortgageLoans,
        extraPayments,
        new Date(dateFrom + "T00:00:00"),
        asOfDate,
      );
      const mortgageTo = computeMortgageBalance(
        mortgageLoans,
        extraPayments,
        new Date(dateTo + "T00:00:00"),
        asOfDate,
      );

      // Build category breakdown
      // Categories: portfolio (by tax type), home equity, cash, other assets, mortgage, other liabilities
      type DatePoint = {
        date: string;
        snapshotDate: string | null;
        portfolioTotal: number;
        portfolioByTaxType: Record<string, number>;
        homeValue: number;
        cash: number;
        otherAssets: number;
        mortgageBalance: number;
        otherLiabilities: number;
        netWorth: number;
      };

      function buildPoint(
        date: string,
        snapshot: {
          total: number;
          byTaxType: Record<string, number>;
          snapshotDate: string | null;
        },
        mortgage: number,
      ): DatePoint {
        const nw =
          snapshot.total +
          homeValue +
          cash +
          otherAssets -
          mortgage -
          otherLiabilities;
        return {
          date,
          snapshotDate: snapshot.snapshotDate,
          portfolioTotal: snapshot.total,
          portfolioByTaxType: snapshot.byTaxType,
          homeValue,
          cash,
          otherAssets,
          mortgageBalance: mortgage,
          otherLiabilities,
          netWorth: nw,
        };
      }

      const from = buildPoint(dateFrom, fromSnapshot, mortgageFrom);
      const to = buildPoint(dateTo, toSnapshot, mortgageTo);

      const absoluteChange = to.netWorth - from.netWorth;
      const percentChange = safeDivide(
        absoluteChange,
        Math.abs(from.netWorth),
        0,
      );

      // Per-category deltas
      const categories = [
        {
          label: "Investment Portfolio",
          from: from.portfolioTotal,
          to: to.portfolioTotal,
        },
        { label: "Home Value", from: from.homeValue, to: to.homeValue },
        { label: "Cash", from: from.cash, to: to.cash },
        { label: "Other Assets", from: from.otherAssets, to: to.otherAssets },
        {
          label: "Mortgage",
          from: -from.mortgageBalance,
          to: -to.mortgageBalance,
        },
        {
          label: "Other Liabilities",
          from: -from.otherLiabilities,
          to: -to.otherLiabilities,
        },
      ];

      // Portfolio sub-categories by tax type
      const allTaxTypes = new Set([
        ...Object.keys(from.portfolioByTaxType),
        ...Object.keys(to.portfolioByTaxType),
      ]);
      const portfolioBreakdown = Array.from(allTaxTypes).map((taxType) => ({
        label: taxType,
        from: from.portfolioByTaxType[taxType] ?? 0,
        to: to.portfolioByTaxType[taxType] ?? 0,
        delta:
          (to.portfolioByTaxType[taxType] ?? 0) -
          (from.portfolioByTaxType[taxType] ?? 0),
      }));

      return {
        from,
        to,
        absoluteChange,
        percentChange,
        categories: categories.map((c) => ({
          ...c,
          delta: c.to - c.from,
        })),
        portfolioBreakdown,
        limitations: [
          "Home value, cash, and other assets/liabilities use current values for both dates (historical values not tracked).",
          "Portfolio values use the nearest available weekly snapshot.",
        ],
      };
    }),
};
