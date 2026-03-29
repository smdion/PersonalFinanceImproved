"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { LoadingCard, ErrorCard } from "./utils";

export function DollarMultiplierCard() {
  const salaryOverrides = useSalaryOverrides();
  const engineInput = salaryOverrides.length > 0 ? { salaryOverrides } : {};
  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
  const [calcAmount, setCalcAmount] = useState("");
  const [calcYears, setCalcYears] = useState("");
  if (isLoading) return <LoadingCard title="Growth Factor" />;
  if (error)
    return <ErrorCard title="Growth Factor" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Growth Factor" href="/retirement">
        <p className="text-sm text-faint">
          Configure retirement settings to see how your investments grow over
          time.
        </p>
      </Card>
    );

  const { settings, returnRateSummary, people } = data;
  const currentYear = new Date().getFullYear();
  const currentAge = Math.round(
    people.reduce((s, p) => s + (currentYear - p.birthYear), 0) /
      (people.length || 1),
  );
  const yearsToRetirement = Math.max(0, settings.retirementAge - currentAge);
  const avgReturn = returnRateSummary.avgAccumulation;
  const multiplier = Math.pow(1 + avgReturn, yearsToRetirement);

  // Quick calculator
  const calcAmt = parseFloat(calcAmount) || 0;
  const calcYrs = parseFloat(calcYears) || yearsToRetirement;
  const calcResult = calcAmt * Math.pow(1 + avgReturn, calcYrs);

  return (
    <Card
      title={
        <>
          Growth Factor
          <HelpTip
            text="Every dollar you invest today grows over time. This shows how much $1 invested now could be worth by retirement — the longer it grows, the more powerful the effect of compound interest."
            learnMoreHref="/retirement/accumulation-methodology"
          />
        </>
      }
      href="/retirement"
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold text-green-600">
          ${formatNumber(multiplier, 2)}
        </span>
        <span className="text-sm text-muted">
          per $1 at age {settings.retirementAge}
        </span>
      </div>
      <p className="text-xs text-faint mb-3">
        {yearsToRetirement} yrs to retirement (age {settings.retirementAge}) at{" "}
        {formatPercent(avgReturn, 1)} avg return
        {people.length > 1 && (
          <span className="block">
            Based on avg age {currentAge} across{" "}
            {people.map((p) => p.name).join(" &")}
          </span>
        )}
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted shrink-0">$</span>
          <input
            type="number"
            placeholder="amount"
            value={calcAmount}
            onChange={(e) => setCalcAmount(e.target.value)}
            onClick={(e) => e.preventDefault()}
            className="w-24 px-2 py-1 border rounded bg-surface-primary text-sm"
          />
          <span className="text-muted shrink-0">in</span>
          <input
            type="number"
            placeholder={String(yearsToRetirement)}
            value={calcYears}
            onChange={(e) => setCalcYears(e.target.value)}
            onClick={(e) => e.preventDefault()}
            className="w-16 px-2 py-1 border rounded bg-surface-primary text-sm"
          />
          <span className="text-muted shrink-0">yrs</span>
        </div>
        {calcAmt > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">
              {formatCurrency(calcAmt)} → {calcYrs} yrs
            </span>
            <span className="text-green-600 font-semibold">
              {formatCurrency(calcResult)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-3 pt-2 border-t border-subtle space-y-1 text-xs text-muted">
        {yearsToRetirement > 5 && (
          <div className="flex justify-between">
            <span>In 5 years</span>
            <span>
              $
              {formatNumber(
                Math.pow(1 + avgReturn, Math.max(0, yearsToRetirement - 5)),
                2,
              )}{" "}
              per $1
            </span>
          </div>
        )}
        {yearsToRetirement > 10 && (
          <div className="flex justify-between">
            <span>In 10 years</span>
            <span>
              $
              {formatNumber(
                Math.pow(1 + avgReturn, Math.max(0, yearsToRetirement - 10)),
                2,
              )}{" "}
              per $1
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
