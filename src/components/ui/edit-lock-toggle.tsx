"use client";

import { Lock, LockOpen } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";

/**
 * The padlock edit lock — one shared control for every table/panel that is
 * editable in place, so every surface uses the same icon, sizing, wording
 * and default-locked behaviour.
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
  /** Pass `!canEdit` — the toggle becomes a static, non-interactive lock
   *  with a tooltip explaining why, rather than the clickable toggle. Was
   *  silently hidden entirely before the design plan's §05 review flagged
   *  it as a consistency gap ("Says why it's locked out") next to the
   *  Retirement tab and Budget managers, which already explain themselves. */
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        title="Only admins can edit — you can still view everything"
        aria-label="Only admins can edit"
        className="text-faint"
      >
        <Lock className="w-3.5 h-3.5" />
      </span>
    );
  }
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
  /** One shared lock for every profile-editing surface in the app: all four
   *  Budget page tabs (Salary, Contribution, Budget, Savings), the
   *  standalone Savings page's allocation editor, and the Paycheck page's
   *  Salary/Contribution profile editing — they all edit the same
   *  underlying Salary/Contribution/Budget/Savings Profile data (just from
   *  different pages), so one padlock covers all of it rather than several
   *  independent locks that can drift out of sync with each other. */
  profileEditLocked: "ledgr:budget:locked",
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
