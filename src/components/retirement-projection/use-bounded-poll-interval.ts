"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A `refetchInterval` value for TanStack Query's `useQuery` that stops
 * polling after `maxPolls` — a safety ceiling for progress-poll queries
 * gated on `enabled: someOtherQuery.isFetching` (e.g. Monte Carlo
 * progress). Without this, a hung/never-resolving tracked query (a
 * backend that crashed mid-run, a client that missed the completion
 * event) polls forever: `enabled` alone has no way to know the tracked
 * work is stuck, only that it hasn't finished yet.
 *
 * Once tripped, the poll stops (progress freezes instead of continuing to
 * request forever) and a `console.warn` fires once — a frozen progress
 * bar is itself a visible symptom, which giving the query more headroom
 * instead of a ceiling would remove entirely.
 *
 * `enabled` resets the poll count back to zero on each transition into
 * true, so a fresh run gets the full `maxPolls` budget again.
 */
export function useBoundedPollInterval(
  baseIntervalMs: number,
  maxPolls: number,
  enabled: boolean,
  /** Included in the console.warn for debugging which poller tripped. */
  label: string,
): () => number | false {
  const countRef = useRef(0);
  const trippedRef = useRef(false);

  useEffect(() => {
    if (enabled) {
      countRef.current = 0;
      trippedRef.current = false;
    }
  }, [enabled]);

  return useCallback(() => {
    if (trippedRef.current) return false;
    countRef.current += 1;
    if (countRef.current > maxPolls) {
      trippedRef.current = true;
      console.warn(
        `useBoundedPollInterval(${label}): stopped polling after ${maxPolls} attempts (~${Math.round((maxPolls * baseIntervalMs) / 1000)}s) without the tracked query completing — the tracked run may be hung.`,
      );
      return false;
    }
    return baseIntervalMs;
  }, [baseIntervalMs, maxPolls, label]);
}
