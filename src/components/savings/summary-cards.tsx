"use client";

import React from "react";
import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { HelpTip } from "@/components/ui/help-tip";
import type { GoalProjection } from "./types";

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
  goalProjections,
}: {
  savings: {
    totalSaved: number;
    goals: SavingsGoalSummary[];
    warnings: string[];
  };
  efund: EfundData | null;
  goalProjections?: GoalProjection[];
}) {
  const poolGoals: { name: string; monthlyAllocation: number }[] =
    goalProjections && goalProjections.length > 0
      ? goalProjections.map((gp) => ({
          name: gp.name,
          monthlyAllocation: gp.monthlyAllocation,
        }))
      : savings.goals;
  const pool = sumBy(poolGoals, (g) => g.monthlyAllocation);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          {poolGoals
            .filter((g) => g.monthlyAllocation > 0)
            .map((g) => {
              const pct = safeDivide(g.monthlyAllocation, pool, 0) * 100;
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
              variant={efund.progress >= 1 ? "success" : "warning"}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
