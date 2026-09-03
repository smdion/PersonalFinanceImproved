"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { sumBy } from "@/lib/utils/math";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "@/lib/utils/colors";
import { CHART_FONT } from "@/components/charts/chart-defaults";

export function NetWorthLocationPie({
  portfolioTotal,
  houseValue,
  cash,
  otherAssets,
  yearLabel,
}: {
  portfolioTotal: number;
  houseValue: number;
  cash: number;
  otherAssets: number;
  yearLabel?: number;
}) {
  const data = useMemo(() => {
    const items = [
      {
        name: "Portfolio",
        value: portfolioTotal,
        color: CHART_COLORS.piPortfolio,
      },
      { name: "House", value: houseValue, color: CHART_COLORS.piHouse },
      { name: "Cash", value: cash, color: CHART_COLORS.piCash },
    ];
    if (otherAssets > 0) {
      items.push({
        name: "Other Assets",
        value: otherAssets,
        color: CHART_COLORS.piOther,
      });
    }
    return items.filter((d) => d.value > 0);
  }, [portfolioTotal, houseValue, cash, otherAssets]);

  const total = sumBy(data, (d) => d.value);

  return (
    <Card
      title={
        <>
          Net Worth Location{" "}
          <HelpTip text="Where your net worth is held: portfolio investments, real estate, cash, and other assets" />
        </>
      }
      subtitle={yearLabel != null ? `${yearLabel} data` : undefined}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="w-full sm:w-1/2">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                dataKey="value"
                paddingAngle={2}
                label={false}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={{ fontSize: CHART_FONT.tooltip }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5">
          {data.map((d) => (
            <div
              key={d.name}
              className="flex items-center justify-between text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span className="text-muted">{d.name}</span>
              </span>
              <div className="text-right">
                <span className="font-medium">
                  {formatPercent(safeDivide(d.value, total, 0))}
                </span>
                <span className="text-faint ml-2 text-xs">
                  {formatCurrency(d.value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
