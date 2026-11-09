import { calendarYear } from "@/lib/utils/date";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getActiveMortgageLoan } from "@/lib/pure/debts/mortgage-balance";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import { buildYearEndHistory } from "@/server/services/net-worth/year-end-history";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";

export const historyProcedures = {
  /**
   * Net worth at each year end for the charts, at market and at cost basis (the home at its
   * purchase price plus improvements).
   */
  listHistory: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [yearEndHistory, people, mortgageLoansAll] = await Promise.all([
        buildYearEndHistory(ctx.db, ctx.scope.asOf, {
          budgetProfileId: input?.budgetProfileId,
          budgetColumn: input?.budgetColumn,
        }),
        getAllPeople(ctx.db),
        ctx.db.select().from(schema.mortgageLoans),
      ]);

      const primaryPerson = getPrimaryPerson(people);
      const primaryBirthYear = primaryPerson
        ? calendarYear(primaryPerson.dateOfBirth)
        : null;

      // Purchase price for cost basis: use earliest mortgage (or active) as the property
      const activeMortgageForHistory = getActiveMortgageLoan(mortgageLoansAll);
      const purchasePrice = activeMortgageForHistory
        ? toNumber(activeMortgageForHistory.propertyValuePurchase)
        : 0;

      // Derive cost-basis and totals from shared year-end rows
      const history = yearEndHistory.map((row) => {
        const totalLiabilities = row.mortgageBalance + row.otherLiabilities;
        const totalAssets =
          row.portfolioTotal + row.cash + row.houseValue + row.otherAssets;
        const houseValueCostBasis =
          row.houseValue > 0 ? purchasePrice + row.homeImprovements : 0;
        const totalAssetsCB =
          row.portfolioTotal + row.cash + houseValueCostBasis + row.otherAssets;

        return {
          year: row.year,
          netWorth: row.netWorth,
          netWorthCostBasis: totalAssetsCB - totalLiabilities,
          portfolioTotal: row.portfolioTotal,
          portfolioByType: row.portfolioByType,
          cash: row.cash,
          houseValue: row.houseValue,
          houseValueCostBasis,
          mortgageBalance: row.mortgageBalance,
          otherAssets: row.otherAssets,
          otherLiabilities: row.otherLiabilities,
          totalAssets,
          totalLiabilities,
          grossIncome: row.grossIncome,
          effectiveIncome: row.effectiveIncome,
          averageAge: row.averageAge,
          combinedAgi: row.combinedAgi,
          effectiveTaxRate: row.effectiveTaxRate ?? 0,
          taxesPaid: row.taxesPaid ?? 0,
          isCurrent: row.isCurrent,
        };
      });

      return { years: history, primaryBirthYear };
    }),

  /** Extended history with per-category performance breakdowns and tax location data.
   *  Used by the spreadsheet view; heavier than listHistory (which feeds charts). */
  computeDetailedHistory: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [yearEndHistory, people] = await Promise.all([
        buildYearEndHistory(ctx.db, ctx.scope.asOf, {
          budgetProfileId: input?.budgetProfileId,
          budgetColumn: input?.budgetColumn,
        }),
        getAllPeople(ctx.db),
      ]);

      const primaryPerson = getPrimaryPerson(people);
      const primaryBirthYear = primaryPerson
        ? calendarYear(primaryPerson.dateOfBirth)
        : null;

      // Pass through YearEndRow data — all metrics already computed by buildYearEndHistory
      const history = yearEndHistory.map((row) => ({
        year: row.year,
        netWorth: row.netWorth,
        netWorthCostBasis: row.netWorthCostBasis,
        netWorthMarket: row.netWorthMarket,
        houseValueCostBasis: row.houseValueCostBasis,
        portfolioTotal: row.portfolioTotal,
        portfolioByType: row.portfolioByType,
        cash: row.cash,
        houseValue: row.houseValue,
        mortgageBalance: row.mortgageBalance,
        otherAssets: row.otherAssets,
        otherLiabilities: row.otherLiabilities,
        grossIncome: row.grossIncome,
        combinedAgi: row.combinedAgi,
        isCurrent: row.isCurrent,
        perfLastUpdated: row.perfLastUpdated,
        perfContributions: row.perfContributions,
        perfGainLoss: row.perfGainLoss,
        performanceByCategory: row.performanceByCategory,
        performanceByParentCategory: row.performanceByParentCategory,
        portfolioByTaxLocation: row.portfolioByTaxLocation,
        ytdRatio: row.ytdRatio,
        // Pre-computed metrics (single computation path)
        wealthScoreMarket: row.wealthScoreMarket,
        wealthScoreCostBasis: row.wealthScoreCostBasis,
        aawScoreMarket: row.aawScoreMarket,
        aawScoreCostBasis: row.aawScoreCostBasis,
        fiProgress: row.fiProgress,
        fiTarget: row.fiTarget,
        averageAge: row.averageAge,
        effectiveIncome: row.effectiveIncome,
        lifetimeEarnings: row.lifetimeEarnings,
      }));

      return { years: history, primaryBirthYear };
    }),
};
