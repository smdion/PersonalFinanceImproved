"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { LocationPie } from "@/components/charts/location-pie";
import { taxTypeLabel, TAX_PIE_COLORS, CHART_COLORS } from "@/lib/utils/colors";

export function TaxLocationPie({
  byTaxType,
  portfolioTotal,
  yearLabel,
}: {
  byTaxType: Map<string, number>;
  portfolioTotal: number;
  yearLabel?: number;
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
          <HelpTip text="How your investment portfolio is distributed across tax treatments: Traditional (pre-tax), Roth (tax-free), HSA, and After-tax (brokerage)" />
        </>
      }
      subtitle={yearLabel != null ? `${yearLabel} data` : undefined}
    >
      <LocationPie label="Tax location" data={data} total={portfolioTotal} />
    </Card>
  );
}
