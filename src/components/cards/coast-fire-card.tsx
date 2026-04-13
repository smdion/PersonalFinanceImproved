"use client";

/**
 * CoastFireCard — displays the user's Coast FIRE age.
 *
 * "Coast FIRE" is the earliest age at which the user can stop contributing
 * to retirement accounts and still fund their plan through end of plan.
 * Displays:
 *   - Deterministic Coast FIRE age (fast, always shown)
 *   - Today's-$ supporting context (deflated by the router)
 *   - Full-plan MC baseline robustness (from cached prefetch, zero cost)
 *   - Optional MC-derived Coast FIRE age at 90% confidence (on-demand button)
 *
 * The MC baseline is a pass-down prop from use-projection-queries so this
 * card doesn't fire its own duplicate query; it reuses whatever MC is
 * already running on the retirement page.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";

type CoastFireInput = Parameters<
  typeof trpc.projection.computeCoastFire.useQuery
>[0];

interface CoastFireCardProps {
  input: CoastFireInput;
  /** MC baseline from the already-running prefetch / main MC query. Optional
   *  because the card renders before MC completes on first load. */
  mcBaseline?: MonteCarloResult | null;
}

export function CoastFireCard({ input, mcBaseline }: CoastFireCardProps) {
  const [mcClicked, setMcClicked] = useState(false);

  const { data: deterministic, isLoading: detLoading } =
    trpc.projection.computeCoastFire.useQuery(input, {
      placeholderData: (prev) => prev,
      staleTime: 60_000,
    });

  const {
    data: mcData,
    isLoading: mcLoading,
    error: mcError,
  } = trpc.projection.computeCoastFireMC.useQuery(input, {
    enabled: mcClicked,
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-primary">Coast FIRE</h3>
        <p className="text-xs text-muted mt-0.5">
          The earliest age at which you can stop contributing and still fund
          your plan through end of plan.
        </p>
      </div>

      {detLoading && (
        <div className="text-xs text-muted animate-pulse">
          Calculating Coast FIRE age...
        </div>
      )}

      {deterministic?.result && (
        <DeterministicSection result={deterministic.result} />
      )}

      {mcBaseline && <FullPlanRobustnessSection baseline={mcBaseline} />}

      <div className="mt-4 pt-3 border-t border-subtle">
        {!mcClicked && !mcData && (
          <button
            type="button"
            onClick={() => setMcClicked(true)}
            className="text-xs font-medium px-3 py-1.5 rounded border border-subtle bg-surface-primary hover:bg-surface-elevated transition-colors"
          >
            Run Monte Carlo Coast FIRE
          </button>
        )}

        {mcClicked && mcLoading && (
          <div className="text-xs text-muted animate-pulse">
            Running Monte Carlo simulations — takes a few seconds...
          </div>
        )}

        {mcError && (
          <div className="text-xs text-error">
            Monte Carlo failed: {mcError.message}
          </div>
        )}

        {mcData?.result && <MonteCarloSection result={mcData.result} />}
      </div>
    </Card>
  );
}

function DeterministicSection({
  result,
}: {
  result: {
    coastFireAge: number | null;
    status: "already_coast" | "found" | "unreachable";
    sustainableWithdrawalToday: number;
    projectedExpensesAtRetirementToday: number;
  };
}) {
  if (result.status === "unreachable") {
    return (
      <div>
        <div className="text-xl font-semibold text-warning">Not reachable</div>
        <p className="text-xs text-muted mt-2">
          Your plan doesn&apos;t coast at any age — continuing contributions
          through retirement is required to fund expenses. Consider higher
          contributions, lower expenses, a later retirement age, or a longer
          horizon.
        </p>
      </div>
    );
  }

  const ageLabel =
    result.status === "already_coast"
      ? "You are already Coast FIRE"
      : `Coast FIRE age: ${result.coastFireAge}`;

  return (
    <div>
      <div className="text-xl font-semibold text-primary">{ageLabel}</div>
      <p className="text-xs text-muted mt-2">
        {result.status === "already_coast"
          ? `At expected returns, stopping today sustains ${formatCurrency(
              result.sustainableWithdrawalToday,
            )}/yr at retirement (today's $) against ${formatCurrency(
              result.projectedExpensesAtRetirementToday,
            )} projected expenses.`
          : `If you stop at ${result.coastFireAge}, your portfolio is projected to sustain ${formatCurrency(
              result.sustainableWithdrawalToday,
            )}/yr at retirement (today's $) against ${formatCurrency(
              result.projectedExpensesAtRetirementToday,
            )} projected expenses.`}
      </p>
    </div>
  );
}

function FullPlanRobustnessSection({
  baseline,
}: {
  baseline: MonteCarloResult;
}) {
  // The MC baseline describes the FULL plan (contributions continuing) —
  // not the Coast FIRE scenario. Useful as a sanity check: if the full
  // plan is shaky under MC, Coast FIRE is shakier.
  return (
    <div className="mt-3 text-xs text-muted">
      <div className="font-medium text-secondary mb-1">
        Full plan robustness (Monte Carlo baseline)
      </div>
      <div className="flex gap-4">
        <span>
          Success rate:{" "}
          <span className="text-primary">
            {formatPercent(baseline.successRate, 0)}
          </span>
        </span>
        <span>
          Spending stability:{" "}
          <span className="text-primary">
            {formatPercent(baseline.spendingStabilityRate, 0)}
          </span>
        </span>
      </div>
      <p className="text-[10px] text-faint mt-1">
        Describes your current plan with contributions continuing, not the Coast
        FIRE scenario. Run Monte Carlo Coast FIRE below for the true
        probabilistic answer.
      </p>
    </div>
  );
}

function MonteCarloSection({
  result,
}: {
  result: {
    coastFireAge: number | null;
    status: "already_coast" | "found" | "unreachable";
    successRate: number;
    spendingStabilityRate: number;
    confidenceThreshold: number;
    probesRun: number;
    warning: string | null;
  };
}) {
  if (result.status === "unreachable") {
    return (
      <div className="mt-3">
        <div className="text-sm font-medium text-warning">
          Monte Carlo: not reachable at{" "}
          {formatPercent(result.confidenceThreshold, 0)} confidence
        </div>
        <p className="text-xs text-muted mt-1">
          Even stopping the year before retirement, Monte Carlo success rate
          stays below {formatPercent(result.confidenceThreshold, 0)}. Your plan
          has sequence-of-returns risk that the deterministic view doesn&apos;t
          capture.
        </p>
      </div>
    );
  }

  const ageLabel =
    result.status === "already_coast"
      ? "Already Coast FIRE under Monte Carlo"
      : `Monte Carlo Coast FIRE age: ${result.coastFireAge}`;

  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-primary">{ageLabel}</div>
      <div className="text-xs text-muted mt-1 flex gap-4">
        <span>
          Success rate:{" "}
          <span className="text-primary">
            {formatPercent(result.successRate, 0)}
          </span>
        </span>
        <span>
          Spending stability:{" "}
          <span className="text-primary">
            {formatPercent(result.spendingStabilityRate, 0)}
          </span>
        </span>
      </div>
      <p className="text-[10px] text-faint mt-1">
        At {formatPercent(result.confidenceThreshold, 0)} confidence threshold.
        Binary-searched with {result.probesRun} Monte Carlo probes at 1000
        trials each, shared seed.
      </p>
      {result.warning && (
        <p className="text-[10px] text-warning mt-1">⚠ {result.warning}</p>
      )}
    </div>
  );
}
