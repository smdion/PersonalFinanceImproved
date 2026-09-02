"use client";

import { useEffect } from "react";

/**
 * Re-points an "active profile" id at a real row whenever the stored id
 * names one that's gone (or is absent entirely — e.g. a pre-migration
 * snapshot restore). Shared by useActiveContribProfile/
 * useActiveSalaryProfile/useActiveRetirementProfile — identical repair
 * logic, previously copy-pasted three times (code-review "reuse/
 * duplication" finding, 2026-09-01: a future tweak to the repair rule,
 * e.g. a different tie-break than "first by id," would have needed
 * editing three files and would likely have missed one).
 */
export function useActiveProfileRepair(
  activeId: number | null,
  profiles: { id: number }[] | undefined,
  setActiveId: (id: number) => void,
): void {
  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    setActiveId(profiles[0]!.id);
  }, [activeId, profiles, setActiveId]);
}
