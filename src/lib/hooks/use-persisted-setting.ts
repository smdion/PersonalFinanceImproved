"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { readBrowserJson } from "@/lib/hooks/browser-storage";

/** A seed the hook can hold: a setting is one string, number, boolean or
 *  null. A narrower T (a key union, a profile id) isn't checked here: the
 *  seed only shows until the DB value loads, which wins. */
function isSettingValue<T extends string | number | boolean | null>(
  v: unknown,
): v is T {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/**
 * A setting persisted to app_settings. The DB value wins once loaded (`loaded`);
 * localStorage seeds it before. `writeVia` swaps the admin-only upsert for a
 * narrower-permission mutation (e.g. contributionProfile.setActive).
 */
export function usePersistedSetting<T extends string | number | boolean | null>(
  key: string,
  defaultValue: T,
  options?: { writeVia?: (value: T) => Promise<unknown> },
): [T, (value: T) => void, boolean] {
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
  const writeVia = options?.writeVia;

  // Optimistic local value. Starts at defaultValue on both server and client to
  // avoid a hydration mismatch; the effect below reads localStorage after mount.
  const [localValue, setLocalValue] = useState<T>(defaultValue);
  // Mirrors localValue without pulling it into setValue's deps, so setValue
  // keeps a stable identity across renders instead of changing on every
  // optimistic update (consumers close over it in effect deps elsewhere).
  const localValueRef = useRef(localValue);
  useEffect(() => {
    localValueRef.current = localValue;
  }, [localValue]);

  useEffect(() => {
    const stored = readBrowserJson(`setting:${key}`, isSettingValue<T>);
    if (stored !== undefined)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from localStorage, client-only by definition
      setLocalValue(stored);
  }, [key]);

  // A local change not yet confirmed by the query. A per-write generation lets
  // only the latest write clear the guard, so a stale echo can't clobber input.
  const pendingWrite = useRef(false);
  const writeGeneration = useRef(0);
  // Render-visible twin of pendingWrite: while a write is in flight the
  // optimistic local value wins over the DB echo.
  const [writing, setWriting] = useState(false);

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
      setWriting(true);
      const myGeneration = ++writeGeneration.current;
      // Revert target if this write fails — the last DB-confirmed value,
      // not just defaultValue, so an error doesn't blow away an unrelated
      // earlier successful write.
      const priorValue = localValueRef.current;
      setLocalValue(newValue);
      localStorage.setItem(`setting:${key}`, JSON.stringify(newValue));

      const settle = () => {
        // Only the most recent write may clear the guard — an older
        // write settling late must not reopen the window for a stale
        // refetch to overwrite a newer, still-pending edit.
        if (myGeneration === writeGeneration.current) {
          pendingWrite.current = false;
          setWriting(false);
        }
      };
      const revert = () => {
        if (myGeneration !== writeGeneration.current) return;
        setLocalValue(priorValue);
        localStorage.setItem(`setting:${key}`, JSON.stringify(priorValue));
        toast.error("Change didn't save — you may not have permission.");
      };

      if (writeVia) {
        // Refresh the settings list before the guard clears, or the hook would
        // read the stale DB value right after a successful write.
        writeVia(newValue)
          .then(() => utils.settings.appSettings.list.invalidate())
          .then(settle, (err) => {
            settle();
            revert();
            if (process.env.NODE_ENV !== "production") {
              console.warn(`usePersistedSetting(${key}) write failed`, err);
            }
          });
        return;
      }

      upsert.mutate(
        { key, value: newValue },
        {
          onSettled: settle,
          onError: (err) => {
            revert();
            if (process.env.NODE_ENV !== "production") {
              console.warn(`usePersistedSetting(${key}) write failed`, err);
            }
          },
        },
      );
    },
    [key, upsert, writeVia, utils],
  );

  // The DB value once loaded (unless a write is in flight); a key the DB lacks
  // is its default, never a stale localStorage value.
  const dbEntry = settings?.find((s) => s.key === key);
  const value =
    writing || settings === undefined
      ? localValue
      : dbEntry !== undefined
        ? (dbEntry.value as T)
        : defaultValue;
  return [value, setValue, settings !== undefined];
}

/**
 * Convenience wrapper for boolean toggles.
 */
export function usePersistedToggle(
  key: string,
  defaultValue = false,
): [boolean, (value: boolean) => void, boolean] {
  return usePersistedSetting<boolean>(key, defaultValue);
}
