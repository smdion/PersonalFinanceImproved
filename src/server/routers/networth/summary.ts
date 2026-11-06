import { eq, asc, desc, and } from "drizzle-orm";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { PERF_CATEGORY_PORTFOLIO } from "@/lib/config/display-labels";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import { getEffectiveOtherAssetsDetailed } from "@/server/services/net-worth/other-assets";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import { buildYearEndHistory } from "@/server/services/net-worth/year-end-history";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import { getEffectiveOtherLiabilities } from "@/server/services/debts/other-liabilities";

export const summaryProcedures = {
  computeSummary: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [
        people,
        mortgageLoans,
        extraPayments,
        settings,
        snapshotData,
        apiConnections,
      ] = await Promise.all([
        getAllPeople(ctx.db),
        ctx.db.select().from(schema.mortgageLoans),
        ctx.db
          .select()
          .from(schema.mortgageExtraPayments)
          .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
        ctx.db.select().from(schema.appSettings),
        getLatestSnapshot(ctx.db),
        ctx.db.select().from(schema.apiConnections),
      ]);

      let portfolioTotal = 0;
      let portfolioAccountDetails: {
        institution: string;
        taxType: string;
        accountType: string;
        amount: number;
        ownerPersonId: number | null;
        category: string | null;
        accountLabel: string | null;
        ownershipType: string | null;
      }[] = [];

      if (snapshotData) {
        portfolioTotal = snapshotData.total;

        // Fetch performance accounts for category lookup
        const perfAccounts = await ctx.db
          .select()
          .from(schema.performanceAccounts);
        const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));
        const personMap = new Map(people.map((p) => [p.id, p.name]));

        portfolioAccountDetails = snapshotData.accounts.map((a) => {
          const perf = a.performanceAccountId
            ? perfMap.get(a.performanceAccountId)
            : null;
          return {
            institution: a.institution,
            taxType: a.taxType,
            accountType: a.accountType,
            amount: a.amount,
            ownerPersonId: a.ownerPersonId,
            category: perf?.parentCategory ?? null,
            // This row's own ownerPersonId must win over a shared master's
            // own ownershipType (e.g. one jointly-tracked IRA both spouses
            // hold separate snapshot rows under) — see portfolioAccountLabel.
            accountLabel: perf
              ? portfolioAccountLabel(
                  {
                    accountType: a.accountType,
                    subType: a.subType,
                    label: a.label,
                    institution: a.institution,
                  },
                  perf,
                  a.ownerPersonId,
                  personMap,
                )
              : null,
            ownershipType: perf?.ownershipType ?? null,
          };
        });
      }

      // Current-state values from app_settings (editable, not tied to year-end snapshots)
      const setting = parseAppSettings(settings);
      // Resolved once and threaded into getEffectiveCash/
      // getEffectiveCreditCardDebt below instead of each independently
      // re-querying it (previously 3 separate getActiveBudgetApi calls in
      // this one procedure).
      const { getActiveBudgetApi } = await import("@/lib/budget-api");
      const activeBudgetApi = await getActiveBudgetApi(ctx.db);
      const [
        {
          cash,
          source: cashSource,
          cacheAgeDays: cashCacheAgeDays,
          missingAccounts: cashMissingAccounts,
        },
        otherAssetsResult,
      ] = await Promise.all([
        getEffectiveCash(ctx.db, settings, activeBudgetApi),
        getEffectiveOtherAssetsDetailed(ctx.db, settings),
      ]);
      const otherAssets = otherAssetsResult.total;

      // Enrich other-asset items with API sync status (same pattern as assets.ts)
      const apiConn = apiConnections.find((c) => c.service === activeBudgetApi);
      const apiMappings = (apiConn?.accountMappings ?? []) as {
        localId?: string;
        localName?: string;
        assetId?: number;
      }[];
      const mappedAssetIds = new Set(
        apiMappings
          .filter(
            (m) =>
              m.assetId != null ||
              (m.localId ?? m.localName ?? "").startsWith("asset:"),
          )
          .map(
            (m) =>
              m.assetId ??
              parseInt((m.localId ?? m.localName ?? "").split(":")[1]!, 10),
          ),
      );
      const otherAssetItems = otherAssetsResult.items.map((item) => ({
        ...item,
        synced: item.id !== null && mappedAssetIds.has(item.id),
      }));
      const otherAssetsSyncSource =
        activeBudgetApi !== "none" ? activeBudgetApi : null;

      // Typed figure + the debts list + mapped credit cards
      // (server/services/debts/other-liabilities.ts).
      const otherLiabilitiesParts = await getEffectiveOtherLiabilities(ctx.db, {
        activeBudgetApi,
      });
      const otherLiabilities = otherLiabilitiesParts.total;
      const homeImprovements = setting("current_home_improvements", 0);

      // Home values: market (estimated) and cost basis (purchase + improvements)
      const asOfDate = ctx.scope.asOf;
      const activeMortgage = getActiveMortgageLoan(mortgageLoans);
      const homeValueEstimated = activeMortgage
        ? toNumber(
            activeMortgage.propertyValueEstimated ??
              activeMortgage.propertyValuePurchase,
          )
        : 0;
      const homeValuePurchase = activeMortgage
        ? toNumber(activeMortgage.propertyValuePurchase)
        : 0;
      const homeValueConservative = homeValuePurchase + homeImprovements;

      const mortgageBalance = computeMortgageBalance(
        mortgageLoans,
        extraPayments,
        asOfDate,
      );

      // Read computed metrics from buildYearEndHistory (single computation path)
      const yearEndHistory = await buildYearEndHistory(ctx.db, asOfDate, {
        budgetProfileId: input?.budgetProfileId,
        budgetColumn: input?.budgetColumn,
      });
      const currentRow =
        yearEndHistory.find((h) => h.isCurrent) ??
        yearEndHistory[yearEndHistory.length - 1];

      const result = currentRow
        ? {
            netWorthMarket: currentRow.netWorthMarket,
            netWorthCostBasis: currentRow.netWorthCostBasis,
            netWorth: currentRow.netWorthMarket,
            totalAssets:
              portfolioTotal + cash + homeValueEstimated + otherAssets,
            totalLiabilities: mortgageBalance + otherLiabilities,
            wealthScoreMarket: currentRow.wealthScoreMarket,
            wealthScoreCostBasis: currentRow.wealthScoreCostBasis,
            aawScoreMarket: currentRow.aawScoreMarket,
            aawScoreCostBasis: currentRow.aawScoreCostBasis,
            fiProgress: currentRow.fiProgress,
            fiTarget: currentRow.fiTarget,
            warnings: [] as string[],
          }
        : {
            netWorthMarket: 0,
            netWorthCostBasis: 0,
            netWorth: 0,
            totalAssets: 0,
            totalLiabilities: 0,
            wealthScoreMarket: 0,
            wealthScoreCostBasis: 0,
            aawScoreMarket: 0,
            aawScoreCostBasis: 0,
            fiProgress: 0,
            fiTarget: 0,
            warnings: [] as string[],
          };

      const performanceLastUpdated = currentRow?.perfLastUpdated ?? null;

      // Latest annual performance year (most recent year with data)
      const latestAnnualRow = await ctx.db
        .select({ year: schema.annualPerformance.year })
        .from(schema.annualPerformance)
        .orderBy(desc(schema.annualPerformance.year))
        .limit(1);
      const latestPerformanceYear = latestAnnualRow[0]?.year ?? null;

      // The last finalized year's total: the plan's fixed starting point.
      const a = schema.annualPerformance;
      const [finalized] = await ctx.db
        .select({ year: a.year, balance: a.endingBalance })
        .from(a)
        .where(
          and(eq(a.category, PERF_CATEGORY_PORTFOLIO), eq(a.isFinalized, true)),
        )
        .orderBy(desc(a.year))
        .limit(1);
      return {
        result,
        lastFinalized: finalized
          ? { year: finalized.year, balance: Number(finalized.balance) }
          : null,
        snapshotDate: snapshotData?.snapshot.snapshotDate ?? null,
        performanceLastUpdated,
        latestPerformanceYear,
        portfolioTotal,
        portfolioByTaxLocation: currentRow?.portfolioByTaxLocation ?? null,
        portfolioAccounts: portfolioAccountDetails,
        people: people.map((p) => ({ id: p.id, name: p.name })),
        hasHouse: !!activeMortgage,
        homeValueEstimated,
        homeValueConservative,
        mortgageBalance,
        cash,
        cashSource,
        cashCacheAgeDays,
        cashMissingAccounts,
        otherAssets,
        otherAssetItems,
        otherAssetsSyncSource,
        otherLiabilities,
        /** Its parts — the card edits only the typed figure. */
        otherLiabilitiesParts: {
          manual: otherLiabilitiesParts.manual,
          itemized: otherLiabilitiesParts.itemized,
          creditCardMapped: otherLiabilitiesParts.creditCardMapped,
        },
        withdrawalRate: currentRow?.withdrawalRate ?? DEFAULT_WITHDRAWAL_RATE,
        withdrawalRateIsDefault: currentRow?.withdrawalRateIsDefault ?? true,
      };
    }),
};
