"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * Hook that reads the active Retirement Profile ID from app_settings and
 * keeps it pointing at a real row. Same contract as
 * useActiveContribProfile/useActiveSalaryProfile on the other two axes: the
 * setting is never a sentinel, and this is the repair path for an id that
 * names a row which is gone (or absent entirely — e.g. a pre-migration
 * snapshot restore, or the very first load before any profile exists).
 *
 * Use this instead of calling
 * usePersistedSetting('active_retirement_profile_id') directly — it adds
 * deleted-profile detection.
 */
export function useActiveRetirementProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  // Retirement Profile CRUD is adminProcedure throughout by design (this
  // hook's activate button is only ever shown to admins — see
  // retirement-profile-manager.tsx), so unlike Contribution/Salary this
  // doesn't need a narrower-permission setActive endpoint — the generic
  // settings.appSettings.upsert's admin gate is already correct here. What
  // WAS missing (confirmed by 3 independent reviewers, advisor-caught
  // 2026-09-01): its default onSuccess only invalidates
  // settings.appSettings.list, so switching the active Retirement Profile
  // left every already-mounted retirement.*/projection.* query serving
  // stale data — the exact bug class fixed for Contribution/Salary
  // Profile activation, just never applied to this sibling. A custom
  // writeVia (same admin-gated upsert mutation, broader invalidation)
  // closes that without needing a new endpoint.
  const upsertWithInvalidation = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      utils.settings.appSettings.list.invalidate();
      utils.retirement.invalidate();
      utils.projection.invalidate();
      utils.brokerage.invalidate();
      utils.budget.invalidate();
      utils.savings.invalidate();
    },
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

  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    setActiveId(profiles[0]!.id);
  }, [activeId, profiles, setActiveId]);

  return [activeId, setActiveId];
}
