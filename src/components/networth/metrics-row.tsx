"use client";

import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { wealthScoreTier } from "@/lib/config/display-labels";

export function MetricsRow({
  wealthScore,
  wealthTarget,
  aawScore,
  fiProgress,
  fiTarget,
  netWorthMarket,
  netWorthCostBasis,
}: {
  wealthScore: number;
  wealthTarget: number;
  aawScore: number;
  fiProgress: number;
  fiTarget: number;
  netWorthMarket: number;
  netWorthCostBasis: number;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <Card
        title={
          <>
            Wealth Score{" "}
            <HelpTip text="From The Millionaire Next Door -- compares your net worth to what's expected for your age and income. 1x or above means you're a prodigious accumulator of wealth." />
          </>
        }
      >
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{wealthScore.toFixed(2)}x</span>
        </div>
        <p className="text-sm text-muted mt-1">
          Target: {formatCurrency(wealthTarget)}
        </p>
        <p className="text-xs text-faint mt-0.5">
          AAW Score: {aawScore.toFixed(1)}x
        </p>
        <div className="mt-2">
          <ProgressBar
            value={Math.min(wealthScore, 2) / 2}
            label={wealthScoreTier(wealthScore).label}
            color={
              wealthScoreTier(wealthScore).tier === "uaw"
                ? "bg-red-500"
                : "bg-green-500"
            }
          />
        </div>
      </Card>

      <Card
        title={
          <>
            FI Progress{" "}
            <HelpTip text="How close you are to financial independence. FI target = annual expenses / withdrawal rate (set in Retirement settings)." />
          </>
        }
      >
        <Metric
          value={formatPercent(fiProgress)}
          label={`Target: ${formatCurrency(fiTarget)}`}
        />
        <div className="mt-2">
          <ProgressBar
            value={fiProgress}
            color={fiProgress >= 1 ? "bg-green-500" : "bg-indigo-600"}
          />
        </div>
      </Card>

      <Card
        title={
          <>
            Both Views{" "}
            <HelpTip text="Market value uses current prices; cost basis uses what you originally paid. The difference is unrealized gains." />
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted">Market Value</span>
            <span className="font-medium">
              {formatCurrency(netWorthMarket)}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted">Cost Basis</span>
            <span className="font-medium">
              {formatCurrency(netWorthCostBasis)}
            </span>
          </div>
          <div className="flex justify-between py-1 text-xs text-faint">
            <span>Difference</span>
            <span>{formatCurrency(netWorthMarket - netWorthCostBasis)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
