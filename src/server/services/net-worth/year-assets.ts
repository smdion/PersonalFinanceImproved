/** The asset side of each year-end row, shared by the Assets and
 *  Historical summaries: home improvements and other assets by year, and
 *  the year notes. */
import { asc } from "drizzle-orm";
import type { z } from "zod/v4";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  resolveYearAssets,
  resolveCarryForwardAssetValue,
} from "@/lib/pure/net-worth/historical";
import type { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import { buildYearEndHistory } from "@/server/services/net-worth/year-end-history";
import type { RequestScope } from "@/server/data/request-scope";
import { loansFedBySimplefin } from "@/server/services/sync/loan-feed";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { toNumber } from "@/lib/utils/numbers";
import { getActiveBudgetApi } from "@/lib/budget-api";

/** Each year-end row with its line-item asset figures, the home
 *  improvement and other-asset rows, and the notes keyed `year:field`. */
export async function loadYearAssets(
  db: Db,
  asOf: Date,
  targeting: z.output<typeof zYearEndTargeting>,
) {
  const [yearEndHistory, homeImprovements, otherAssets, noteRows] =
    await Promise.all([
      buildYearEndHistory(db, asOf, {
        budgetProfileId: targeting?.budgetProfileId,
        budgetColumn: targeting?.budgetColumn,
      }),
      db
        .select()
        .from(schema.homeImprovementItems)
        .orderBy(asc(schema.homeImprovementItems.year)),
      db
        .select()
        .from(schema.otherAssetItems)
        .orderBy(asc(schema.otherAssetItems.year)),
      db.select().from(schema.historicalNotes),
    ]);

  const notes: Record<string, string> = {};
  for (const n of noteRows) notes[`${n.year}:${n.field}`] = n.note;

  return {
    years: yearEndHistory.map((row) => ({
      row,
      assets: resolveYearAssets(row, homeImprovements, otherAssets),
    })),
    homeImprovements,
    otherAssets,
    notes,
  };
}

export async function computeAssetSummary(
  ctx: { db: Db; scope: RequestScope },
  input: z.output<typeof zYearEndTargeting>,
) {
  const [
    { years, homeImprovements, otherAssets, notes },
    apiConnections,
    mortgageLoans,
    mortgageExtras,
    allSettings,
  ] = await Promise.all([
    loadYearAssets(ctx.db, ctx.scope.asOf, input),
    ctx.db.select().from(schema.apiConnections),
    ctx.db.select().from(schema.mortgageLoans),
    ctx.db
      .select()
      .from(schema.mortgageExtraPayments)
      .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
    ctx.db.select().from(schema.appSettings),
  ]);

  const activeBudgetApi = await getActiveBudgetApi(ctx.db);

  // Build account mappings lookup from active API connection
  const conn = apiConnections.find((c) => c.service === activeBudgetApi);
  const mappings = conn?.accountMappings ?? [];
  const mappedAssetIds = new Set(
    mappings.flatMap((m) => (m.assetId != null ? [m.assetId] : [])),
  );
  const mortgageMappings = mappings.filter((m) => m.loanId != null);

  // Cash sync status
  const { cash: currentCash, source: cashSource } = await getEffectiveCash(
    ctx.db,
    allSettings,
  );

  const activeLoan = getActiveMortgageLoan(mortgageLoans);
  const houseValue = activeLoan
    ? toNumber(
        activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
      )
    : 0;
  const mortgageBalance = computeMortgageBalance(
    mortgageLoans,
    mortgageExtras,
    ctx.scope.asOf,
  );

  // Determine sync status for house value and mortgage
  const houseValueSynced = activeLoan
    ? mortgageMappings.some(
        (m) => m.loanId === activeLoan.id && m.loanMapType === "propertyValue",
      )
    : false;
  const mortgageFromFeed =
    activeLoan != null &&
    (await loansFedBySimplefin(ctx.db)).has(activeLoan.id);
  const mortgageSynced =
    mortgageFromFeed ||
    (activeLoan
      ? mortgageMappings.some(
          (m) => m.loanId === activeLoan.id && m.loanMapType === "loanBalance",
        )
      : false);

  const currentYear = ctx.scope.asOf.getFullYear();

  // Current year other asset items (carry-forward: latest value per name where year <= target)
  const uniqueAssetNames = Array.from(new Set(otherAssets.map((a) => a.name)));
  const currentOtherAssetItems: Array<{
    id: number;
    name: string;
    value: number;
    note: string | null;
    synced: boolean;
    yearRecorded: number;
  }> = [];
  for (const name of uniqueAssetNames) {
    const resolved = resolveCarryForwardAssetValue(
      otherAssets,
      name,
      currentYear,
    );
    if (resolved) {
      currentOtherAssetItems.push({
        id: resolved.id!,
        name,
        value: resolved.value,
        note: resolved.note,
        synced: mappedAssetIds.has(resolved.id!),
        yearRecorded: resolved.yearRecorded,
      });
    }
  }

  // Year-over-year history rows (compact)
  const history = years.map(({ row, assets }) => ({
    year: row.year,
    isCurrent: row.isCurrent,
    cash: row.cash,
    houseValue: row.houseValue,
    homeImprovements: assets.homeImprovements,
    homeImprovementItems: assets.homeImprovementItems,
    otherAssets: assets.otherAssets,
    otherAssetItems: assets.otherAssetItems,
    mortgageBalance: row.mortgageBalance,
    totalAssets: row.cash + row.houseValue + assets.otherAssets,
  }));

  // Current state summary (top-level)
  const latestHistory =
    history.find((h) => h.isCurrent) ?? history[history.length - 1];
  const otherAssetsTotal = currentOtherAssetItems.reduce(
    (s, i) => s + i.value,
    0,
  );

  // A house "exists" if there's an active mortgage loan OR home improvements
  const hasHouse = !!activeLoan || homeImprovements.length > 0;

  return {
    current: {
      cash: currentCash,
      cashSource,
      houseValue,
      houseValueSynced,
      mortgageBalance,
      mortgageSynced,
      mortgageFromFeed,
      houseEquity: houseValue - mortgageBalance,
      homeImprovements: latestHistory?.homeImprovements ?? 0,
      otherAssetsTotal,
      otherAssetItems: currentOtherAssetItems,
      totalAssets: currentCash + houseValue + otherAssetsTotal,
      activeLoanName: activeLoan?.name ?? null,
      activeBudgetApi,
      hasHouse,
    },
    history,
    homeImprovements: homeImprovements.map((hi) => ({
      id: hi.id,
      year: hi.year,
      description: hi.description,
      cost: toNumber(hi.cost),
      note: hi.note,
    })),
    notes,
  };
}
