"use client";

/**
 * PlanHealthCard — single point of UI integration for the v0.5
 * expert-review helpers M1, M3, M4, M6, and the M2 rosy-assumption
 * detector. Renders 0-N callouts based on the user's plan state.
 *
 * Each callout uses a distinct severity color and a one-line action.
 * The card is intentionally minimal (no charts, no interactivity)
 * because its purpose is to surface analytical findings the helpers
 * already computed — not to be a feature surface itself.
 *
 * To use:
 *   <PlanHealthCard
 *     accumulationOrder={settings.accountOrder}
 *     currentAge={primaryAge}
 *     stockAllocationPercent={...}
 *     returnRate={settings.returnRate}
 *     inflationRate={settings.inflationRate}
 *     salaryGrowthRate={settings.salaryGrowthRate}
 *     retirementHorizonYears={settings.endAge - settings.retirementAge}
 *     hasBudgetLink={!!data.accumulationBudgetProfileId}
 *     deterministicNestEgg={projection.atRetirement.balance}
 *   />
 *
 * Each prop is optional — the card only renders the callouts whose
 * inputs are present, so call sites can pass a partial set as the
 * data becomes available.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { validateContributionOrder } from "@/lib/pure/contributions";
import { checkGlidePath } from "@/lib/pure/glide-path";
import {
  detectRosyAssumptions,
  getStressTestScenarios,
  type RosyAssumptionFlag,
} from "@/lib/pure/stress-test";
import {
  recommendWithdrawalStrategy,
  type WithdrawalStrategyRecommendation,
} from "@/lib/pure/withdrawal-strategy-recommendation";
import { deriveProjectionBand } from "@/lib/pure/projection-bands";
import { formatPercent } from "@/lib/utils/format";

interface PlanHealthCardProps {
  /** v0.5 M1 — accumulation account order. If absent, M1 callout is hidden. */
  accumulationOrder?: readonly string[];
  /** v0.5 M6 — primary user's current age + stock %. Both required for the glide-path check. */
  currentAge?: number;
  stockAllocationPercent?: number;
  /** v0.5 M2 — user-set assumptions for rosy-detection. */
  returnRate?: number;
  inflationRate?: number;
  salaryGrowthRate?: number;
  /** v0.5 M4 — retirement horizon for strategy recommendation. */
  retirementHorizonYears?: number;
  hasBudgetLink?: boolean;
  /** v0.5 M3 — deterministic nest-egg estimate to derive a band around. */
  deterministicNestEgg?: number;
  /** Optional rangeFraction override for the band (default 0.25). */
  bandRangeFraction?: number;
}

function CalloutLine({
  severity,
  children,
}: {
  severity: "info" | "warn" | "danger";
  children: React.ReactNode;
}) {
  const cls =
    severity === "danger"
      ? "bg-red-50 text-red-700 border border-red-200"
      : severity === "warn"
        ? "bg-amber-50 text-amber-800 border border-amber-200"
        : "bg-blue-50 text-blue-700 border border-blue-200";
  return (
    <div className={`text-sm rounded px-3 py-2 ${cls}`} role="note">
      {children}
    </div>
  );
}

export function PlanHealthCard(props: PlanHealthCardProps) {
  const callouts: React.ReactNode[] = [];

  // M1: contribution order
  if (props.accumulationOrder && props.accumulationOrder.length > 0) {
    const orderWarnings = validateContributionOrder(props.accumulationOrder);
    for (const w of orderWarnings) {
      callouts.push(
        <CalloutLine key={`m1-${w.category}`} severity={w.severity}>
          <strong>Contribution order:</strong> {w.message}
        </CalloutLine>,
      );
    }
  }

  // M6: glide path
  if (
    typeof props.currentAge === "number" &&
    typeof props.stockAllocationPercent === "number"
  ) {
    const glide = checkGlidePath(
      props.currentAge,
      props.stockAllocationPercent,
    );
    if (glide) {
      callouts.push(
        <CalloutLine key="m6-glide" severity={glide.severity}>
          <strong>Allocation:</strong> {glide.message}
        </CalloutLine>,
      );
    }
  }

  // M2: rosy assumptions (a nudge — full stress-test view is the side panel)
  if (
    typeof props.returnRate === "number" &&
    typeof props.inflationRate === "number" &&
    typeof props.salaryGrowthRate === "number"
  ) {
    const rosy: RosyAssumptionFlag[] = detectRosyAssumptions(
      props.returnRate,
      props.inflationRate,
      props.salaryGrowthRate,
    );
    for (const f of rosy) {
      callouts.push(
        <CalloutLine key={`m2-${f.field}`} severity="warn">
          <strong>Assumptions:</strong> {f.message}
        </CalloutLine>,
      );
    }
  }

  // M4: recommended strategy
  let strategyRec: WithdrawalStrategyRecommendation | null = null;
  if (typeof props.retirementHorizonYears === "number") {
    strategyRec = recommendWithdrawalStrategy({
      retirementHorizonYears: props.retirementHorizonYears,
      hasBudgetLink: props.hasBudgetLink ?? false,
      hasSocialSecurity: false,
      mostlyTaxAdvantaged: false,
    });
    callouts.push(
      <CalloutLine key="m4-strategy" severity="info">
        <strong>Recommended strategy:</strong> {strategyRec.label}.{" "}
        {strategyRec.rationale}
      </CalloutLine>,
    );
  }

  // M3: projection band
  let band: ReturnType<typeof deriveProjectionBand> | null = null;
  if (
    typeof props.deterministicNestEgg === "number" &&
    props.deterministicNestEgg > 0
  ) {
    band = deriveProjectionBand(
      props.deterministicNestEgg,
      props.bandRangeFraction,
    );
  }

  // Don't render the card at all if there's nothing to say.
  if (callouts.length === 0 && !band) return null;

  return (
    <Card title="Plan health">
      {band && (
        <div className="mb-3 text-sm text-secondary">
          <strong>Nest egg estimate:</strong> {band.label}
        </div>
      )}
      <div className="space-y-2">{callouts}</div>
      <StressTestPanel
        userReturnRate={props.returnRate}
        userInflationRate={props.inflationRate}
        userSalaryGrowth={props.salaryGrowthRate}
      />
    </Card>
  );
}

/**
 * Stress test panel (v0.5 expert-review M2). Toggleable view that
 * compares the user's current assumptions against the canonical
 * conservative / baseline / optimistic scenarios from
 * src/lib/pure/stress-test.ts. Doesn't re-run the projection itself
 * — that's a follow-up. Renders the parameter sets side-by-side so
 * users can see how their inputs compare to historical tail-risk
 * outcomes.
 */
function StressTestPanel({
  userReturnRate,
  userInflationRate,
  userSalaryGrowth,
}: {
  userReturnRate?: number;
  userInflationRate?: number;
  userSalaryGrowth?: number;
}) {
  const [open, setOpen] = useState(false);
  const scenarios = getStressTestScenarios();

  return (
    <div className="mt-4 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-xs font-semibold text-blue-700 hover:text-blue-800 underline"
      >
        {open ? "Hide" : "Show"} stress test comparison
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table
            className="w-full text-xs"
            aria-label="Stress test parameter comparison"
          >
            <caption className="sr-only">
              Compares the user&apos;s assumptions to canonical conservative,
              baseline, and optimistic stress-test scenarios.
            </caption>
            <thead>
              <tr className="text-left text-faint border-b">
                <th scope="col" className="py-2 pr-2 font-medium">
                  Scenario
                </th>
                <th scope="col" className="py-2 px-2 font-medium">
                  Return
                </th>
                <th scope="col" className="py-2 px-2 font-medium">
                  Inflation
                </th>
                <th scope="col" className="py-2 px-2 font-medium">
                  Salary growth
                </th>
                <th scope="col" className="py-2 px-2 font-medium">
                  Withdrawal
                </th>
              </tr>
            </thead>
            <tbody>
              {typeof userReturnRate === "number" &&
                typeof userInflationRate === "number" &&
                typeof userSalaryGrowth === "number" && (
                  <tr className="border-b border-subtle bg-blue-50">
                    <td className="py-2 pr-2 font-semibold">Your plan</td>
                    <td className="py-2 px-2">
                      {formatPercent(userReturnRate, 1)}
                    </td>
                    <td className="py-2 px-2">
                      {formatPercent(userInflationRate, 1)}
                    </td>
                    <td className="py-2 px-2">
                      {formatPercent(userSalaryGrowth, 1)}
                    </td>
                    <td className="py-2 px-2">—</td>
                  </tr>
                )}
              {scenarios.map((s) => (
                <tr key={s.label} className="border-b border-subtle">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-faint text-[10px]">
                      {s.description}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    {formatPercent(s.returnRate, 1)}
                  </td>
                  <td className="py-2 px-2">
                    {formatPercent(s.inflationRate, 1)}
                  </td>
                  <td className="py-2 px-2">
                    {formatPercent(s.salaryGrowthRate, 1)}
                  </td>
                  <td className="py-2 px-2">
                    {formatPercent(s.withdrawalRate, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-faint italic">
            Conservative ≈ bottom-decile of historical 30-year outcomes. If your
            plan only works in the baseline or optimistic case, consider
            lowering your return rate or raising your withdrawal buffer.
          </p>
        </div>
      )}
    </div>
  );
}
