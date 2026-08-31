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
import {
  formatCurrency,
  formatPercent,
  formatRelativeTime,
} from "@/lib/utils/format";
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
  /** % of stop-now trials that failed specifically because penalty-exposed
   *  money was excluded (v0.7.8 penalty-hard-exclusion) rather than the
   *  household genuinely running out — surfaced so a low stopNowSuccessRate
   *  isn't read as "you'll be broke" when it actually means "your money is
   *  there but locked until 59½." */
  stopNowPenaltyAvoidedShortfallRate: number;
  /** Median dollar shortfall (today's dollars) among stop-now trials that
   *  hit a penalty-avoided shortfall — "how much," not just "how often." */
  stopNowMedianPenaltyAvoidedShortfallPV: number;
  spendingStabilityRate: number;
  confidenceThreshold: number;
  warning: string | null;
};

/** Below this fraction of stop-now trials hitting a penalty-avoided
 *  shortfall, the "why stopping today fails" explanation isn't worth
 *  surfacing — too small a share of outcomes to be the real story. Single
 *  source for both the KPI card's tooltip line and its short headline
 *  caption (previously duplicated as a literal `0.05` in each — code
 *  review, 2026-08-27). */
const COAST_FIRE_GAP_MATERIALITY_THRESHOLD = 0.05;

function hasCoastFireGapAmount(mc: CoastFireMcResult): boolean {
  return (
    mc.stopNowPenaltyAvoidedShortfallRate >
      COAST_FIRE_GAP_MATERIALITY_THRESHOLD &&
    mc.stopNowMedianPenaltyAvoidedShortfallPV > 0
  );
}

type DeterministicResult = {
  coastFireAge: number | null;
  status: "already_coast" | "found" | "unreachable";
  sustainableWithdrawalToday: number;
  projectedExpensesAtRetirementToday: number;
};

interface CoastFireCardProps {
  input: CoastFireInput;
  /** Pass-down of the Coast FIRE MC binary-search result from
   *  use-projection-queries.ts. On demand by default (2026-08-30) — fires
   *  once the household selects a Coast FIRE scenario, not on page load —
   *  so this card usually shows deterministic-only at first; the headline
   *  automatically upgrades to combined once the MC result arrives. */
  coastFireMcResult?: CoastFireMcResult;
  /** True while the shared coast MC query is fetching. */
  coastFireMcLoading?: boolean;
  /** When the Coast FIRE MC result was computed — ISO string, or null when
   *  it came from a fresh (uncached) run just now. Surfaced so the user can
   *  tell a cached result apart from a just-computed one. */
  coastFireMcComputedAt?: string | null;
}

export function CoastFireCard({
  input,
  coastFireMcResult,
  coastFireMcLoading = false,
  coastFireMcComputedAt,
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
  const hasGapAmount = mcAvailable && hasCoastFireGapAmount(coastFireMcResult);

  return (
    <KpiCard
      label="Coast FIRE"
      tooltip={[
        "The earliest age at which you can stop contributing and still fund your plan through end of plan.",
        "Success criterion: portfolio survives end-of-plan AND sustainable withdrawal at retirement covers projected expenses.",
        "Headline combines the Baseline answer (at expected returns) and the Simulated answer (90% confidence across 1,000 random market outcomes) — only shows 'Already ✓' when BOTH agree.",
        "Baseline is a single expected-return path (same math as Active Plan) — it can't see that real returns vary, so it can't detect a case that only breaks under variance. Simulated (1,000 randomized sequences) is the one actually answering whether this works in practice.",
        ...(hasGapAmount
          ? [
              `Why stopping today fails: in ${formatPercent(coastFireMcResult.stopNowPenaltyAvoidedShortfallRate, 0)} of simulated outcomes, retiring today leaves about ${formatCurrency(coastFireMcResult.stopNowMedianPenaltyAvoidedShortfallPV)} (today's $) short in the years before 59½ — money you'd have, but can't reach without a penalty. Building that much more in brokerage or Roth basis by then would close it.`,
            ]
          : []),
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
          <div className="text-caption text-muted animate-pulse">
            Running simulations...
          </div>
        )}
        {mcAvailable && (
          <SimulatedDetail
            mc={coastFireMcResult}
            computedAt={coastFireMcComputedAt}
          />
        )}
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
        <div className="text-caption text-faint mt-1 leading-tight">
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
        <div className="text-caption text-faint mt-1 leading-tight">
          {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-caption text-faint leading-tight">
          vs {formatCurrency(det.projectedExpensesAtRetirementToday)} expenses
        </div>
      </>
    );
  }

  // Baseline passes stopping today; simulated doesn't. Baseline is a
  // SINGLE expected-return path (identical math to Active Plan) — it has
  // no way to see that real returns vary, so it can't detect a case that
  // only breaks under variance. Simulated (1,000 randomized sequences) is
  // the one actually answering "does this work in practice." Kept to ONE
  // short line here (with a "?" for the full explanation + dollar figure,
  // via KpiCard's tooltip prop above) so this card doesn't blow out the
  // shared row height of the other 4 hero KPI cards next to it.
  if (det.status === "already_coast" && mc.status === "found") {
    const hasGapAmount = hasCoastFireGapAmount(mc);
    const shortLine = hasGapAmount
      ? `Stopping today: ~${formatCurrency(mc.stopNowMedianPenaltyAvoidedShortfallPV)} short before 59½ (locked, not broke)`
      : "Stopping today fails on real variance, not baseline's math";
    return (
      <>
        <div className="text-xl font-bold tabular-nums text-yellow-500">
          Age {mc.coastFireAge}
        </div>
        <div className="text-caption text-faint mt-1 leading-tight">
          {shortLine}
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
        <div className="text-caption text-faint mt-1 leading-tight">
          {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-caption text-faint leading-tight">
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
      <div className="text-caption text-faint mt-1 leading-tight">
        {formatCurrency(det.sustainableWithdrawalToday)}/yr sustainable
      </div>
      <div className="text-caption text-faint leading-tight">
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
        <div className="text-caption text-faint mt-1 leading-tight">
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
        <div className="text-caption text-faint mt-1 leading-tight">
          {formatCurrency(result.sustainableWithdrawalToday)}/yr sustainable
        </div>
        <div className="text-caption text-faint leading-tight">
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
      <div className="text-caption text-faint mt-1 leading-tight">
        {formatCurrency(result.sustainableWithdrawalToday)}/yr sustainable
      </div>
      <div className="text-caption text-faint leading-tight">
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
function SimulatedDetail({
  mc,
  computedAt,
}: {
  mc: CoastFireMcResult;
  computedAt?: string | null;
}) {
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
    <div className="text-caption leading-tight">
      <span className="text-faint">Stopping today: </span>
      <span className={`font-semibold ${stopNowColor}`}>
        {formatPercent(mc.stopNowSuccessRate, 0)} simulated
      </span>
      <span className="text-faint ml-1">{tail}</span>
      {/* Full "why" (with the dollar figure) lives in KpiCard's tooltip
          ("?") now, not inline here -- an earlier version added a 2-line
          paragraph in this spot which, stacked with CombinedStatus's own
          explanation above, roughly doubled this card's height relative to
          its 4 siblings in the hero KPI row. */}
      {mc.warning && (
        <div className="text-yellow-500 mt-0.5">⚠ non-monotone</div>
      )}
      {computedAt && (
        <div className="text-faint mt-0.5">
          Last run: {formatRelativeTime(computedAt)}
        </div>
      )}
    </div>
  );
}
