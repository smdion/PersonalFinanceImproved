"use client";

/** Spreadsheet-style dashboard view for the Trends page.
 *  Two-column layout: tables on left, charts on right.
 *  Reuses existing chart components — no reimplementation. */

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { SpreadsheetControls } from "./spreadsheet-controls";
import { useScenario } from "@/lib/context/scenario-context";
import { SpreadsheetYearOverYearTable } from "./spreadsheet-year-over-year-table";
import { SpreadsheetHealthStats } from "./spreadsheet-health-stats";
import { SpreadsheetTaxLocation } from "./spreadsheet-tax-location";
import { SpreadsheetNetWorthLocation } from "./spreadsheet-net-worth-location";
import {
  NetWorthLineChart,
  JourneyToAbundanceChart,
  NetWorthLocationPie,
  TaxLocationPie,
} from "@/components/networth";
import type { HistoryRow } from "@/components/networth/types";
import type { DetailedHistoryRow } from "./types";

type Props = {
  /** Chart-ready history rows (from listHistory). */
  displayHistory: HistoryRow[] | undefined;
  /** Primary person's birth year for Journey to Abundance and age calculations. */
  primaryBirthYear: number | null;
  /** Current portfolio total (for pie charts). */
  portfolioTotal: number;
  /** Display home value (market or cost basis). */
  displayHomeValue: number;
  /** Current cash value. */
  cash: number;
  /** Current other assets value. */
  otherAssets: number;
  /** Portfolio broken down by tax type. */
  byTaxType: Map<string, number>;
  /** Market value toggle state. */
  useMarketValue: boolean;
  /** Toggle market value. */
  onToggleMarketValue: () => void;
};

export function SpreadsheetView({
  displayHistory,
  primaryBirthYear,
  portfolioTotal,
  displayHomeValue,
  cash,
  otherAssets,
  byTaxType,
  useMarketValue,
  onToggleMarketValue,
}: Props) {
  const utils = trpc.useUtils();
  const { data: detailedData } =
    trpc.networth.computeDetailedHistory.useQuery();
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();

  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      utils.settings.appSettings.invalidate();
      utils.networth.invalidate();
    },
  });

  // Salary averaging toggle
  const useSalaryAverage = useMemo(() => {
    const setting = appSettings?.find(
      (s: { key: string }) => s.key === "use_salary_average_3_year",
    );
    return setting?.value === 1;
  }, [appSettings]);

  const handleToggleSalaryAverage = useCallback(() => {
    upsertSetting.mutate({
      key: "use_salary_average_3_year",
      value: useSalaryAverage ? 0 : 1,
    });
  }, [upsertSetting, useSalaryAverage]);

  // Available years from detailed history
  const availableYears = useMemo(
    () => detailedData?.years.map((h) => h.year) ?? [],
    [detailedData],
  );

  // Global view mode from scenario context (Projected Year vs Actual YTD)
  const { viewMode } = useScenario();

  // Year selection state — default to two most recent years
  const [yearA, setYearA] = useState<number | null>(null);
  const [yearB, setYearB] = useState<number | null>(null);

  const effectiveYearA =
    yearA ??
    (availableYears.length > 0
      ? availableYears[availableYears.length - 1]!
      : 0);
  const effectiveYearB =
    yearB ??
    (availableYears.length > 1
      ? availableYears[availableYears.length - 2]!
      : 0);

  // Find history rows for selected years
  const yearARow = useMemo(
    () =>
      detailedData?.years.find((h) => h.year === effectiveYearA) as
        | DetailedHistoryRow
        | undefined,
    [detailedData, effectiveYearA],
  );
  const yearBRow = useMemo(
    () =>
      detailedData?.years.find((h) => h.year === effectiveYearB) as
        | DetailedHistoryRow
        | undefined,
    [detailedData, effectiveYearB],
  );

  if (!detailedData || availableYears.length < 2 || !yearARow || !yearBRow) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        Need at least two years of data for the spreadsheet view.
      </p>
    );
  }

  return (
    <div>
      <SpreadsheetControls
        availableYears={availableYears}
        yearA={effectiveYearA}
        yearB={effectiveYearB}
        onYearAChange={setYearA}
        onYearBChange={setYearB}
        useMarketValue={useMarketValue}
        onToggleMarketValue={onToggleMarketValue}
        useSalaryAverage={useSalaryAverage}
        onToggleSalaryAverage={handleToggleSalaryAverage}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: tables */}
        <div className="space-y-0">
          <SpreadsheetYearOverYearTable
            yearA={yearARow}
            yearB={yearBRow}
            annualize={viewMode === "projected"}
          />

          <SpreadsheetHealthStats
            yearA={yearARow}
            yearB={yearBRow}
            annualize={viewMode === "projected"}
          />

          <SpreadsheetTaxLocation
            yearA={yearARow.portfolioByTaxLocation}
            yearB={yearBRow.portfolioByTaxLocation}
            yearALabel={yearARow.year}
            yearBLabel={yearBRow.year}
          />

          <SpreadsheetNetWorthLocation yearA={yearARow} yearB={yearBRow} />
        </div>

        {/* Right column: charts (reusing existing components) */}
        <div className="space-y-4">
          {displayHistory && displayHistory.length > 1 && (
            <NetWorthLineChart history={displayHistory} />
          )}

          {displayHistory && displayHistory.length > 1 && primaryBirthYear && (
            <JourneyToAbundanceChart
              history={displayHistory}
              primaryBirthYear={primaryBirthYear}
            />
          )}

          <div className="grid grid-cols-1 gap-4">
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
        </div>
      </div>
    </div>
  );
}
