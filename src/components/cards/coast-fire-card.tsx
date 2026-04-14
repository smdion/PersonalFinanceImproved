"use client";

/**
 * CoastFireCard — compact 5th hero KPI card.
 *
 * Displays the deterministic Coast FIRE age (fast, always shown). When the
 * user triggers the Coast FIRE scenario view (via the chart scenario toggle
 * OR the "Validate with Monte Carlo" button on this card), the same
 * `computeCoastFireMC` query runs once — and its result (binary-searched
 * MC-true age + success rate) powers both this card AND the chart's MC fan
 * bands. Single MC run, no duplication.
 */

import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { KpiCard } from "./projection/projection-hero-kpis";

type CoastFireInput = Parameters<
  typeof trpc.projection.computeCoastFire.useQuery
>[0];

type CoastFireMcResult = {
  coastFireAge: number | null;
  status: "already_coast" | "found" | "unreachable";
  successRate: number;
  /** MC success rate for stopping contributions today (vs successRate which
   *  is measured at the found age). Used to surface the deterministic/MC
   *  divergence on the card: when deterministic says "already" but MC says
   *  "found at later age," stopNowSuccessRate is the rate at today. */
  stopNowSuccessRate: number;
  spendingStabilityRate: number;
  confidenceThreshold: number;
  warning: string | null;
};

type DeterministicResult = {
  coastFireAge: number | null;
  status: "already_coast" | "found" | "unreachable";
  sustainableWithdrawalToday: number;
  projectedExpensesAtRetirementToday: number;
};

interface CoastFireCardProps {
  input: CoastFireInput;
  /** Pass-down of the Coast FIRE MC binary-search result from
   *  use-projection-queries.ts. Prefetched on page load so it's usually
   *  available by the time the user looks at this card — the headline
   *  automatically upgrades from deterministic-only to combined once the
   *  MC result arrives. */
  coastFireMcResult?: CoastFireMcResult;
  /** True while the shared coast MC query is fetching. */
  coastFireMcLoading?: boolean;
}

export function CoastFireCard({
  input,
  coastFireMcResult,
  coastFireMcLoading = false,
}: CoastFireCardProps) {
  const { data: deterministic } = trpc.projection.computeCoastFire.useQuery(
    input,
    {
      placeholderData: (prev) => prev,
      staleTime: 60_000,
    },
  );

  const det = deterministic?.result ?? undefined;
  const mcAvailable = coastFireMcResult != null;

  return (
    <KpiCard
      label="Coast FIRE"
      tooltip={[
        "The earliest age at which you can stop contributing and still fund your plan through end of plan.",
        "Success criterion: portfolio survives end-of-plan AND sustainable withdrawal at retirement covers projected expenses.",
        "Headline combines the Baseline answer (at expected returns) and the Simulated answer (90% confidence across 1,000 random market outcomes) — only shows 'Already ✓' when BOTH agree.",
      ]}
    >
      {/* Headline upgrades automatically: baseline-only while simulated is
          prefetching, combined baseline+simulated once it lands. Does NOT
          show "Already ✓" unless BOTH baseline and simulated agree. */}
      {mcAvailable ? (
        <CombinedStatus det={det} mc={coastFireMcResult} />
      ) : (
        <DeterministicStatus result={det} />
      )}
      <div className="mt-auto pt-2">
        {coastFireMcLoading && !coastFireMcResult && (
          <div className="text-[10px] text-muted animate-pulse">
            Running simulations...
          </div>
        )}
        {mcAvailable && <SimulatedDetail mc={coastFireMcResult} />}
      </div>
    </KpiCard>
  );
}

/**
 * Combined headline when the simulated result is available. Refuses to
 * show "Already ✓" unless BOTH the baseline and simulated answers agree.
 * Shows the more conservative of the two ages otherwise, plus any hard
 * "unreachable" verdict.
 */
function CombinedStatus({
  det,
  mc,
}: {
  det: DeterministicResult | undefined;
  mc: CoastFireMcResult;
}) {
  // If baseline hasn't loaded, fall back to simulated-only headline.
  if (!det) {
    return <SimulatedOnlyStatus mc={mc} />;
  }

  // Either side saying "unreachable" → plan is not Coast FIRE.
  if (det.status === "unreachable" || mc.status === "unreachable") {
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-red-500">
          Not reachable
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          {mc.status === "unreachable" && det.status !== "unreachable"
            ? "Baseline says reachable but simulated outcomes fail."
            : "Plan requires contributions through retirement."}
        </div>
      </>
    );
  }

  // Both agree "already Coast FIRE" — the only case where we show the ✓.
  if (det.status === "already_coast" && mc.status === "already_coast") {
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-green-500">
          Already ✓
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-[10px] text-faint leading-tight">
          vs {formatCurrency(det.projectedExpensesAtRetirementToday)} expenses
        </div>
      </>
    );
  }

  // Baseline says "already" but simulated says "found X" — simulated is
  // more conservative because it accounts for sequence-of-returns risk.
  // Show the simulated age as the headline with a color that signals caution.
  if (det.status === "already_coast" && mc.status === "found") {
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-yellow-500">
          Age {mc.coastFireAge}
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          Baseline says today — simulated needs more margin.
        </div>
      </>
    );
  }

  // Both "found" — show the more conservative (later) age.
  if (det.status === "found" && mc.status === "found") {
    const detAge = det.coastFireAge ?? 0;
    const mcAge = mc.coastFireAge ?? 0;
    const headlineAge = Math.max(detAge, mcAge);
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-primary">
          Age {headlineAge}
        </div>
        <div className="text-[10px] text-faint mt-1 leading-tight">
          {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-[10px] text-faint leading-tight">
          vs {formatCurrency(det.projectedExpensesAtRetirementToday)} expenses
        </div>
      </>
    );
  }

  // det "found" + mc "already_coast" — unusual, MC is easier than
  // deterministic. Show the deterministic age as the conservative answer.
  return (
    <>
      <div className="text-xl font-bold tabular-nums text-primary">
        Age {det.coastFireAge}
      </div>
      <div className="text-[10px] text-faint mt-1 leading-tight">
        {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
      </div>
      <div className="text-[10px] text-faint leading-tight">
        vs {formatCurrency(det.projectedExpensesAtRetirementToday)} expenses
      </div>
    </>
  );
}

function SimulatedOnlyStatus({ mc }: { mc: CoastFireMcResult }) {
  if (mc.status === "unreachable") {
    return (
      <div className="text-xl font-bold tabular-nums text-red-500">
        Not reachable
      </div>
    );
  }
  const label =
    mc.status === "already_coast" ? "Already ✓" : `Age ${mc.coastFireAge}`;
  const color =
    mc.status === "already_coast" ? "text-green-500" : "text-primary";
  return (
    <div className={`text-xl font-bold tabular-nums ${color}`}>{label}</div>
  );
}

function DeterministicStatus({
  result,
}: {
  result: DeterministicResult | undefined;
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

/**
 * Simulated detail line (Option D format) — shown whenever the simulated
 * Coast FIRE result is available. Always shows "Stopping today: X%
 * simulated" so the user sees the raw confidence at the current age, and
 * indicates the age needed for the confidence threshold if there's a gap.
 */
function SimulatedDetail({ mc }: { mc: CoastFireMcResult }) {
  const threshold = mc.confidenceThreshold;
  const stopNowPasses = mc.stopNowSuccessRate >= threshold;
  const stopNowColor = stopNowPasses
    ? "text-green-500"
    : mc.stopNowSuccessRate >= 0.7
      ? "text-yellow-500"
      : "text-red-500";

  // Build the tail message based on status.
  let tail: string;
  if (mc.status === "unreachable") {
    tail = `— not reachable`;
  } else if (stopNowPasses) {
    tail = "✓";
  } else if (mc.status === "found" && mc.coastFireAge != null) {
    tail = `— need age ${mc.coastFireAge} for ${formatPercent(threshold, 0)}`;
  } else {
    tail = "";
  }

  return (
    <div className="text-[10px] leading-tight">
      <span className="text-faint">Stopping today: </span>
      <span className={`font-semibold ${stopNowColor}`}>
        {formatPercent(mc.stopNowSuccessRate, 0)} simulated
      </span>
      <span className="text-faint ml-1">{tail}</span>
      {mc.warning && (
        <div className="text-yellow-500 mt-0.5">⚠ non-monotone</div>
      )}
    </div>
  );
}
