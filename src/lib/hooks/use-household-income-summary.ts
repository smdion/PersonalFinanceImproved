"use client";

/**
 * The Household Income card's paycheck summary (effective profiles, the Paycheck
 * page's tax year); other readers go through here to share one request.
 */
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContributionProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { SK_PAYCHECK_TAX_YEAR } from "@/lib/constants/settings-keys";

export function useHouseholdIncomeSummary() {
  // Independent axes, each the active setting.
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const { contributionProfileId, queryInput: contributionProfileInput } =
    useEffectiveContributionProfileId();
  // The Paycheck page's tax year, so net pay and the taxes agree.
  const [taxYearSetting] = usePersistedSetting<number | null>(
    SK_PAYCHECK_TAX_YEAR,
    null,
  );
  const queryInput = {
    ...contributionProfileInput,
    ...salaryProfileInput,
    ...(taxYearSetting != null ? { taxYearOverride: taxYearSetting } : {}),
  };
  const query = trpc.paycheck.computeSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
  );
  return { ...query, contributionProfileId };
}
