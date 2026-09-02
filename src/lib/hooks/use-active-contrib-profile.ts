"use client";

import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
import { useActiveProfileRepair } from "./use-active-profile-repair";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * Hook that reads the active Contribution Profile ID from app_settings and
 * keeps it pointing at a real row. See useActiveSalaryProfile's docblock —
 * same contract on the other axis: the setting is never a sentinel, and this
 * is the repair path for an id that names a row which is gone.
 *
 * Use this instead of calling usePersistedSetting('active_contrib_profile_id')
 * directly — it adds deleted-profile detection.
 */
export function useActiveContribProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  const setActive = trpc.contributionProfile.setActive.useMutation({
    // Switching the active Contribution Profile changes real input data for
    // every one of these — not just "which profile is active" (that part is
    // settings.appSettings.list, invalidated below). Without busting them
    // too, an activation looks like it silently didn't take: the pointer
    // flips but paycheck/contribution/retirement/projection/brokerage/
    // budget/savings numbers already in the query cache keep showing
    // whatever they computed under the PREVIOUS active profile until some
    // unrelated navigation happens to refetch them. Mirrors
    // ContributionProfileManager's own invalidateProfileDeps (create/
    // rename/duplicate/delete) plus budget's invalidateSummaryAndContributions.
    // Promise.all instead of 10 uncoordinated fire-and-forget calls — same
    // outcome, dispatched together instead of serialized by whatever order
    // they happen to be written in (code-review efficiency finding,
    // 2026-09-01).
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
        utils.settings.contributionAccounts.invalidate(),
      ]),
  });
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
    {
      // Advisor-caught 2026-09-01: null used to short-circuit into a
      // silent no-op (setActive's input required a real id, which can't
      // express "clear the selection") — this hook's own return type is
      // `(id: number | null) => void`, so a caller reaching that branch
      // silently lost the write. setActive now accepts null directly.
      writeVia: (id) => setActive.mutateAsync({ id }),
    },
  );
  const { data: profiles } = trpc.contributionProfile.list.useQuery();

  useActiveProfileRepair(activeId, profiles, setActiveId);

  return [activeId, setActiveId];
}
