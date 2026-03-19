"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "@/lib/utils/colors";

export function NetWorthLocationPie({
  portfolioTotal,
  houseValue,
  cash,
  otherAssets,
}: {
  portfolioTotal: number;
  houseValue: number;
  cash: number;
  otherAssets: number;
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

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <Card
      title={
        <>
          Net Worth Location{" "}
          <HelpTip text="Where your net worth is held: portfolio investments, real estate, cash, and other assets" />
        </>
      }
    >
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-full sm:w-1/2">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
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
                contentStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5">
          {data.map((d) => (
            <div
              key={d.name}
              className="flex justify-between items-center text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span className="text-muted">{d.name}</span>
              </span>
              <div className="text-right">
                <span className="font-medium">
                  {formatPercent(total > 0 ? d.value / total : 0)}
                </span>
                <span className="text-xs text-faint ml-2">
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
