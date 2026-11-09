"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { HistoryRow } from "./types";

export function YoYTable({
  history,
  hasHouse,
}: {
  history: HistoryRow[];
  hasHouse: boolean;
}) {
  const sorted = [...history].sort((a, b) => b.year - a.year);

  return (
    <Card
      title={
        <>
          Year-over-Year{" "}
          <HelpTip text="Net worth breakdown by year with dollar and percentage changes" />
        </>
      }
      className="mb-8"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-muted py-2 pr-4 text-left font-medium">
                Year
              </th>
              <th className="text-muted px-3 py-2 text-right font-medium">
                Net Worth
              </th>
              <th className="text-muted px-3 py-2 text-right font-medium">
                Portfolio
              </th>
              {hasHouse && (
                <th className="text-muted px-3 py-2 text-right font-medium">
                  House
                </th>
              )}
              <th className="text-muted px-3 py-2 text-right font-medium">
                Cash
              </th>
              <th className="text-muted px-3 py-2 text-right font-medium">
                Liabilities
              </th>
              <th className="text-muted px-3 py-2 text-right font-medium">
                $ Chg
              </th>
              <th className="text-muted py-2 pl-3 text-right font-medium">
                % Chg
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, i) => {
              const prev = sorted[i + 1];
              const dollarChange = prev ? h.netWorth - prev.netWorth : null;
              const percentChange =
                prev && prev.netWorth !== 0
                  ? (h.netWorth - prev.netWorth) / Math.abs(prev.netWorth)
                  : null;

              return (
                <tr key={h.year} className="border-subtle border-b">
                  <td className="py-2 pr-4 font-medium">
                    {h.year}
                    {h.isCurrent && (
                      <span className="ml-1 text-xs text-blue-600">*</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatCurrency(h.netWorth)}
                  </td>
                  <td className="text-secondary px-3 py-2 text-right">
                    {formatCurrency(h.portfolioTotal)}
                  </td>
                  {hasHouse && (
                    <td className="text-secondary px-3 py-2 text-right">
                      {formatCurrency(h.houseValue)}
                    </td>
                  )}
                  <td className="text-secondary px-3 py-2 text-right">
                    {formatCurrency(h.cash)}
                  </td>
                  <td className="px-3 py-2 text-right text-red-600">
                    {formatCurrency(h.totalLiabilities)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right text-xs ${
                      dollarChange !== null
                        ? dollarChange >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-faint"
                    }`}
                  >
                    {dollarChange !== null
                      ? `${dollarChange >= 0 ? "+" : ""}${formatCurrency(dollarChange)}`
                      : "\u2014"}
                  </td>
                  <td
                    className={`py-2 pl-3 text-right text-xs ${
                      percentChange !== null
                        ? percentChange >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-faint"
                    }`}
                  >
                    {percentChange !== null
                      ? `${percentChange >= 0 ? "+" : ""}${formatPercent(percentChange, 1)}`
                      : "\u2014"}
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
