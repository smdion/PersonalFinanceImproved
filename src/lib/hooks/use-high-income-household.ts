"use client";

/**
 * Whether this year's pay (salary and bonus, every person) reaches the high-income
 * line: the one value every match switch reads. Undefined until both are known;
 * `queries` go in the caller's pending gate.
 */
import { trpc } from "@/lib/trpc";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { useContributionSummaryInput } from "@/lib/hooks/use-milestones";
import {
  householdTotalCompensation,
  isHighIncomeHousehold,
} from "@/lib/pure/contributions/savings-rate";

export function useHighIncomeHousehold() {
  const line = useHighIncomeLine();
  const summary = trpc.contribution.computeSummary.useQuery(
    useContributionSummaryInput(),
  );
  const highIncome =
    summary.data === undefined || line.threshold === undefined
      ? undefined
      : isHighIncomeHousehold(
          householdTotalCompensation(summary.data.people),
          line.threshold,
        );
  return { highIncome, queries: [summary, line] };
}
