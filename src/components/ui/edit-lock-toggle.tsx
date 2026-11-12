"use client";

import { Lock, LockOpen } from "lucide-react";
import { useLocalBoolean } from "@/lib/hooks/use-local-storage";

/**
 * The padlock edit lock shared by every in-place-editable table/panel. Locked is the default: a
 * panel opens read-only until the user unlocks it.
 */
export function EditLockToggle({
  locked,
  onToggle,
  disabled,
}: {
  locked: boolean;
  onToggle: () => void;
  /** Pass `!canEdit`: renders a static lock with a tooltip explaining why, not the toggle. */
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        title="Only admins can edit — you can still view everything"
        aria-label="Only admins can edit"
        className="text-faint"
      >
        <Lock className="h-3.5 w-3.5" />
      </span>
    );
  }
  // Says what state it's in, not just an icon: a locked page otherwise
  // looks broken (fields that won't edit, no reason given).
  return (
    <button
      type="button"
      onClick={onToggle}
      title={locked ? "Unlock to edit" : "Lock editing"}
      aria-label={locked ? "Unlock to edit" : "Lock editing"}
      className={`text-caption inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
        locked
          ? "text-faint hover:text-primary"
          : "bg-amber-50 text-amber-700 hover:text-amber-900 dark:bg-amber-900/20 dark:text-amber-400"
      }`}
    >
      {locked ? (
        <Lock className="h-3.5 w-3.5" />
      ) : (
        <LockOpen className="h-3.5 w-3.5" />
      )}
      <span>{locked ? "View only — unlock to edit" : "Editing"}</span>
    </button>
  );
}

/**
 * localStorage keys for each lock. Each surface keeps its own key — unlocking
 * one panel must not silently unlock another.
 */
export const EDIT_LOCK_KEYS = {
  /** One lock for every surface that edits Salary/Contribution/Budget/Savings Profile data (Budget
   *  page tabs, Savings allocations, Paycheck profile editing). */
  profileEditLocked: "ledgr:budget:locked",
  /** Portfolio: fixing a balance in the latest snapshot. Separate from the profile lock, since it
   *  edits unrelated data. */
  portfolioSnapshotEditLocked: "ledgr:portfolio-snapshot:locked",
} as const;

/**
 * `[locked, toggle]` persisted under `key`, defaulting to locked.
 * Convention helper so callers don't re-spell the `useLocalBoolean(key, true)`
 * call (and can't accidentally default one panel to unlocked).
 */
export function useEditLock(key: string): [boolean, () => void] {
  const [locked, setLocked] = useLocalBoolean(key, true);
  return [locked, () => setLocked(!locked)];
}
