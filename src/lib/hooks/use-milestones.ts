"use client";

/**
 * The household's milestones, judged by the pure engine from queries the
 * dashboard already runs, so the Milestones page and the Checkup agree.
 */
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { trpc, type RouterError } from "@/lib/trpc";
import { useIntegerSetting } from "@/lib/hooks/use-profile-id-setting";
import { useContributionSummaryInput } from "@/lib/hooks/use-contribution-summary-input";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { SK_EFUND_BUDGET_COLUMN } from "@/lib/constants/settings-keys";
import { buildMilestoneInput } from "@/lib/pure/advice/milestones/input";
import {
  evaluateMilestones,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/advice/milestones/milestones";

/**
 * The household's milestones. Rows needing data a viewer may lack (portfolio,
 * brokerage) are gated here once, so every caller judges the same set.
 */
export function useMilestones(): {
  isLoading: boolean;
  /** Expected dates are still coming (the projection is computing). */
  projectionLoading: boolean;
  /** The first of its queries' load errors. */
  error: RouterError | null;
  /** Fetches the failed queries again (a failed load's Retry). */
  refetch: () => void;
  input: MilestoneInput | null;
  results: MilestoneResult[];
} {
  const user = useUser();
  const withHoldings = hasPermission(user, "portfolio");
  const withBrokerageGoals = hasPermission(user, "brokerage");
  const contributionInput = useContributionSummaryInput();
  const [efundBudgetColumn] = useIntegerSetting(SK_EFUND_BUDGET_COLUMN, -1);
  const highIncome = useHighIncomeLine();
  const { threshold: highIncomeThreshold, error: highIncomeError } = highIncome;
  const yearEndTargeting = useYearEndTargetingInput();

  const inputs = trpc.milestones.computeInputs.useQuery(yearEndTargeting);
  const contribs = trpc.contribution.computeSummary.useQuery(contributionInput);
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
  const buyingMonths = trpc.investments.computeBuyingMonths.useQuery(
    undefined,
    {
      enabled: withHoldings,
    },
  );
  const brokerageGoals = trpc.brokerage.listGoals.useQuery(undefined, {
    enabled: withBrokerageGoals,
  });

  // The projection and holdings only add expected dates and the investing
  // rows — the rest renders without them.
  const error =
    inputs.error ??
    contribs.error ??
    savings.error ??
    mortgage.error ??
    highIncomeError;
  // An error isn't still loading — callers that check loading first would
  // otherwise show a skeleton for good.
  const isLoading =
    !error &&
    (inputs.isLoading ||
      contribs.isLoading ||
      savings.isLoading ||
      mortgage.isLoading ||
      highIncomeThreshold === undefined);
  const projectionLoading = projection.isLoading;
  const refetch = () => {
    for (const q of [inputs, contribs, savings, mortgage])
      if (q.error) void q.refetch();
    if (highIncomeError) highIncome.refetch();
  };
  if (isLoading || error || !inputs.data || highIncomeThreshold === undefined)
    return {
      isLoading,
      projectionLoading,
      error,
      refetch,
      input: null,
      results: [],
    };

  const efund = savings.data?.efund;
  const projectionData = projection.data?.result ? projection.data : null;
  const input = buildMilestoneInput({
    inputs: inputs.data,
    contributions: contribs.data ?? null,
    highIncomeThreshold,
    efundMonths: efund
      ? (efund.monthsCoveredWithRepay ?? efund.monthsCovered)
      : null,
    efundEssentialMonthly:
      efund && efund.targetMonths > 0
        ? efund.targetAmount / efund.targetMonths
        : null,
    mortgage: mortgage.data ?? null,
    projection: projectionData?.result
      ? {
          projectionByYear: projectionData.result.projectionByYear,
          annualInflation: Number(projectionData.settings.annualInflation) || 0,
        }
      : null,
    holdings: withHoldings ? (holdings.data ?? null) : null,
    buyingMonths: withHoldings ? (buyingMonths.data ?? null) : null,
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
    refetch,
    input,
    results: evaluateMilestones(input),
  };
}
