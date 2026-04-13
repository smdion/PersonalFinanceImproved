"use client";

/** Net worth dashboard displaying historical charts, account breakdowns, and future projections. */

import { useState, useMemo, useCallback } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import dynamic from "next/dynamic";
import { EmptyState } from "@/components/ui/empty-state";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { NetWorthCompare } from "@/components/cards/net-worth-compare";
import {
  NetWorthComposition,
  AssetsLiabilitiesCards,
  MetricsRow,
  YoYTable,
  FinancialIndependenceCard,
} from "@/components/networth";

// Code-split Recharts-heavy chart components into separate chunks (v0.5
// expert-review M8). Each chart is ~250KB of bundle when bundled into the
// page bundle; lazy-loading them via next/dynamic moves them to dedicated
// chunks that load only when the page mounts. ssr:false because Recharts
// isn't SSR-friendly.
const NetWorthLineChart = dynamic(
  () =>
    import("@/components/networth/net-worth-line-chart").then((m) => ({
      default: m.NetWorthLineChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
const JourneyToAbundanceChart = dynamic(
  () =>
    import("@/components/networth/journey-to-abundance-chart").then((m) => ({
      default: m.JourneyToAbundanceChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
const NetWorthLocationPie = dynamic(
  () =>
    import("@/components/networth/net-worth-location-pie").then((m) => ({
      default: m.NetWorthLocationPie,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
const TaxLocationPie = dynamic(
  () =>
    import("@/components/networth/tax-location-pie").then((m) => ({
      default: m.TaxLocationPie,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
import { SpreadsheetView } from "@/components/networth/spreadsheet";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { projectFIYear } from "@/lib/calculators/fi-projection";
import { safeDivide } from "@/lib/utils/math";

export default function NetWorthPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.networth.computeSummary.useQuery();
  const { data: historyData } = trpc.networth.listHistory.useQuery();
  const primaryBirthYear = historyData?.primaryBirthYear;
  const [budgetColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: budgetColumn,
  });
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();
  const [useMarketValue, setUseMarketValue] = useState(true);
  const [viewMode, setViewMode] = usePersistedSetting<"cards" | "spreadsheet">(
    "networth_view_mode",
    "cards",
  );
  const [chartXAxis, setChartXAxis] = useState<"year" | "age">("year");
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      utils.networth.invalidate();
      utils.settings.appSettings.invalidate();
    },
  });

  // useMemo must be called before any early returns to preserve hook order
  const displayHistory = useMemo(() => {
    const h = historyData?.years;
    if (!h || useMarketValue) return h;
    return h.map((row) => ({
      ...row,
      houseValue: row.houseValueCostBasis ?? row.houseValue,
      netWorth: row.netWorthCostBasis ?? row.netWorth,
    }));
  }, [historyData, useMarketValue]);

  const handleSettingUpdate = useCallback(
    (key: string, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        upsertSetting.mutate({ key, value: num });
      }
    },
    [upsertSetting],
  );

  // Derive flat byTaxType from portfolioByTaxLocation (single source — no duplicate computation)
  const byTaxType = useMemo(() => {
    const loc = data?.portfolioByTaxLocation;
    if (!loc) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const bucket of [loc.retirement, loc.portfolio]) {
      for (const [key, val] of Object.entries(bucket)) {
        map.set(key, (map.get(key) ?? 0) + val);
      }
    }
    return map;
  }, [data?.portfolioByTaxLocation]);

  const currentExpenseColumn = useMemo(() => {
    const setting = appSettings?.find(
      (s: { key: string }) => s.key === "expenses_budget_column",
    );
    return typeof setting?.value === "number" ? setting.value : 0;
  }, [appSettings]);

  const availableYears = useMemo(
    () => displayHistory?.map((h) => h.year),
    [displayHistory],
  );

  // Projected FI year from two most recent history years
  const fiProjection = useMemo(() => {
    if (!displayHistory || displayHistory.length < 2 || !data) return undefined;
    const sorted = [...displayHistory].sort((a, b) => b.year - a.year);
    const current = sorted[0]!;
    const prior = sorted[1]!;
    const fiTarget = data.result?.fiTarget ?? 0;
    if (fiTarget <= 0) return undefined;
    const currentFI = Number(
      safeDivide(current.portfolioTotal + current.cash, fiTarget) ?? 0,
    );
    const priorFI = Number(
      safeDivide(prior.portfolioTotal + prior.cash, fiTarget) ?? 0,
    );
    return projectFIYear(currentFI, priorFI, current.year, prior.year);
  }, [displayHistory, data]);

  // Finalized-only FI projection (from two most recent finalized years — excludes current partial year)
  // Single computation, passed to both FI Card and SpreadsheetView health stats
  const fiProjectionFinalized = useMemo(() => {
    if (!displayHistory || !data) return undefined;
    const finalized = displayHistory
      .filter((h) => !h.isCurrent)
      .sort((a, b) => b.year - a.year);
    if (finalized.length < 2) return undefined;
    const recent = finalized[0]!;
    const prior = finalized[1]!;
    const fiTarget = data.result?.fiTarget ?? 0;
    if (fiTarget <= 0) return undefined;
    const recentFI = Number(
      safeDivide(recent.portfolioTotal + recent.cash, fiTarget) ?? 0,
    );
    const priorFI = Number(
      safeDivide(prior.portfolioTotal + prior.cash, fiTarget) ?? 0,
    );
    return {
      projection: projectFIYear(recentFI, priorFI, recent.year, prior.year),
      asOfYear: recent.year,
    };
  }, [displayHistory, data]);

  const handleExpenseColumnChange = useCallback(
    (idx: number) => {
      upsertSetting.mutate({ key: "expenses_budget_column", value: idx });
    },
    [upsertSetting],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load net worth data: {error.message}
      </p>
    );
  }

  if (!data) {
    return (
      <EmptyState
        message="No net worth data available."
        hint="Add a portfolio snapshot to start tracking net worth."
      />
    );
  }

  const {
    result,
    snapshotDate,
    performanceLastUpdated,
    portfolioTotal,
    portfolioAccounts,
    homeValueEstimated,
    homeValueConservative,
    mortgageBalance,
    cash,
    cashSource,
    otherAssets,
    otherAssetItems,
    otherAssetsSyncSource,
    otherLiabilities,
    hasHouse,
  } = data;

  const displayNetWorth = useMarketValue
    ? result.netWorthMarket
    : result.netWorthCostBasis;
  const displayHomeValue = useMarketValue
    ? homeValueEstimated
    : homeValueConservative;

  return (
    <div>
      <PageHeader
        title="Trends"
        subtitle={
          <div className="flex items-center gap-4">
            <div className="space-y-0.5">
              {snapshotDate && (
                <p>Balance updated: {formatDate(snapshotDate)}</p>
              )}
              {performanceLastUpdated && (
                <p>Performance updated: {formatDate(performanceLastUpdated)}</p>
              )}
            </div>
            <button
              onClick={() =>
                setViewMode(viewMode === "cards" ? "spreadsheet" : "cards")
              }
              className="ml-auto text-xs bg-surface-elevated hover:bg-surface-strong border rounded-full px-3 py-1 transition-colors text-muted"
              title={
                viewMode === "cards"
                  ? "Switch to spreadsheet view"
                  : "Switch to card view"
              }
            >
              {viewMode === "cards" ? "Spreadsheet View" : "Card View"}
            </button>
          </div>
        }
      />

      {/* Hero: Net Worth with toggle — always shown */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm opacity-80 uppercase tracking-wide">
            Net Worth
          </p>
          <button
            onClick={() => setUseMarketValue(!useMarketValue)}
            className="text-xs bg-surface-primary/20 hover:bg-surface-primary/30 rounded-full px-3 py-1 transition-colors"
          >
            {useMarketValue ? "Market Value" : "Cost Basis"}
          </button>
        </div>
        <p className="text-3xl sm:text-4xl font-bold">
          {formatCurrency(displayNetWorth)}
        </p>
        {hasHouse && (
          <p className="text-sm opacity-70 mt-1">
            {useMarketValue
              ? "Using current market value for home"
              : "Using purchase price + improvements for home"}
          </p>
        )}
      </div>

      {viewMode === "spreadsheet" ? (
        <SpreadsheetView
          displayHistory={displayHistory}
          primaryBirthYear={primaryBirthYear ?? null}
          portfolioTotal={portfolioTotal}
          displayHomeValue={displayHomeValue}
          cash={cash}
          otherAssets={otherAssets}
          byTaxType={byTaxType}
          useMarketValue={useMarketValue}
          onToggleMarketValue={() => setUseMarketValue(!useMarketValue)}
          fiProjectionFinalized={fiProjectionFinalized}
          chartXAxis={chartXAxis}
          onChartXAxisChange={setChartXAxis}
        />
      ) : (
        <>
          {/* Net Worth Over Time */}
          <CardBoundary title="Net Worth Charts">
            {/* Chart X-axis toggle */}
            <div className="flex justify-end mb-2">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted">X-Axis:</span>
                <button
                  onClick={() => setChartXAxis("year")}
                  className={`px-2 py-0.5 rounded-full transition-colors ${chartXAxis === "year" ? "bg-blue-600 text-white" : "bg-surface-elevated text-muted hover:bg-surface-strong"}`}
                >
                  Year
                </button>
                <button
                  onClick={() => setChartXAxis("age")}
                  className={`px-2 py-0.5 rounded-full transition-colors ${chartXAxis === "age" ? "bg-blue-600 text-white" : "bg-surface-elevated text-muted hover:bg-surface-strong"}`}
                >
                  Age
                </button>
              </div>
            </div>
            {displayHistory && displayHistory.length > 1 && (
              <NetWorthLineChart
                history={displayHistory}
                xAxisMode={chartXAxis}
                primaryBirthYear={primaryBirthYear}
              />
            )}

            {/* Journey to Abundance */}
            {displayHistory &&
              displayHistory.length > 1 &&
              primaryBirthYear && (
                <JourneyToAbundanceChart
                  history={displayHistory}
                  primaryBirthYear={primaryBirthYear}
                  xAxisMode={chartXAxis}
                />
              )}
          </CardBoundary>

          {/* Net Worth Comparison */}
          <CardBoundary title="Net Worth Comparison">
            <NetWorthCompare
              availableYears={availableYears}
              useMarketValue={useMarketValue}
            />
          </CardBoundary>

          {/* Pie Charts: Net Worth Location + Tax Location */}
          <CardBoundary title="Net Worth Allocation">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <NetWorthLocationPie
                portfolioTotal={portfolioTotal}
                houseValue={displayHomeValue}
                cash={cash}
                otherAssets={otherAssets}
              />
              <TaxLocationPie
                byTaxType={byTaxType}
                portfolioTotal={portfolioTotal}
              />
            </div>
          </CardBoundary>

          {/* Net Worth Composition */}
          <CardBoundary title="Net Worth Composition">
            <NetWorthComposition
              portfolioTotal={portfolioTotal}
              displayHomeValue={displayHomeValue}
              cash={cash}
              otherAssets={otherAssets}
              totalLiabilities={result.totalLiabilities}
              displayNetWorth={displayNetWorth}
              hasHouse={hasHouse}
            />
          </CardBoundary>

          {/* Asset & Liability breakdown */}
          <CardBoundary title="Assets & Liabilities">
            <AssetsLiabilitiesCards
              portfolioTotal={portfolioTotal}
              portfolioAccounts={portfolioAccounts}
              byTaxType={byTaxType}
              cash={cash}
              cashSource={cashSource}
              displayHomeValue={displayHomeValue}
              otherAssets={otherAssets}
              otherAssetItems={otherAssetItems}
              otherAssetsSyncSource={otherAssetsSyncSource}
              mortgageBalance={mortgageBalance}
              otherLiabilities={otherLiabilities}
              totalLiabilities={result.totalLiabilities}
              useMarketValue={useMarketValue}
              hasHouse={hasHouse}
              onSettingUpdate={handleSettingUpdate}
            />
          </CardBoundary>

          {/* Metrics row */}
          <CardBoundary title="Key Metrics">
            <MetricsRow
              wealthScore={
                useMarketValue
                  ? result.wealthScoreMarket
                  : result.wealthScoreCostBasis
              }
              aawScore={
                useMarketValue
                  ? result.aawScoreMarket
                  : result.aawScoreCostBasis
              }
              fiProgress={result.fiProgress}
              fiTarget={result.fiTarget}
              netWorthMarket={result.netWorthMarket}
              netWorthCostBasis={result.netWorthCostBasis}
            />
          </CardBoundary>

          {/* YoY History Table */}
          <CardBoundary title="Year-over-Year History">
            {displayHistory && displayHistory.length > 1 && (
              <YoYTable history={displayHistory} hasHouse={hasHouse} />
            )}
          </CardBoundary>

          {/* FI target explanation */}
          <CardBoundary title="Financial Independence">
            <FinancialIndependenceCard
              fiTarget={result.fiTarget}
              fiProgress={result.fiProgress}
              portfolioTotal={portfolioTotal}
              cash={cash}
              withdrawalRate={data.withdrawalRate}
              budgetColumnLabels={budgetData?.columnLabels}
              currentExpenseColumn={currentExpenseColumn}
              onExpenseColumnChange={handleExpenseColumnChange}
              fiProjection={fiProjection}
              fiProjectionFinalized={fiProjectionFinalized}
            />
          </CardBoundary>
        </>
      )}

      {result.warnings.length > 0 && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          {result.warnings.map((w) => (
            <p key={w} className="text-sm text-yellow-800">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
