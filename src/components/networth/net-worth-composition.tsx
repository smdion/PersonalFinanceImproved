"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export function NetWorthComposition({
  portfolioTotal,
  displayHomeValue,
  cash,
  otherAssets,
  totalLiabilities,
  displayNetWorth,
  hasHouse,
}: {
  portfolioTotal: number;
  displayHomeValue: number;
  cash: number;
  otherAssets: number;
  totalLiabilities: number;
  displayNetWorth: number;
  hasHouse: boolean;
}) {
  const totalAssets =
    portfolioTotal + cash + (hasHouse ? displayHomeValue : 0) + otherAssets;
  const totalLiab = totalLiabilities;
  const maxBar = Math.max(totalAssets, totalLiab, 1);
  const segments = [
    { label: "Portfolio", value: portfolioTotal, color: "bg-indigo-500" },
    ...(hasHouse
      ? [{ label: "Home", value: displayHomeValue, color: "bg-blue-400" }]
      : []),
    { label: "Cash", value: cash, color: "bg-green-400" },
    ...(otherAssets > 0
      ? [{ label: "Other", value: otherAssets, color: "bg-gray-400" }]
      : []),
  ];

  return (
    <Card
      title={
        <>
          Net Worth Composition{" "}
          <HelpTip text="How your net worth breaks down between assets and liabilities" />
        </>
      }
      className="mb-8"
    >
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-secondary">Assets</span>
            <span className="font-semibold">{formatCurrency(totalAssets)}</span>
          </div>
          <div
            className="h-6 bg-surface-elevated rounded-full overflow-hidden flex"
            style={{ width: `${(totalAssets / maxBar) * 100}%` }}
          >
            {segments.map((seg) => (
              <div
                key={seg.label}
                className={`${seg.color} h-full transition-all`}
                style={{
                  width: `${totalAssets > 0 ? (seg.value / totalAssets) * 100 : 0}%`,
                }}
                title={`${seg.label}: ${formatCurrency(seg.value)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
            {segments.map((seg) => (
              <div
                key={seg.label}
                className="flex items-center gap-1 text-xs text-muted"
              >
                <span className={`w-2 h-2 rounded-full ${seg.color}`} />
                <span>{seg.label}</span>
                <span className="text-faint">
                  {formatPercent(totalAssets > 0 ? seg.value / totalAssets : 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-secondary">Liabilities</span>
            <span className="font-semibold text-red-600">
              {formatCurrency(totalLiab)}
            </span>
          </div>
          <div
            className="h-6 bg-surface-elevated rounded-full overflow-hidden"
            style={{ width: `${(totalLiab / maxBar) * 100}%` }}
          >
            <div
              className="bg-red-400 h-full rounded-full"
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <div className="pt-2 border-t">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-semibold text-primary">Net Worth</span>
            <span className="font-bold text-lg">
              {formatCurrency(displayNetWorth)}
            </span>
          </div>
          <div className="h-3 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${displayNetWorth >= 0 ? "bg-green-500" : "bg-red-500"}`}
              style={{
                width: `${Math.min((Math.abs(displayNetWorth) / maxBar) * 100, 100)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
