"use client";

/**
 * The paycheck summary the Household Income card shows — active salaries,
 * the effective salary/contribution profiles and the Paycheck page's tax
 * year. The card and the Roth IRA recommendation read it through here so
 * React Query shares one request.
 */
import { trpc } from "@/lib/trpc";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { SK_PAYCHECK_TAX_YEAR } from "@/lib/constants/settings-keys";

export function useHouseholdIncomeSummary() {
  const salaryActiveFields = useActiveSalaries();
  // Independent axes, each Plan pin -> globally-active setting.
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const { contributionProfileId, queryInput: contribProfileInput } =
    useEffectiveContribProfileId();
  // The Paycheck page's tax year, so net pay and the taxes agree.
  const [taxYearSetting] = usePersistedSetting<number | null>(
    SK_PAYCHECK_TAX_YEAR,
    null,
  );
  const queryInput = {
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...contribProfileInput,
    ...salaryProfileInput,
    ...(taxYearSetting != null ? { taxYearOverride: taxYearSetting } : {}),
  };
  const query = trpc.paycheck.computeSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
  );
  return { ...query, contributionProfileId };
}
