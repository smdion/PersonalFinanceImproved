"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { LoadingCard, ErrorCard } from "./utils";

/**
 * Fidelity's age-based retirement savings targets.
 * At each age, you should have X times your salary saved.
 */
const FIDELITY_TARGETS: { age: number; multiplier: number }[] = [
  { age: 30, multiplier: 1 },
  { age: 35, multiplier: 2 },
  { age: 40, multiplier: 3 },
  { age: 45, multiplier: 4 },
  { age: 50, multiplier: 6 },
  { age: 55, multiplier: 7 },
  { age: 60, multiplier: 8 },
  { age: 67, multiplier: 10 },
];

function getFidelityTarget(age: number): {
  multiplier: number;
  nextAge?: number;
  nextMultiplier?: number;
} {
  // Find the bracket the current age falls into
  let current = FIDELITY_TARGETS[0]!;
  let next: (typeof FIDELITY_TARGETS)[number] | undefined;
  for (let i = 0; i < FIDELITY_TARGETS.length; i++) {
    if (age >= FIDELITY_TARGETS[i]!.age) {
      current = FIDELITY_TARGETS[i]!;
      next = FIDELITY_TARGETS[i + 1];
    }
  }
  // Interpolate between brackets for a smooth target
  if (next && age < next.age) {
    const progress = (age - current.age) / (next.age - current.age);
    const interpolated =
      current.multiplier + progress * (next.multiplier - current.multiplier);
    return {
      multiplier: interpolated,
      nextAge: next.age,
      nextMultiplier: next.multiplier,
    };
  }
  return {
    multiplier: current.multiplier,
    nextAge: next?.age,
    nextMultiplier: next?.multiplier,
  };
}

export function FidelityMultiplierCard() {
  const salaryOverrides = useSalaryOverrides();
  const engineInput = salaryOverrides.length > 0 ? { salaryOverrides } : {};
  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
  const [projectedAge, setProjectedAge] = useState<number | null>(null);

  if (isLoading) return <LoadingCard title="Retirement Readiness" />;
  if (error)
    return <ErrorCard title="Retirement Readiness" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Retirement Readiness" href="/retirement">
        <p className="text-sm text-faint">
          Configure retirement settings to track your savings against age-based
          targets.
        </p>
      </Card>
    );

  const {
    combinedSalary,
    portfolioByTaxTypeByParentCat,
    people,
    settings,
    result,
  } = data;
  const retPortfolio = portfolioByTaxTypeByParentCat?.["Retirement"];
  const currentYear = new Date().getFullYear();
  // Average age across all people (matches engine calculation)
  const currentAge = Math.round(
    people.reduce((s, p) => s + (currentYear - p.birthYear), 0) /
      (people.length || 1),
  );
  const currentPortfolio = retPortfolio
    ? retPortfolio.preTax +
      retPortfolio.taxFree +
      retPortfolio.hsa +
      retPortfolio.afterTax
    : 0;

  // If projecting a future age, look up projected data from the engine
  const viewAge = projectedAge ?? currentAge;
  let portfolio: number;
  let salary: number;
  if (projectedAge !== null && projectedAge > currentAge) {
    const yearData = result.projectionByYear.find(
      (y) => y.age === projectedAge,
    );
    portfolio = yearData?.endBalance ?? currentPortfolio;
    salary =
      yearData?.phase === "accumulation"
        ? yearData.projectedSalary
        : combinedSalary;
  } else {
    portfolio = currentPortfolio;
    salary = combinedSalary;
  }

  const actualMultiplier = salary > 0 ? portfolio / salary : 0;
  const target = getFidelityTarget(viewAge);
  const progress =
    target.multiplier > 0 ? actualMultiplier / target.multiplier : 0;
  const isOnTrack = progress >= 1;

  // Build age options: every year from current through retirement age
  const maxAge = Math.max(
    settings.retirementAge,
    FIDELITY_TARGETS[FIDELITY_TARGETS.length - 1]!.age,
  );

  return (
    <Card
      title={
        <>
          Retirement Readiness
          <HelpTip text="Are your retirement savings on track for your age? Fidelity suggests having 1× your salary saved by 30, 3× by 40, 6× by 50, and 10× by 67. Select a future age to see your projected standing." />
        </>
      }
      href="/retirement"
    >
      {/* Age selector */}
      <div
        className="flex items-center gap-2 mb-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <label className="text-xs text-muted">Project to:</label>
        <select
          className="text-xs border rounded px-1.5 py-0.5 bg-surface-primary text-secondary"
          value={projectedAge ?? ""}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onChange={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setProjectedAge(e.target.value ? Number(e.target.value) : null);
          }}
        >
          <option value="">
            Now — age {currentAge} ({currentYear})
          </option>
          {Array.from(
            { length: maxAge - currentAge },
            (_, i) => currentAge + i + 1,
          ).map((a) => (
            <option key={a} value={a}>
              Age {a} ({currentYear + a - currentAge})
              {a === settings.retirementAge ? " — retirement" : ""}
            </option>
          ))}
        </select>
        {projectedAge !== null && (
          <span className="text-[10px] text-blue-500 font-medium">
            Projected
          </span>
        )}
      </div>
      {people.length > 1 && (
        <p className="text-[10px] text-faint mb-1">
          Age is the average across {people.map((p) => p.name).join(" &")}
        </p>
      )}

      <div className="flex items-baseline gap-2 mb-2">
        <span
          className={`text-2xl font-bold ${isOnTrack ? "text-green-600" : "text-amber-600"}`}
        >
          {formatNumber(actualMultiplier, 1)}x
        </span>
        <span className="text-sm text-muted">
          of {formatCurrency(salary)} salary
        </span>
      </div>
      <ProgressBar
        value={Math.min(progress, 1)}
        label={`Target: ${formatNumber(target.multiplier, 1)}x at age ${viewAge}`}
        color={isOnTrack ? "bg-green-500" : "bg-amber-500"}
      />
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">
            {projectedAge ? "Projected portfolio" : "Your portfolio"}
          </span>
          <span className="text-primary">{formatCurrency(portfolio)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">
            Target ({formatNumber(target.multiplier, 1)}x)
          </span>
          <span className="text-primary">
            {formatCurrency(salary * target.multiplier)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">{isOnTrack ? "Ahead by" : "Gap"}</span>
          <span
            className={
              isOnTrack
                ? "text-green-600 font-medium"
                : "text-amber-600 font-medium"
            }
          >
            {formatCurrency(Math.abs(portfolio - salary * target.multiplier))}
          </span>
        </div>
        {target.nextAge && target.nextMultiplier && (
          <div className="flex justify-between text-xs text-faint">
            <span>Next milestone (age {target.nextAge})</span>
            <span>
              {formatNumber(target.nextMultiplier, 0)}x ={" "}
              {formatCurrency(salary * target.nextMultiplier)}
            </span>
          </div>
        )}
      </div>
      {/* Fidelity milestone markers */}
      <div className="mt-3 flex gap-1 flex-wrap">
        {FIDELITY_TARGETS.map((t) => (
          <span
            key={t.age}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              viewAge >= t.age && actualMultiplier >= t.multiplier
                ? "bg-green-100 text-green-700"
                : viewAge >= t.age
                  ? "bg-amber-100 text-amber-700"
                  : "bg-surface-elevated text-faint"
            }`}
          >
            {t.age}: {t.multiplier}x
          </span>
        ))}
      </div>
    </Card>
  );
}
