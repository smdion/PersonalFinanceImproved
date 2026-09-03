"use client";

import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { sumBy } from "@/lib/utils/math";
import { LoadingCard, ErrorCard } from "./utils";

function DollarMultiplierCardImpl() {
  const salaryActiveFields = useActiveSalaries();
  const engineInput =
    salaryActiveFields.length > 0 ? { salaryActiveFields } : {};
  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
  const [calcAmount, setCalcAmount] = useState("");
  const [calcYears, setCalcYears] = useState("");
  const [ageOverride, setAgeOverride] = useState("");
  if (isLoading) return <LoadingCard title="Growth Factor" />;
  if (error)
    return <ErrorCard title="Growth Factor" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Growth Factor" href="/retirement">
        <p className="text-faint text-sm">
          Configure retirement settings to see how your investments grow over
          time.
        </p>
      </Card>
    );

  const { settings, returnRateSummary, people } = data;
  const currentYear = new Date().getFullYear();
  const currentAge = Math.round(
    sumBy(people, (p) => currentYear - p.birthYear) / (people.length || 1),
  );
  const targetAge = parseFloat(ageOverride) || settings.retirementAge;
  const yearsToRetirement = Math.max(0, targetAge - currentAge);
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
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-green-600">
          ${formatNumber(multiplier, 2)}
        </span>
        <span className="text-muted flex items-center gap-1 text-sm">
          per $1 at age
          <input
            type="number"
            placeholder={String(settings.retirementAge)}
            value={ageOverride}
            onChange={(e) => setAgeOverride(e.target.value)}
            onClick={(e) => e.preventDefault()}
            className="bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-sm"
          />
          {ageOverride && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setAgeOverride("");
              }}
              className="text-faint hover:text-muted text-xs underline"
            >
              reset
            </button>
          )}
        </span>
      </div>
      <p className="text-faint mb-3 text-xs">
        {yearsToRetirement} yrs to age {targetAge} at{" "}
        {formatPercent(avgReturn, 1)} avg return
        {ageOverride && (
          <span className="text-faint">
            {" "}
            (retirement age is {settings.retirementAge})
          </span>
        )}
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
            className="bg-surface-primary w-24 rounded border px-2 py-1 text-sm"
          />
          <span className="text-muted shrink-0">in</span>
          <input
            type="number"
            placeholder={String(yearsToRetirement)}
            value={calcYears}
            onChange={(e) => setCalcYears(e.target.value)}
            onClick={(e) => e.preventDefault()}
            className="bg-surface-primary w-16 rounded border px-2 py-1 text-sm"
          />
          <span className="text-muted shrink-0">yrs</span>
        </div>
        {calcAmt > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">
              {formatCurrency(calcAmt)} → {calcYrs} yrs
            </span>
            <span className="font-semibold text-green-600">
              {formatCurrency(calcResult)}
            </span>
          </div>
        )}
      </div>
      <div className="border-subtle text-muted mt-3 space-y-1 border-t pt-2 text-xs">
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

export const DollarMultiplierCard = memo(DollarMultiplierCardImpl);
