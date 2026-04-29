"use client";

import React from "react";
import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";

interface SavingsGoalSummary {
  name: string;
  monthlyAllocation: number;
  current: number;
  target: number;
  progress: number;
  monthsToTarget: number | null;
}

interface EfundData {
  trueBalance: number;
  monthsCovered: number | null;
  targetMonths: number;
  progress: number;
  neededAfterRepay: number;
}

export function SummaryCards({
  savings,
  efund,
}: {
  savings: {
    totalSaved: number;
    goals: SavingsGoalSummary[];
    warnings: string[];
  };
  efund: EfundData | null;
}) {
  const pool = savings.goals.reduce((s, g) => s + g.monthlyAllocation, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card title="Total Saved">
        <Metric value={formatCurrency(savings.totalSaved)} />
        {efund && (
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Emergency Fund</span>
              <span className="text-secondary tabular-nums">
                {formatCurrency(efund.trueBalance)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Sinking Funds</span>
              <span className="text-secondary tabular-nums">
                {formatCurrency(savings.totalSaved - efund.trueBalance)}
              </span>
            </div>
          </div>
        )}
      </Card>
      <Card
        title={
          <>
            Monthly Pool
            <HelpTip text="Total amount allocated to sinking funds each month across all goals" />
          </>
        }
      >
        <Metric
          value={formatCurrency(pool)}
          label="Total monthly contributions"
        />
        <div className="mt-2 space-y-1">
          {savings.goals
            .filter((g) => g.monthlyAllocation > 0)
            .map((g) => {
              const pct = pool > 0 ? (g.monthlyAllocation / pool) * 100 : 0;
              return (
                <div key={g.name} className="flex justify-between text-xs">
                  <span className="text-muted">{g.name}</span>
                  <span className="text-secondary tabular-nums">
                    {formatCurrency(g.monthlyAllocation)}{" "}
                    <span className="text-muted">
                      ({formatPercent(pct / 100)})
                    </span>
                  </span>
                </div>
              );
            })}
        </div>
      </Card>
      {efund && (
        <Card
          title={
            <>
              Emergency Fund
              <HelpTip text="How many months of essential expenses your emergency fund can cover" />
            </>
          }
        >
          <Metric
            value={`${efund.monthsCovered !== null ? efund.monthsCovered.toFixed(1) : "---"} months`}
            label={`Target: ${efund.targetMonths} months`}
          />
          <div className="mt-2">
            <ProgressBar
              value={efund.progress}
              color={efund.progress >= 1 ? "bg-green-500" : "bg-amber-500"}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
