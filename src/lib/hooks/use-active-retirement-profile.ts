"use client";

import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
import { useActiveProfileRepair } from "./use-active-profile-repair";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * The active Retirement Profile ID from app_settings, repaired to a real row
 * when the stored id is gone or absent. Use this instead of usePersistedSetting.
 */
export function useActiveRetirementProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  // Retirement Profile CRUD is admin-only, so the admin-gated generic upsert is
  // the right endpoint; this wrapper adds the invalidation that switching the
  // active profile needs (retirement/projection queries hold stale data).
  const upsertWithInvalidation = trpc.settings.appSettings.upsert.useMutation({
    // See useActiveContributionProfile's matching comment — batched instead of
    // uncoordinated calls.
    onSuccess: () =>
      Promise.all([
        utils.settings.appSettings.list.invalidate(),
        utils.retirement.invalidate(),
        utils.projection.invalidate(),
        utils.brokerage.invalidate(),
        utils.budget.invalidate(),
        utils.savings.invalidate(),
      ]),
  });
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    SK_ACTIVE_RETIREMENT_PROFILE_ID,
    null,
    {
      writeVia: (id) =>
        upsertWithInvalidation.mutateAsync({
          key: SK_ACTIVE_RETIREMENT_PROFILE_ID,
          value: id,
        }),
    },
  );
  const { data: profiles } = trpc.retirement.retirementProfiles.list.useQuery();

  useActiveProfileRepair("retirement", activeId, profiles, setActiveId);

  return [activeId, setActiveId];
}
