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
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    SK_ACTIVE_RETIREMENT_PROFILE_ID,
    null,
  );
  const { data: profiles } = trpc.retirement.retirementProfiles.list.useQuery();

  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    setActiveId(profiles[0]!.id);
  }, [activeId, profiles, setActiveId]);

  return [activeId, setActiveId];
}
