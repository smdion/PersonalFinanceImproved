"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { LocationPie } from "@/components/charts/location-pie";
import { sumBy } from "@/lib/utils/math";
import { CHART_COLORS } from "@/lib/utils/colors";

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
      <LocationPie label="Net worth location" data={data} total={total} />
    </Card>
  );
}
