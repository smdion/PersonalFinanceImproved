/**
 * "ACTIVE" / "PINNED" / "VIEWING (active: X)" badge — the shared visual
 * language for "which budget profile does the data on screen belong to."
 * Used by both the Budget Profiles tab (BudgetSummaryBar) and the Savings
 * Profiles tab (SavingsAllocationPanel), since both are scoped to the same
 * budget-profile selection and should say so identically, rather than each
 * inventing its own "which profile" indicator.
 *
 * Three states, not two: "Active" is the globally-active profile with no
 * Plan pin in effect; "Pinned" is the profile the current Plan has pinned as
 * active (see useEffectiveProfileId); "Viewing" is neither — the page is
 * just looking at a profile without it being in effect anywhere else.
 */
export function ProfileViewingBadge({
  profileName,
  activeProfileName,
  isViewingNonActive,
  isPinned,
  onActivate,
}: {
  profileName: string | null | undefined;
  activeProfileName?: string | null;
  isViewingNonActive: boolean;
  isPinned?: boolean;
  /** Shown as a visible "Activate" button (not hover-only) while viewing a
   *  non-active profile, so switching doesn't require finding the row in
   *  the sidebar. Omit to hide the button entirely (e.g. read-only views). */
  onActivate?: () => void;
}) {
  if (isViewingNonActive) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-micro px-1.5 py-0.5 rounded bg-surface-strong text-muted font-semibold uppercase">
          Viewing
        </span>
        <span className="text-xs text-muted">{profileName}</span>
        {activeProfileName && (
          <span className="text-caption text-faint">
            (active: {activeProfileName})
          </span>
        )}
        {onActivate && (
          <button
            type="button"
            onClick={onActivate}
            className="text-micro px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold hover:bg-green-200 transition-colors"
          >
            Activate
          </button>
        )}
      </span>
    );
  }
  if (isPinned) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-micro px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold uppercase">
          Pinned
        </span>
        <span className="text-xs text-muted">{profileName}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-micro px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold uppercase">
        Active
      </span>
      <span className="text-xs text-muted">{profileName}</span>
    </span>
  );
}
