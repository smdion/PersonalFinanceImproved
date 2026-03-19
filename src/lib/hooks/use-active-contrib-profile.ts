"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";

/**
 * Hook that reads the active contribution profile ID from app_settings,
 * validates it still exists, and silently falls back to null (Live) if deleted.
 *
 * Use this instead of calling usePersistedSetting('active_contrib_profile_id')
 * directly — it adds deleted-profile detection.
 */
export function useActiveContribProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { data: profiles } = trpc.contributionProfile.list.useQuery();

  // If the stored profile ID no longer exists in the list, reset to null (Live)
  useEffect(() => {
    if (
      activeId != null &&
      profiles &&
      !profiles.some((p) => p.id === activeId)
    ) {
      setActiveId(null);
    }
  }, [activeId, profiles, setActiveId]);

  return [activeId, setActiveId];
}
