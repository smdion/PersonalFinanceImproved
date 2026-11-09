"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * `refetchInterval` for progress-poll queries that stops after `maxPolls` and
 * warns once, so a hung tracked query can't poll forever. The count resets
 * each time `enabled` turns true.
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
