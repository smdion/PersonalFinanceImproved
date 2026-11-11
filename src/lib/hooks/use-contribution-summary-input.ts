"use client";

import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContributionProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";

/** The contribution-summary input every dashboard card sends. */
export function useContributionSummaryInput() {
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const { queryInput: contributionProfileInput } =
    useEffectiveContributionProfileId();
  return {
    ...contributionProfileInput,
    ...salaryProfileInput,
  };
}
