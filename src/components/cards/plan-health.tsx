"use client";

/**
 * PlanHealthCard — single point of UI integration for the plan-health
 * helpers (account order, confidence band, strategy recommendation,
 * glide path) and the rosy-assumption detector. Renders 0-N callouts
 * based on the user's plan state.
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

import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
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
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import { STATUS_COLORS } from "@/lib/utils/colors";

interface PlanHealthCardProps {
  /** Accumulation account order. If absent, the account-order callout is hidden. */
  accumulationOrder?: readonly string[];
  /** Primary user's current age + stock %. Both required for the glide-path check. */
  currentAge?: number;
  stockAllocationPercent?: number;
  /** User-set assumptions for rosy-detection. */
  returnRate?: number;
  inflationRate?: number;
  salaryGrowthRate?: number;
  /** Retirement horizon for strategy recommendation. */
  retirementHorizonYears?: number;
  hasBudgetLink?: boolean;
  /** True when the household has a non-zero Social Security benefit configured. */
  hasSocialSecurity?: boolean;
  /** Deterministic nest-egg estimate to derive a band around. */
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
  const colors =
    severity === "danger"
      ? STATUS_COLORS.red
      : severity === "warn"
        ? STATUS_COLORS.amber
        : STATUS_COLORS.blue;
  const cls = `${colors.bg} ${colors.text} border ${colors.border}`;
  return (
    <div className={`text-sm rounded px-3 py-2 ${cls}`} role="note">
      {children}
    </div>
  );
}

export function PlanHealthCard(props: PlanHealthCardProps) {
  const callouts: React.ReactNode[] = [];

  // Contribution order
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

  // Glide path
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

  // Rosy assumptions (a nudge — full stress-test view is the side panel)
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

  // Recommended strategy
  let strategyRec: WithdrawalStrategyRecommendation | null = null;
  if (typeof props.retirementHorizonYears === "number") {
    strategyRec = recommendWithdrawalStrategy({
      retirementHorizonYears: props.retirementHorizonYears,
      hasBudgetLink: props.hasBudgetLink ?? false,
      hasSocialSecurity: props.hasSocialSecurity ?? false,
      mostlyTaxAdvantaged: false,
    });
    callouts.push(
      <CalloutLine key="m4-strategy" severity="info">
        <strong>Recommended strategy:</strong> {strategyRec.label}.{" "}
        {strategyRec.rationale}
      </CalloutLine>,
    );
  }

  // Projection band
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
 * Stress test panel. Compares the user's
 * current assumptions against the canonical conservative / baseline /
 * optimistic scenarios from src/lib/pure/stress-test.ts.
 *
 * Fires the projection.computeStressTest endpoint which re-runs the
 * deterministic engine three times (once per scenario). The resulting
 * nest egg per scenario is rendered alongside the parameter set so
 * users see real outcomes, not just inputs.
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
  const scenarios = getStressTestScenarios();
  const {
    data: stressData,
    isLoading: stressLoading,
    isError: stressError,
  } = trpc.projection.computeStressTest.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const resultByLabel = new Map(
    (stressData?.scenarios ?? []).map((s) => [s.label, s]),
  );

  return (
    <div className="mt-4 border-t pt-3">
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
              <th scope="col" className="py-2 px-2 font-medium">
                Nest egg
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
                  <td className="py-2 px-2">—</td>
                </tr>
              )}
            {scenarios.map((s) => {
              const result = resultByLabel.get(s.label);
              return (
                <tr key={s.label} className="border-b border-subtle">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-faint text-caption">
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
                  <td className="py-2 px-2 font-medium">
                    {stressLoading
                      ? "…"
                      : stressError
                        ? "Error"
                        : result
                          ? formatCurrency(result.nestEggAtRetirement)
                          : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-label text-faint italic">
          Conservative ≈ bottom-decile of historical 30-year outcomes. If your
          plan only works in the baseline or optimistic case, consider lowering
          your return rate or raising your withdrawal buffer.
        </p>
      </div>
    </div>
  );
}
