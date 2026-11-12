"use client";

import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { oneOf } from "@/lib/hooks/browser-storage";

const HISTORY_WINDOWS = [0, 3, 6, 12, "all"] as const;

/** How many past months a savings table shows ("all": every one). */
export type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

const isHistoryWindow = oneOf(HISTORY_WINDOWS);

/** Each savings table's key in this browser. */
const KEYS = {
  trajectory: "ledgr:savings:historyWindow",
  transactions: "ledgr:savings:txHistoryWindow",
} as const;

/** A savings table's history window, kept in this browser; 0 until set. */
export function useHistoryWindow(table: keyof typeof KEYS) {
  return useLocalStorage<HistoryWindow>(KEYS[table], 0, isHistoryWindow);
}
