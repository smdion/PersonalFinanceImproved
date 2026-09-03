"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { CHART_COLORS } from "@/lib/utils/colors";

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
  // Same 4-category palette NetWorthLocationPie renders — same data,
  // same colors, so a user doesn't see Portfolio as one color in the pie
  // chart and a different one here (Batch 26 Finding 1).
  const segments = [
    {
      label: "Portfolio",
      value: portfolioTotal,
      color: CHART_COLORS.piPortfolio,
    },
    ...(hasHouse
      ? [
          {
            label: "Home",
            value: displayHomeValue,
            color: CHART_COLORS.piHouse,
          },
        ]
      : []),
    { label: "Cash", value: cash, color: CHART_COLORS.piCash },
    ...(otherAssets > 0
      ? [{ label: "Other", value: otherAssets, color: CHART_COLORS.piOther }]
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
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-secondary font-medium">Assets</span>
            <span className="font-semibold">{formatCurrency(totalAssets)}</span>
          </div>
          <div
            className="bg-surface-elevated flex h-6 overflow-hidden rounded-full"
            style={{ width: `${(totalAssets / maxBar) * 100}%` }}
          >
            {segments.map((seg) => (
              <div
                key={seg.label}
                className="h-full transition-all"
                style={{
                  width: `${safeDivide(seg.value, totalAssets, 0) * 100}%`,
                  backgroundColor: seg.color,
                }}
                title={`${seg.label}: ${formatCurrency(seg.value)}`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((seg) => (
              <div
                key={seg.label}
                className="text-muted flex items-center gap-1 text-xs"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                <span>{seg.label}</span>
                <span className="text-faint">
                  {formatPercent(safeDivide(seg.value, totalAssets, 0))}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-secondary font-medium">Liabilities</span>
            <span className="font-semibold text-red-600">
              {formatCurrency(totalLiab)}
            </span>
          </div>
          <div
            className="bg-surface-elevated h-6 overflow-hidden rounded-full"
            style={{ width: `${(totalLiab / maxBar) * 100}%` }}
          >
            <div
              className="h-full rounded-full bg-red-400"
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <div className="border-t pt-2">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-primary font-semibold">Net Worth</span>
            <span className="text-lg font-bold">
              {formatCurrency(displayNetWorth)}
            </span>
          </div>
          <div className="bg-surface-elevated h-3 overflow-hidden rounded-full">
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
