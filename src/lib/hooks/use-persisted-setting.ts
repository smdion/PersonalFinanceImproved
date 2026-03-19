"use client";

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook that persists a setting value to app_settings via tRPC.
 * Falls back to localStorage for immediate reads, syncs to DB for cross-session persistence.
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
      staleTime: 60_000, // cache for 1 minute
    },
  );
  const upsert = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.settings.appSettings.list.invalidate(),
  });

  // Initialize from DB settings or localStorage fallback
  const [value, setValueState] = useState<T>(() => {
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

  // Sync from DB once settings load (DB is source of truth)
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (settings && !synced) {
      const found = settings.find((s) => s.key === key);
      if (found !== undefined) {
        setValueState(found.value as T);
        localStorage.setItem(`setting:${key}`, JSON.stringify(found.value));
      }
      setSynced(true);
    }
  }, [settings, key, synced]);

  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue);
      localStorage.setItem(`setting:${key}`, JSON.stringify(newValue));
      upsert.mutate({ key, value: newValue });
    },
    [key, upsert],
  );

  return [value, setValue];
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
