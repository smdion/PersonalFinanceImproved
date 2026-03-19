"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel, TAX_PIE_COLORS, CHART_COLORS } from "@/lib/utils/colors";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

export function TaxLocationPie({
  byTaxType,
  portfolioTotal,
}: {
  byTaxType: Map<string, number>;
  portfolioTotal: number;
}) {
  const data = useMemo(() => {
    return Array.from(byTaxType.entries())
      .filter(([, v]) => v > 0)
      .map(([type, value]) => ({
        name: taxTypeLabel(type),
        value,
        color: TAX_PIE_COLORS[type] ?? CHART_COLORS.piOther,
      }))
      .sort((a, b) => b.value - a.value);
  }, [byTaxType]);

  if (data.length === 0) return null;

  return (
    <Card
      title={
        <>
          Tax Location{" "}
          <HelpTip text="How your investment portfolio is distributed across tax treatments: Traditional (pre-tax), Roth (tax-free), HSA, and After-Tax (brokerage)" />
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
                  {formatPercent(
                    portfolioTotal > 0 ? d.value / portfolioTotal : 0,
                  )}
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
