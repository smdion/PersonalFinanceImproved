"use client";

import { useState, useCallback } from "react";
import {
  isBoolean,
  readBrowserJson,
  type StoredFits,
} from "@/lib/hooks/browser-storage";

/** A value kept in this browser under `key`: `defaultValue` until a stored
 *  one that `fits` is read (see readBrowserJson). */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  fits: StoredFits<T>,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    return readBrowserJson(key, fits) ?? defaultValue;
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full or unavailable
      }
    },
    [key],
  );

  return [value, update];
}

/** A yes/no kept in this browser under `key`. */
export function useLocalBoolean(key: string, defaultValue: boolean) {
  return useLocalStorage(key, defaultValue, isBoolean);
}
