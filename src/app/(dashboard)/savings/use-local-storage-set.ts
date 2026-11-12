"use client";

import { useState, useCallback } from "react";
import { readBrowserJson } from "@/lib/hooks/browser-storage";

const isIdList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((id) => typeof id === "number");

export function useLocalStorageSet(
  key: string,
): [Set<number>, (v: Set<number>) => void] {
  const [set, setSet] = useState<Set<number>>(() => {
    // typeof window guard — Next.js renders "use client" components on the
    // server first; localStorage is not available there.
    if (typeof window === "undefined") return new Set();
    return new Set(readBrowserJson(key, isIdList));
  });

  const update = useCallback(
    (next: Set<number>) => {
      setSet(next);
      try {
        localStorage.setItem(key, JSON.stringify(Array.from(next)));
      } catch {
        // storage full or unavailable
      }
    },
    [key],
  );

  return [set, update];
}
