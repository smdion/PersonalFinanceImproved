"use client";

import { Lock, LockOpen } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";

/**
 * The padlock edit lock — one shared control for every table/panel that is
 * editable in place. Extracted from the Savings page's transaction table so
 * every surface uses the same icon, sizing, wording and default-locked
 * behaviour.
 *
 * Locked is always the default: an editable panel opens read-only and the
 * user opts in to editing by unlocking it.
 */
export function EditLockToggle({
  locked,
  onToggle,
  disabled,
}: {
  locked: boolean;
  onToggle: () => void;
  /** Pass `!canEdit` — the toggle is hidden entirely without edit permission. */
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={locked ? "Unlock to edit" : "Lock editing"}
      aria-label={locked ? "Unlock to edit" : "Lock editing"}
      className="text-faint hover:text-primary transition-colors"
    >
      {locked ? (
        <Lock className="w-3.5 h-3.5" />
      ) : (
        <LockOpen className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/**
 * localStorage keys for each lock. Each surface keeps its own key — unlocking
 * one panel must not silently unlock another.
 */
export const EDIT_LOCK_KEYS = {
  budgetSalary: "ledgr:budget:salaryLocked",
  budgetContrib: "ledgr:budget:contribLocked",
  budgetBudget: "ledgr:budget:budgetLocked",
  budgetSavings: "ledgr:budget:savingsLocked",
  paycheckSalary: "ledgr:paycheck:salaryLocked",
} as const;

/**
 * `[locked, toggle]` persisted under `key`, defaulting to locked.
 * Convention helper so callers don't re-spell the `useLocalStorage(key, true)`
 * call (and can't accidentally default one panel to unlocked).
 */
export function useEditLock(key: string): [boolean, () => void] {
  const [locked, setLocked] = useLocalStorage<boolean>(key, true);
  return [locked, () => setLocked(!locked)];
}
