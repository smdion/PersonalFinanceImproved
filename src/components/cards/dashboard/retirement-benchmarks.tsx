"use client";

import { useState } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";

/** A projection with its settings (not the no-people stub). */
type Projection = Extract<
  RouterOutputs["projection"]["computeProjection"],
  { settings: unknown }
>;

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

const stop = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/**
 * Retirement savings vs Fidelity's salary-multiple targets, now or at a
 * projected age (from the same projection the Retirement card shows).
 */
function Readiness({
  data,
  currentAge,
  retirementSavings,
}: {
  data: Projection;
  currentAge: number;
  retirementSavings: number;
}) {
  const [projectedAge, setProjectedAge] = useState<number | null>(null);
  const { combinedSalary, settings, result } = data;
  const currentYear = new Date().getFullYear();
  const viewAge = projectedAge ?? currentAge;
  const yearData =
    projectedAge !== null && projectedAge > currentAge
      ? result?.projectionByYear.find((y) => y.age === projectedAge)
      : undefined;
  const portfolio = yearData?.endBalance ?? retirementSavings;
  const salary =
    yearData?.phase === "accumulation"
      ? yearData.projectedSalary
      : combinedSalary;
  const actual = safeDivide(portfolio, salary, 0);
  const target = getFidelityTarget(viewAge);
  const gap = portfolio - salary * target.multiplier;
  const onTrack = gap >= 0;
  const maxAge = Math.max(
    settings.retirementAge,
    FIDELITY_TARGETS[FIDELITY_TARGETS.length - 1]!.age,
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted text-sm">
          Readiness
          <HelpTip text="Retirement savings as a multiple of salary, against Fidelity's age targets: 1× by 30, 3× by 40, 6× by 50, 10× by 67. Pick a future age to see your projected standing." />
        </span>
        <select
          className="bg-surface-primary text-secondary rounded border px-1.5 py-0.5 text-xs"
          value={projectedAge ?? ""}
          onClick={stop}
          onChange={(e) => {
            stop(e);
            setProjectedAge(e.target.value ? Number(e.target.value) : null);
          }}
        >
          <option value="">Now — age {currentAge}</option>
          {Array.from(
            { length: Math.max(0, maxAge - currentAge) },
            (_, i) => currentAge + i + 1,
          ).map((a) => (
            <option key={a} value={a}>
              Age {a} ({currentYear + a - currentAge})
              {a === settings.retirementAge ? " — retirement" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`text-xl font-bold ${onTrack ? "text-green-600" : "text-amber-600"}`}
        >
          {formatNumber(actual, 1)}x
        </span>
        <span className="text-muted text-xs">
          {projectedAge !== null ? "projected " : ""}of {formatCurrency(salary)}{" "}
          salary
        </span>
      </div>
      <ProgressBar
        value={Math.min(safeDivide(actual, target.multiplier, 0), 1)}
        label={`Target ${formatNumber(target.multiplier, 1)}x at age ${viewAge} · ${onTrack ? "ahead by" : "gap"} ${formatCurrency(Math.abs(gap))}`}
        variant={onTrack ? "success" : "warning"}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {FIDELITY_TARGETS.map((t) => (
          <span
            key={t.age}
            className={`text-caption rounded px-1.5 py-0.5 ${
              viewAge >= t.age && actual >= t.multiplier
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
    </div>
  );
}

/** What a dollar invested now grows to by retirement at the plan's average return. */
function Growth({
  data,
  currentAge,
}: {
  data: Projection;
  currentAge: number;
}) {
  const [amount, setAmount] = useState("");
  const retirementAge = data.settings.retirementAge;
  const years = Math.max(0, retirementAge - currentAge);
  const avgReturn = data.returnRateSummary?.avgAccumulation ?? 0;
  const factor = (yrs: number) => Math.pow(1 + avgReturn, Math.max(0, yrs));
  const amt = parseFloat(amount) || 0;

  return (
    <div>
      <span className="text-muted text-sm">
        Growth
        <HelpTip
          text="What $1 invested today could be worth at retirement at your plan's average return — the longer it grows, the more compounding does."
          learnMoreHref="/retirement/accumulation-methodology"
        />
      </span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-bold text-green-600" data-privacy-visible>
          ${formatNumber(factor(years), 2)}
        </span>
        <span className="text-muted text-xs">
          per $1 by age {retirementAge} · {years} yrs at{" "}
          {formatPercent(avgReturn, 1)}
        </span>
      </div>
      {years > 10 && (
        <p className="text-faint text-xs" data-privacy-visible>
          Invested in 10 years: ${formatNumber(factor(years - 10), 2)} per $1
        </p>
      )}
      <div className="mt-1 flex items-center gap-1 text-xs" onClick={stop}>
        <span className="text-muted">$</span>
        <input
          type="number"
          placeholder="amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="bg-surface-primary w-24 rounded border px-1.5 py-0.5"
        />
        {amt > 0 && (
          <span className="text-muted">
            →{" "}
            <span className="font-semibold text-green-600">
              {formatCurrency(amt * factor(years))}
            </span>{" "}
            at {retirementAge}
          </span>
        )}
      </div>
    </div>
  );
}

/** The Retirement card's benchmarks column: readiness vs age targets, and growth. */
export function RetirementBenchmarks(props: {
  data: Projection;
  currentAge: number;
  retirementSavings: number;
}) {
  return (
    <div className="space-y-4">
      <Readiness {...props} />
      <Growth data={props.data} currentAge={props.currentAge} />
    </div>
  );
}
