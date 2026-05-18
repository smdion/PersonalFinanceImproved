import { useState, useCallback } from "react";

export function useLocalStorageSet(
  key: string,
): [Set<number>, (v: Set<number>) => void] {
  const [set, setSet] = useState<Set<number>>(() => {
    // typeof window guard — Next.js renders "use client" components on the
    // server first; localStorage is not available there.
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(key);
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
    } catch {
      return new Set();
    }
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
