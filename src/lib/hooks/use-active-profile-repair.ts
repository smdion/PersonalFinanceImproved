"use client";

import { useEffect } from "react";

export type ActiveProfileKind = "contribution" | "salary" | "retirement";

// Repairs already attempted this page load, shared by every hook instance.
// The dashboard mounts ~20 consumers of these hooks; per-instance tracking
// would still fire ~20 writes (and ~20 "didn't save" toasts) on a failure.
const attemptedRepairs = new Set<string>();

/** Test-only: forget attempted repairs (module state survives between tests). */
export function resetActiveProfileRepairsForTests(): void {
  attemptedRepairs.clear();
}

/**
 * Re-points an "active profile" id at a real row whenever the stored id
 * names one that's gone (or is absent entirely — e.g. a pre-migration
 * snapshot restore). Shared by useActiveContribProfile/
 * useActiveSalaryProfile/useActiveRetirementProfile — identical repair
 * logic, previously copy-pasted three times. A future tweak to the repair
 * rule, e.g. a different tie-break than "first by id," would have needed
 * editing three files and would likely have missed one.
 *
 * One attempt per broken state per page load, across all instances. When the
 * write can't stick (a viewer without write permission, DEMO_ONLY's mutation
 * guard) usePersistedSetting applies it optimistically and then reverts, so
 * the id looks healthy for a moment and broken again right after; retrying on
 * that looped setActive several times a second forever, and the network never
 * went idle (privacy-mode E2E timeouts). A different broken state — another
 * stored id, or another first profile — gets its own attempt.
 */
export function useActiveProfileRepair(
  kind: ActiveProfileKind,
  activeId: number | null,
  profiles: { id: number }[] | undefined,
  setActiveId: (id: number) => void,
): void {
  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    const target = profiles[0]!.id;
    const repairKey = `${kind}:${activeId}->${target}`;
    if (attemptedRepairs.has(repairKey)) return;
    attemptedRepairs.add(repairKey);
    setActiveId(target);
  }, [kind, activeId, profiles, setActiveId]);
}
