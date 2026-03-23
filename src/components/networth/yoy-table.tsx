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
              <th className="text-left py-2 pr-4 text-muted font-medium">
                Year
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium">
                Net Worth
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium">
                Portfolio
              </th>
              {hasHouse && (
                <th className="text-right py-2 px-3 text-muted font-medium">
                  House
                </th>
              )}
              <th className="text-right py-2 px-3 text-muted font-medium">
                Cash
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium">
                Liabilities
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium">
                $ Chg
              </th>
              <th className="text-right py-2 pl-3 text-muted font-medium">
                % Chg
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, i) => {
              const prev = sorted[i + 1];
              const dollarChange = prev ? h.netWorth - prev.netWorth : null;
              const pctChange =
                prev && prev.netWorth !== 0
                  ? (h.netWorth - prev.netWorth) / Math.abs(prev.netWorth)
                  : null;

              return (
                <tr key={h.year} className="border-b border-subtle">
                  <td className="py-2 pr-4 font-medium">
                    {h.year}
                    {h.isCurrent && (
                      <span className="text-xs text-blue-600 ml-1">*</span>
                    )}
                  </td>
                  <td className="text-right py-2 px-3 font-semibold">
                    {formatCurrency(h.netWorth)}
                  </td>
                  <td className="text-right py-2 px-3 text-secondary">
                    {formatCurrency(h.portfolioTotal)}
                  </td>
                  {hasHouse && (
                    <td className="text-right py-2 px-3 text-secondary">
                      {formatCurrency(h.houseValue)}
                    </td>
                  )}
                  <td className="text-right py-2 px-3 text-secondary">
                    {formatCurrency(h.cash)}
                  </td>
                  <td className="text-right py-2 px-3 text-red-600">
                    {formatCurrency(h.totalLiabilities)}
                  </td>
                  <td
                    className={`text-right py-2 px-3 text-xs ${
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
                    className={`text-right py-2 pl-3 text-xs ${
                      pctChange !== null
                        ? pctChange >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-faint"
                    }`}
                  >
                    {pctChange !== null
                      ? `${pctChange >= 0 ? "+" : ""}${formatPercent(pctChange, 1)}`
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
