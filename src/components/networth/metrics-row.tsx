"use client";

import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { wealthScoreTier } from "@/lib/config/display-labels";

export function MetricsRow({
  wealthScore,
  aawScore,
  fiProgress,
  fiTarget,
  netWorthMarket,
  netWorthCostBasis,
}: {
  wealthScore: number;
  aawScore: number;
  fiProgress: number;
  fiTarget: number;
  netWorthMarket: number;
  netWorthCostBasis: number;
}) {
  const tier = wealthScoreTier(aawScore);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <Card
        title={
          <>
            Wealth Metrics{" "}
            <HelpTip text="Wealth Score = net worth as % of lifetime earnings. AAW Score = Money Guy Wealth Accumulator (2.0+ = PAW, 1.0 = AAW, <0.5 = UAW)." />
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-muted">Wealth Score</span>
            <span className="text-2xl font-bold">
              {formatPercent(wealthScore)}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-muted">AAW Score</span>
            <span className="text-2xl font-bold">{aawScore.toFixed(1)}x</span>
          </div>
        </div>
        <div className="mt-2">
          <ProgressBar
            value={Math.min(aawScore, 4) / 4}
            label={tier.label}
            color={tier.tier === "uaw" ? "bg-red-500" : "bg-green-500"}
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
