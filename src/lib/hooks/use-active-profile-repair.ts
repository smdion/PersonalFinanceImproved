"use client";

import { useEffect } from "react";

type ActiveProfileKind = "contribution" | "salary" | "retirement";

// Repairs already attempted this page load, shared by every hook instance.
// The dashboard mounts ~20 consumers of these hooks; per-instance tracking
// would still fire ~20 writes (and ~20 "didn't save" toasts) on a failure.
const attemptedRepairs = new Set<string>();

/** @internal Test-only: forget attempted repairs (module state survives between tests). */
export function resetActiveProfileRepairsForTests(): void {
  attemptedRepairs.clear();
}

/**
 * Re-points an active-profile id at the first profile when the stored id is
 * missing or gone. One attempt per broken state per page load across all
 * instances, so a write that can't stick (no permission, DEMO_ONLY) never loops.
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
