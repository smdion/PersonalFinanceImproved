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

  // Optimistic local value — seeded from localStorage for instant first paint
  const [localValue, setLocalValue] = useState<T>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(`setting:${key}`);
      if (stored !== null) {
        try {
          return JSON.parse(stored) as T;
        } catch {
          // ignore invalid JSON
        }
      }
    }
    return defaultValue;
  });

  // Track whether the user has made a local change that hasn't been confirmed by the query yet
  const pendingWrite = useRef(false);

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
      setLocalValue(newValue);
      localStorage.setItem(`setting:${key}`, JSON.stringify(newValue));
      upsert.mutate(
        { key, value: newValue },
        {
          onSettled: () => {
            pendingWrite.current = false;
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
