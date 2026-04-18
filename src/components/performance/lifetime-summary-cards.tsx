"use client";

import React from "react";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import type { LifetimeTotals } from "./types";

export function LifetimeSummaryCards({
  totals,
  snapshotDate,
}: {
  totals: LifetimeTotals;
  snapshotDate?: string | null;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
      <Card
        title={
          <>
            Portfolio Value
            <HelpTip text="Current portfolio total from the latest snapshot. This may differ from the performance table's Ending balance, which reflects the last time performance data was manually updated." />
          </>
        }
      >
        <Metric
          value={formatCurrency(totals.endingBalance)}
          label={
            snapshotDate
              ? `As of ${new Date(snapshotDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} snapshot`
              : undefined
          }
        />
      </Card>
      <Card
        title={
          <>
            Lifetime Gains
            <HelpTip text="Total investment growth (or loss) across all years, separate from your contributions" />
          </>
        }
      >
        <Metric
          value={formatCurrency(totals.gains)}
          trend={{
            value: totals.gains >= 0 ? "Investment gains" : "Investment losses",
            positive: totals.gains >= 0,
          }}
        />
      </Card>
      <Card title="Lifetime Contributions">
        <Metric
          value={formatCurrency(totals.contributions)}
          label="Employee + employer combined"
        />
      </Card>
      <Card title="Lifetime Match">
        <Metric value={formatCurrency(totals.match)} label="Employer match" />
      </Card>
      <Card
        title={
          <>
            Lifetime Fees
            <HelpTip text="Cumulative management fees, expense ratios, and other charges deducted from your accounts" />
          </>
        }
      >
        <Metric value={formatCurrency(totals.fees)} label="Total fees paid" />
      </Card>
    </div>
  );
}
