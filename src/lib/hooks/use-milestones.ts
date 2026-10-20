"use client";

/**
 * The household's milestones, judged once by `evaluateMilestones()` from the
 * same queries the dashboard already runs (React Query shares them). Fetching
 * only — every figure is mapped by `buildMilestoneInput()` and judged by the
 * pure engine, so the Milestones page and the Financial Checkup agree.
 */
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { DEFAULT_HIGH_INCOME_THRESHOLD } from "@/lib/constants";
import { SK_HIGH_INCOME_THRESHOLD } from "@/lib/constants/settings-keys";
import { buildMilestoneInput } from "@/lib/pure/milestone-input";
import {
  evaluateMilestones,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/milestones";

/** The contribution-summary input every dashboard card sends. */
export function useContributionSummaryInput() {
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const { queryInput: contribProfileInput } = useEffectiveContribProfileId();
  return {
    ...contribProfileInput,
    ...salaryProfileInput,
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];
}

/**
 * The household's milestones. Rows that need data a viewer may not see
 * (linked holdings: portfolio; brokerage goals: brokerage) are gated here,
 * once, so every caller — Milestones page, Checkup, Recommendations — judges
 * the same set.
 */
export function useMilestones(): {
  isLoading: boolean;
  /** Expected dates are still coming (the projection is computing). */
  projectionLoading: boolean;
  error: boolean;
  input: MilestoneInput | null;
  results: MilestoneResult[];
} {
  const user = useUser();
  const withHoldings = hasPermission(user, "portfolio");
  const withBrokerageGoals = hasPermission(user, "brokerage");
  const contribInput = useContributionSummaryInput();
  const [efundBudgetColumn] = usePersistedSetting<number>(
    "efund_budget_column",
    -1,
  );
  const [highIncomeThreshold] = usePersistedSetting<number>(
    SK_HIGH_INCOME_THRESHOLD,
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  const yearEndTargeting = useYearEndTargetingInput();

  const inputs = trpc.milestones.computeInputs.useQuery(yearEndTargeting);
  const contribs = trpc.contribution.computeSummary.useQuery(contribInput);
  const savings = trpc.savings.computeSummary.useQuery(
    efundBudgetColumn >= 0
      ? { budgetTierOverride: efundBudgetColumn }
      : undefined,
  );
  const mortgage = trpc.mortgage.computeActiveSummary.useQuery();
  const projection = useDashboardProjection();
  const holdings = trpc.investments.getHoldingsOverview.useQuery(undefined, {
    enabled: withHoldings,
  });
  const brokerageGoals = trpc.brokerage.listGoals.useQuery(undefined, {
    enabled: withBrokerageGoals,
  });

  // The projection and holdings only add expected dates and the investing
  // rows — the rest renders without them.
  const isLoading =
    inputs.isLoading ||
    contribs.isLoading ||
    savings.isLoading ||
    mortgage.isLoading;
  const error = Boolean(
    inputs.error || contribs.error || savings.error || mortgage.error,
  );
  const projectionLoading = projection.isLoading;
  if (isLoading || error || !inputs.data)
    return { isLoading, projectionLoading, error, input: null, results: [] };

  const efund = savings.data?.efund;
  const projectionData = projection.data?.result ? projection.data : null;
  const input = buildMilestoneInput({
    inputs: inputs.data,
    contributions: contribs.data ?? null,
    highIncomeThreshold,
    efundMonths: efund
      ? (efund.monthsCoveredWithRepay ?? efund.monthsCovered)
      : null,
    mortgage: mortgage.data ?? null,
    projection: projectionData?.result
      ? {
          projectionByYear: projectionData.result.projectionByYear,
          annualInflation: Number(projectionData.settings.annualInflation) || 0,
        }
      : null,
    holdings: withHoldings ? (holdings.data ?? null) : null,
    brokerageGoals: !withBrokerageGoals
      ? null
      : (brokerageGoals.data?.map((g) => ({
          name: g.name,
          targetYear: g.targetYear,
        })) ?? null),
  });
  return {
    isLoading,
    projectionLoading,
    error,
    input,
    results: evaluateMilestones(input),
  };
}
