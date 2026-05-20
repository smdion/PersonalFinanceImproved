"use client";

import { useState, useCallback } from "react";

export type FICache = {
  fiYear: number | null;
  fiAge: number | null;
  settingsHash: string;
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
