"use client";

/**
 * CoastFireCard — compact 5th hero KPI card.
 *
 * "Coast FIRE" is the earliest age at which the user can stop contributing
 * to retirement accounts and still fund their plan through end of plan.
 * Renders inside the hero KPI grid (projection-hero-kpis.tsx) and matches
 * the shared KpiCard chrome. Shows the deterministic age + today's-$
 * supporting context, with a subtle "Validate with MC" link that fires
 * the expensive Monte Carlo binary search on-demand.
 *
 * The MC baseline (success rate / stability) is displayed in its own
 * hero KPI cards next to this one, so we don't repeat it here.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { KpiCard } from "./projection/projection-hero-kpis";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";

type CoastFireInput = Parameters<
  typeof trpc.projection.computeCoastFire.useQuery
>[0];

interface CoastFireCardProps {
  input: CoastFireInput;
  /** Unused but kept for API stability — mcBaseline metrics live in
   *  their own hero KPI cards (Success Rate, Spending Stability). */
  mcBaseline?: MonteCarloResult | null;
}

export function CoastFireCard({ input }: CoastFireCardProps) {
  const [mcClicked, setMcClicked] = useState(false);

  const { data: deterministic } = trpc.projection.computeCoastFire.useQuery(
    input,
    {
      placeholderData: (prev) => prev,
      staleTime: 60_000,
    },
  );

  const {
    data: mcData,
    isLoading: mcLoading,
    error: mcError,
  } = trpc.projection.computeCoastFireMC.useQuery(input, {
    enabled: mcClicked,
    staleTime: 5 * 60_000,
  });

  return (
    <KpiCard
      label="Coast FIRE"
      tooltip={[
        "The earliest age at which you can stop contributing and still fund your plan through end of plan.",
        "Success criterion: portfolio survives end-of-plan AND sustainable withdrawal at retirement covers projected expenses.",
        "Click 'Validate with MC' for a probabilistic answer that accounts for market uncertainty — finds the earliest age where 90% of Monte Carlo scenarios still succeed.",
      ]}
    >
      <DeterministicStatus result={deterministic?.result ?? undefined} />
      <div className="mt-auto pt-2">
        {!mcClicked && !mcData && (
          <button
            type="button"
            onClick={() => setMcClicked(true)}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline"
          >
            Validate with Monte Carlo →
          </button>
        )}
        {mcClicked && mcLoading && (
          <div className="text-[10px] text-muted animate-pulse">
            Running Monte Carlo...
          </div>
        )}
        {mcError && (
          <div className="text-[10px] text-red-500">
            MC failed: {mcError.message}
          </div>
        )}
        {mcData?.result && <MonteCarloInline result={mcData.result} />}
      </div>
    </KpiCard>
  );
}

function DeterministicStatus({
  result,
}: {
  result:
    | {
        coastFireAge: number | null;
        status: "already_coast" | "found" | "unreachable";
        sustainableWithdrawalToday: number;
        projectedExpensesAtRetirementToday: number;
      }
    | undefined;
}) {
  if (!result) {
    return <div className="text-xl font-bold tabular-nums text-faint">—</div>;
  }

  if (result.status === "unreachable") {
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-red-500">
          Not reachable
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          Plan requires contributions through retirement.
        </div>
      </>
    );
  }

  if (result.status === "already_coast") {
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-green-500">
          Already ✓
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          {formatCurrency(result.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-[10px] text-faint leading-tight">
          vs {formatCurrency(result.projectedExpensesAtRetirementToday)}{" "}
          expenses
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-xl font-bold tabular-nums text-primary">
        Age {result.coastFireAge}
      </div>
      <div className="text-[10px] text-faint mt-1 leading-tight">
        {formatCurrency(result.sustainableWithdrawalToday)}/yr sustainable
      </div>
      <div className="text-[10px] text-faint leading-tight">
        vs {formatCurrency(result.projectedExpensesAtRetirementToday)} expenses
      </div>
    </>
  );
}

function MonteCarloInline({
  result,
}: {
  result: {
    coastFireAge: number | null;
    status: "already_coast" | "found" | "unreachable";
    successRate: number;
    confidenceThreshold: number;
    warning: string | null;
  };
}) {
  const label =
    result.status === "unreachable"
      ? "MC: not reachable"
      : result.status === "already_coast"
        ? "MC: already ✓"
        : `MC age ${result.coastFireAge}`;

  const color =
    result.status === "unreachable"
      ? "text-red-500"
      : result.successRate >= 0.9
        ? "text-green-500"
        : "text-yellow-500";

  return (
    <div className="text-[10px] leading-tight">
      <span className={`font-semibold ${color}`}>{label}</span>
      <span className="text-faint ml-1">
        ({formatPercent(result.successRate, 0)} @{" "}
        {formatPercent(result.confidenceThreshold, 0)})
      </span>
      {result.warning && (
        <div className="text-yellow-500 mt-0.5">⚠ non-monotone</div>
      )}
    </div>
  );
}
