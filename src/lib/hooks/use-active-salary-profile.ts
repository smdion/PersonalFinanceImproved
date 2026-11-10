"use client";

import { trpc } from "@/lib/trpc";
import { useProfileIdSetting } from "@/lib/hooks/use-profile-id-setting";
import { useActiveProfileRepair } from "./use-active-profile-repair";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * The active Salary Profile ID from app_settings, repaired to the oldest
 * surviving profile if the stored id names a gone row. Independent of the
 * contribution axis (useActiveContributionProfile).
 */
export function useActiveSalaryProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  const setActive = trpc.salaryProfile.setActive.useMutation({
    // Switching the active Salary Profile changes input data for all of these,
    // not just the active pointer (see useActiveContributionProfile).
    onSuccess: () =>
      Promise.all([
        utils.settings.appSettings.list.invalidate(),
        utils.salaryProfile.invalidate(),
        utils.contribution.invalidate(),
        utils.paycheck.invalidate(),
        utils.projection.invalidate(),
        utils.retirement.invalidate(),
        utils.brokerage.invalidate(),
        utils.budget.invalidate(),
        utils.savings.invalidate(),
        utils.settings.contributionAccounts.invalidate(),
      ]),
  });
  const [activeId, setActiveId] = useProfileIdSetting(
    SK_ACTIVE_SALARY_PROFILE_ID,
    {
      // setActive accepts null to clear the selection.
      writeVia: (id) => setActive.mutateAsync({ id }),
    },
  );
  const { data: profiles } = trpc.salaryProfile.list.useQuery();

  useActiveProfileRepair("salary", activeId, profiles, setActiveId);

  return [activeId, setActiveId];
}
