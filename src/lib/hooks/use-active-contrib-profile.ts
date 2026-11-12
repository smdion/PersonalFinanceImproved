"use client";

import { trpc } from "@/lib/trpc";
import { useProfileIdSetting } from "@/lib/hooks/use-profile-id-setting";
import { useActiveProfileRepair } from "./use-active-profile-repair";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * The active Contribution Profile ID from app_settings, repaired to a real row
 * when the stored id is gone. Use this instead of usePersistedSetting directly.
 */
export function useActiveContributionProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  const setActive = trpc.contributionProfile.setActive.useMutation({
    // Switching the active profile changes input data for every router below,
    // so their cached results are stale; the list mirrors
    // ContributionProfileManager's invalidateProfileDeps plus budget's.
    onSuccess: () =>
      Promise.all([
        utils.settings.appSettings.list.invalidate(),
        utils.contributionProfile.invalidate(),
        utils.contribution.invalidate(),
        utils.paycheck.invalidate(),
        utils.projection.invalidate(),
        utils.retirement.invalidate(),
        utils.brokerage.invalidate(),
        utils.budget.invalidate(),
        utils.savings.invalidate(),
        utils.contribution.accounts.invalidate(),
      ]),
  });
  const [activeId, setActiveId] = useProfileIdSetting(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    {
      // setActive accepts null to clear the selection.
      writeVia: (id) => setActive.mutateAsync({ id }),
    },
  );
  const { data: profiles } = trpc.contributionProfile.list.useQuery();

  useActiveProfileRepair("contribution", activeId, profiles, setActiveId);

  return [activeId, setActiveId];
}
