"use client";

import { useState, useCallback } from "react";
import { computeFiTarget } from "@/lib/calculators/net-worth";

export type FICache = {
  fiYear: number | null;
  fiAge: number | null;
  /** Opaque fingerprint of the INPUT that produced this cache entry (not the
   *  output) — lets a future reader tell what produced the value. Currently
   *  unused by any reader; kept for that purpose rather than removed. */
  inputKey: string;
  computedAt: string;
} | null;

const STORAGE_KEY = "fi_projection_cache";

export function useFICache(): [FICache, (v: FICache) => void] {
  const [cache, setCache] = useState<FICache>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as FICache) : null;
    } catch {
      return null;
    }
  });

  const write = useCallback((v: FICache) => {
    setCache(v);
    try {
      if (v === null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  return [cache, write];
}

/**
 * Single computation path for "when does the projection cross the FI
 * target" — both writers (dashboard retirement card, retirement page) must
 * call this instead of each re-deriving the same scan independently, or the
 * two WILL diverge (docs/RULES.md — single computation path).
 *
 * R45 Step 4 (Findings 8/13): the FI target itself is computed by
 * `computeFiTarget` (lib/calculators/net-worth.ts) — the same function
 * `calculateNetWorth` uses server-side — instead of reimplementing
 * `annualExpenses / withdrawalRate` here with no divide-by-zero guard. The
 * two used to independently compute the same formula and could show
 * different numbers on the same Net Worth page render.
 */
export function deriveFI(
  projectionByYear: { year: number; age: number; endBalance: number }[],
  annualExpenses: number,
  withdrawalRate: number,
): { fiYear: number | null; fiAge: number | null; inputKey: string } {
  const fiTarget = computeFiTarget(annualExpenses, withdrawalRate);
  const hit = projectionByYear.find((y) => y.endBalance >= fiTarget);
  return {
    fiYear: hit?.year ?? null,
    fiAge: hit?.age ?? null,
    inputKey: `${annualExpenses}-${withdrawalRate}-${projectionByYear.length}`,
  };
}

/**
 * Signals that identify whether an engine query represents the live,
 * no-override plan. fi_projection_cache must only ever be written from a
 * live-plan query — a what-if scenario, historical snapshot, or any of
 * these overrides producing a *different projection* than what the rest of
 * the dashboard shows would otherwise get cached and rendered elsewhere as
 * "the real plan" (H12, .scratch/docs/review-findings.md).
 *
 * contributionProfileId/salaryProfileId are NOT checked for null here. Both
 * current callers (this dashboard's retirement card and the Plan Health
 * page) resolve these via useEffectiveProfileId/useEffectiveSalaryProfileId
 * before querying, which returns the true globally-active profile id
 * whenever isInScenario is false (a Plan pin — the only way to preview a
 * *different* profile — requires an active Scenario, already excluded
 * below). Treating a non-null id as inherently non-live would mean this
 * cache is never written for any household with a Contribution/Salary
 * Profile configured (M27, .scratch/docs/review-findings.md) — the engine
 * input still needs an explicit id since "no profile" means $0
 * contributions, not "use the active one".
 */
export type FICacheInputSignals = {
  isInScenario: boolean;
  snapshotId?: number | null;
  accumulationOverrides?: unknown[] | null;
  decumulationOverrides?: unknown[] | null;
  parentCategoryFilter?: string | null;
  isPersonFiltered?: boolean;
};

export function isLivePlanInput(signals: FICacheInputSignals): boolean {
  return (
    !signals.isInScenario &&
    signals.snapshotId == null &&
    !(
      signals.accumulationOverrides && signals.accumulationOverrides.length > 0
    ) &&
    !(
      signals.decumulationOverrides && signals.decumulationOverrides.length > 0
    ) &&
    !signals.parentCategoryFilter &&
    !signals.isPersonFiltered
  );
}
