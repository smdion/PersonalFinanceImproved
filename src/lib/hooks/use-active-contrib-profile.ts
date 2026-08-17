"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
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
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  const { data: profiles } = trpc.contributionProfile.list.useQuery();

  // Re-point at a real row whenever the stored id names one that's gone (or
  // is absent entirely, e.g. a pre-migration snapshot restore).
  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    setActiveId(profiles[0]!.id);
  }, [activeId, profiles, setActiveId]);

  return [activeId, setActiveId];
}
