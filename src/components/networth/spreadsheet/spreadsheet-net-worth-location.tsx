"use client";

/** Net Worth Location YTD — percentages of total assets by category. */

import { Card } from "@/components/ui/card";
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import type { DetailedHistoryRow } from "./types";

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
};

type LocationRow = {
  label: string;
  accessor: (row: DetailedHistoryRow) => number;
};

const LOCATION_ROWS: LocationRow[] = [
  { label: "House", accessor: (r) => r.houseValue },
  { label: "Portfolio", accessor: (r) => r.portfolioTotal },
  { label: "Cash", accessor: (r) => r.cash },
  { label: "Other Assets", accessor: (r) => r.otherAssets },
  { label: "Other Liabilities", accessor: (r) => r.otherLiabilities },
];

export function SpreadsheetNetWorthLocation({ yearA, yearB }: Props) {
  const grossAssetsA =
    yearA.portfolioTotal + yearA.houseValue + yearA.cash + yearA.otherAssets;
  const grossAssetsB =
    yearB.portfolioTotal + yearB.houseValue + yearB.cash + yearB.otherAssets;

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
            {LOCATION_ROWS.map((row) => {
              const valA = row.accessor(yearA);
              const valB = row.accessor(yearB);
              // Skip rows where both years have zero
              if (valA === 0 && valB === 0) return null;
              const pctA = grossAssetsA > 0 ? valA / grossAssetsA : 0;
              const pctB = grossAssetsB > 0 ? valB / grossAssetsB : 0;

              return (
                <tr key={row.label} className="border-b border-subtle">
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
