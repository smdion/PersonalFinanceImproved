"use client";

import { FocusLink } from "@/components/ui/focus-link";
import { useState } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { RetirementBridge } from "./retirement-bridge";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  CHECKPOINT_SOURCES,
  FIDELITY_CHECKPOINTS,
  MONEY_GUY_CHECKPOINTS,
  type CheckpointSource,
} from "@/lib/config/milestones";
import {
  checkpointBalance,
  incomeMultipleTarget,
  type MilestoneYear,
} from "@/lib/pure/milestones";

/** A projection with its settings (not the no-people stub). */
type Projection = Extract<
  RouterOutputs["projection"]["computeProjection"],
  { settings: unknown }
>;

const stop = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** The household's chosen income-multiple table and today's figures for it
 *  (the Milestones engine's current year), plus every account's projection
 *  for Money Guy's liquid-investments measure. */
type ReadinessCheckpoint = {
  source: CheckpointSource;
  now: MilestoneYear | null;
  allAccountsByYear: { age: number; allAccountsBalance: number }[];
};

/**
 * Savings vs the household's chosen income-multiple targets (Money Guy or
 * Fidelity — Milestones page), now or at a projected age (from the same
 * projection the Retirement card shows).
 */
function Readiness({
  data,
  currentAge,
  retirementSavings,
  checkpoint,
}: {
  data: Projection;
  currentAge: number;
  retirementSavings: number;
  checkpoint: ReadinessCheckpoint;
}) {
  const [projectedAge, setProjectedAge] = useState<number | null>(null);
  const { combinedSalary, settings, result } = data;
  const { source, now } = checkpoint;
  const table =
    source === "moneyGuy" ? MONEY_GUY_CHECKPOINTS : FIDELITY_CHECKPOINTS;
  const currentYear = new Date().getFullYear();
  const viewAge = projectedAge ?? currentAge;
  const projecting = projectedAge !== null && projectedAge > currentAge;
  const yearData = projecting
    ? result?.projectionByYear.find((y) => y.age === projectedAge)
    : undefined;
  // Money Guy counts every account plus cash (held flat); Fidelity only the
  // Retirement accounts this card already projects.
  const projectedBalance =
    source === "moneyGuy"
      ? (checkpoint.allAccountsByYear.find((y) => y.age === projectedAge)
          ?.allAccountsBalance ?? 0) + (now?.cash ?? 0)
      : yearData?.retirementBalance;
  const portfolio = projecting
    ? (projectedBalance ?? 0)
    : now
      ? checkpointBalance(source, now)
      : retirementSavings;
  const salary =
    yearData?.phase === "accumulation"
      ? yearData.projectedSalary
      : !projecting && now
        ? now.grossIncome
        : combinedSalary;
  const actual = safeDivide(portfolio, salary, 0);
  const targetMultiple = incomeMultipleTarget(table, viewAge);
  const gap = portfolio - salary * targetMultiple;
  const onTrack = gap >= 0;
  const maxAge = Math.max(settings.retirementAge, table[table.length - 1]!.age);
  const { label, measures, milestoneId } = CHECKPOINT_SOURCES[source];

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted text-sm">
          Readiness
          <HelpTip
            text={`${measures[0]!.toUpperCase()}${measures.slice(1)} as a multiple of gross pay, against ${label}'s age targets (${table.map((t) => `${t.multiple}× by ${t.age}`).join(", ")}). Change the table on the Milestones page. Pick a future age to see your projected standing.`}
          />
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
        <FocusLink
          focus={{ topic: "milestone", milestoneId }}
          className={`text-xl font-bold hover:underline ${onTrack ? "text-green-600" : "text-amber-600"}`}
          title={`See the ${label} checkpoints on Milestones`}
        >
          {formatNumber(actual, 1)}x
        </FocusLink>
        <span className="text-muted text-xs">
          {projectedAge !== null ? "projected " : ""}of {formatCurrency(salary)}{" "}
          pay · {label}
        </span>
      </div>
      <ProgressBar
        value={Math.min(safeDivide(actual, targetMultiple, 0), 1)}
        label={`Target ${formatNumber(targetMultiple, 1)}x at age ${viewAge} · ${onTrack ? "ahead by" : "gap"} ${formatCurrency(Math.abs(gap))}`}
        variant={onTrack ? "success" : "warning"}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {table.map((t) => (
          <span
            key={t.age}
            className={`text-caption rounded px-1.5 py-0.5 ${
              viewAge >= t.age && actual >= t.multiple
                ? "bg-green-100 text-green-700"
                : viewAge >= t.age
                  ? "bg-amber-100 text-amber-700"
                  : "bg-surface-elevated text-faint"
            }`}
          >
            {t.age}: {t.multiple}x
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
        <span className="text-muted text-xs" data-privacy-visible>
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
  checkpoint: ReadinessCheckpoint;
}) {
  return (
    <div className="space-y-4">
      <Readiness {...props} />
      <Growth data={props.data} currentAge={props.currentAge} />
      {props.data.result && (
        <RetirementBridge projection={props.data.result.projectionByYear} />
      )}
    </div>
  );
}
