"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook that persists a setting value to app_settings via tRPC.
 * DB query result is the source of truth once loaded.
 * localStorage provides an instant initial value before the query resolves.
 *
 * @param key - Unique setting key (e.g., 'retirement_show_todays_dollars')
 * @param defaultValue - Default value when no setting exists
 */
export function usePersistedSetting<T extends string | number | boolean | null>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.settings.appSettings.list.useQuery(
    undefined,
    {
      staleTime: 60_000,
    },
  );
  const upsert = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.settings.appSettings.list.invalidate(),
  });

  // Optimistic local value. Always starts at defaultValue — SSR has no
  // window, so a lazy initializer that read localStorage here returned
  // defaultValue server-side but the STORED value on the client's very
  // first render (before hydration reconciles), a same-render server/client
  // branch on `typeof window`, which is a textbook hydration mismatch (React
  // flags this exact pattern in its own hydration-error guidance). Read
  // localStorage in the effect below instead — after mount, so it can only
  // ever update state post-hydration, never change what the first render
  // produces.
  const [localValue, setLocalValue] = useState<T>(defaultValue);

  useEffect(() => {
    const stored = localStorage.getItem(`setting:${key}`);
    if (stored !== null) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from localStorage, client-only by definition
        setLocalValue(JSON.parse(stored) as T);
      } catch {
        // ignore invalid JSON
      }
    }
  }, [key]);

  // Track whether the user has made a local change that hasn't been
  // confirmed by the query yet. Per-write generation counter (not a single
  // shared boolean) — if write A settles after write B has already started,
  // A's onSettled must NOT clear the guard while B is still pending, or a
  // stale DB-echoed value can briefly clobber the user's latest input (M42,
  // .scratch/docs/review-findings.md).
  const pendingWrite = useRef(false);
  const writeGeneration = useRef(0);

  // Once DB settings load (or refresh), adopt DB value — unless we have a pending optimistic write.
  useEffect(() => {
    if (!settings || pendingWrite.current) return;
    const found = settings.find((s) => s.key === key);
    if (found !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external data to local state
      setLocalValue(found.value as T);
      localStorage.setItem(`setting:${key}`, JSON.stringify(found.value));
    }
  }, [settings, key]);

  const setValue = useCallback(
    (newValue: T) => {
      pendingWrite.current = true;
      const myGeneration = ++writeGeneration.current;
      setLocalValue(newValue);
      localStorage.setItem(`setting:${key}`, JSON.stringify(newValue));
      upsert.mutate(
        { key, value: newValue },
        {
          onSettled: () => {
            // Only the most recent write may clear the guard — an older
            // write settling late must not reopen the window for a stale
            // refetch to overwrite a newer, still-pending edit.
            if (myGeneration === writeGeneration.current) {
              pendingWrite.current = false;
            }
          },
        },
      );
    },
    [key, upsert],
  );

  return [localValue, setValue];
}

/**
 * Convenience wrapper for boolean toggles.
 */
export function usePersistedToggle(
  key: string,
  defaultValue = false,
): [boolean, (value: boolean) => void] {
  return usePersistedSetting<boolean>(key, defaultValue);
}
