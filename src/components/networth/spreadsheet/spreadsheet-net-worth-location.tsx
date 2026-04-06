"use client";

/** Net Worth Location YTD — percentages of total assets by category. */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import type { DetailedHistoryRow } from "./types";

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  useMarketValue: boolean;
};

type LocationRow = {
  label: string;
  accessor: (row: DetailedHistoryRow) => number;
};

function buildLocationRows(useMarketValue: boolean): LocationRow[] {
  return [
    {
      label: "House",
      accessor: (r) => (useMarketValue ? r.houseValue : r.houseValueCostBasis),
    },
    { label: "Portfolio", accessor: (r) => r.portfolioTotal },
    { label: "Cash", accessor: (r) => r.cash },
    { label: "Other Assets", accessor: (r) => r.otherAssets },
    { label: "Other Liabilities", accessor: (r) => r.otherLiabilities },
  ];
}

export function SpreadsheetNetWorthLocation({
  yearA,
  yearB,
  useMarketValue,
}: Props) {
  const locationRows = useMemo(
    () => buildLocationRows(useMarketValue),
    [useMarketValue],
  );

  const houseA = useMarketValue ? yearA.houseValue : yearA.houseValueCostBasis;
  const houseB = useMarketValue ? yearB.houseValue : yearB.houseValueCostBasis;
  const grossAssetsA =
    yearA.portfolioTotal + houseA + yearA.cash + yearA.otherAssets;
  const grossAssetsB =
    yearB.portfolioTotal + houseB + yearB.cash + yearB.otherAssets;

  return (
    <Card title="Net Worth Location - YTD" className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 pr-2 text-muted font-medium" />
              <th className="text-right py-1.5 px-2 text-muted font-medium w-20">
                {yearA.year}
              </th>
              <th className="text-right py-1.5 pl-2 text-muted font-medium w-20">
                {yearB.year}
              </th>
            </tr>
          </thead>
          <tbody>
            {locationRows.map((row, index) => {
              const valA = row.accessor(yearA);
              const valB = row.accessor(yearB);
              // Skip rows where both years have zero
              if (valA === 0 && valB === 0) return null;
              const pctA = grossAssetsA > 0 ? valA / grossAssetsA : 0;
              const pctB = grossAssetsB > 0 ? valB / grossAssetsB : 0;

              return (
                <tr
                  key={row.label}
                  className={`border-b border-subtle ${index % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
                >
                  <td className="py-1.5 pr-2 text-secondary font-medium">
                    {row.label}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    {row.label === "Other Liabilities"
                      ? formatCurrency(valA)
                      : formatPercent(pctA)}
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {row.label === "Other Liabilities"
                      ? formatCurrency(valB)
                      : formatPercent(pctB)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
