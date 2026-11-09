"use client";

/**
 * PlanHealthCard: 0-N callouts from the plan-health helpers (account order, strategy, glide path)
 * and the rosy-assumption detector. Every prop is optional; a callout renders only when its
 * inputs are present.
 */

import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { trpc } from "@/lib/trpc";
import { validateContributionOrder } from "@/lib/pure/contributions/contribution-order";
import { checkGlidePath } from "@/lib/pure/simulation/glide-path";
import {
  detectRosyAssumptions,
  getStressTestScenarios,
  type RosyAssumptionFlag,
} from "@/lib/pure/simulation/stress-test";
import {
  recommendWithdrawalStrategy,
  type WithdrawalStrategyRecommendation,
} from "@/lib/pure/retirement/withdrawal-strategy-recommendation";
import {
  formatPercent,
  formatCurrency,
  maskAmountsInText,
} from "@/lib/utils/format";
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
    <div className={`rounded px-3 py-2 text-sm ${cls}`} role="note">
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

  // A common starting point for the withdrawal strategy
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
        <strong>A common starting point:</strong> {strategyRec.label}.{" "}
        {maskAmountsInText(strategyRec.rationale)}
      </CalloutLine>,
    );
  }

  // Don't render the card at all if there's nothing to say.
  if (callouts.length === 0) return null;

  return (
    <Card title="Projection health">
      <div className="space-y-2">{callouts}</div>
      <StressTestPanel
        userReturnRate={props.returnRate}
        userInflationRate={props.inflationRate}
        userSalaryGrowth={props.salaryGrowthRate}
      />
      <Disclaimer className="mt-3" />
    </Card>
  );
}

/**
 * Stress test panel: projection.computeStressTest reruns the deterministic engine once per
 * conservative/baseline/optimistic scenario; each nest egg shows beside its parameters.
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
            <tr className="text-faint border-b text-left">
              <th scope="col" className="py-2 pr-2 font-medium">
                Scenario
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Return
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Inflation
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Salary growth
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Withdrawal
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Nest egg
              </th>
            </tr>
          </thead>
          <tbody>
            {typeof userReturnRate === "number" &&
              typeof userInflationRate === "number" &&
              typeof userSalaryGrowth === "number" && (
                <tr className="border-subtle border-b bg-blue-50">
                  <td className="py-2 pr-2 font-semibold">Your projection</td>
                  <td className="px-2 py-2">
                    {formatPercent(userReturnRate, 1)}
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(userInflationRate, 1)}
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(userSalaryGrowth, 1)}
                  </td>
                  <td className="px-2 py-2">—</td>
                  <td className="px-2 py-2">—</td>
                </tr>
              )}
            {scenarios.map((s) => {
              const result = resultByLabel.get(s.label);
              return (
                <tr key={s.label} className="border-subtle border-b">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-faint text-caption">
                      {s.description}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(s.returnRate, 1)}
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(s.inflationRate, 1)}
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(s.salaryGrowthRate, 1)}
                  </td>
                  <td className="px-2 py-2">
                    {formatPercent(s.withdrawalRate, 1)}
                  </td>
                  <td className="px-2 py-2 font-medium">
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
        <p className="text-label text-faint mt-2 italic">
          Conservative ≈ bottom-decile of historical 30-year outcomes. If your
          plan only works in the baseline or optimistic case, consider lowering
          your return rate or raising your withdrawal buffer.
        </p>
      </div>
    </div>
  );
}
