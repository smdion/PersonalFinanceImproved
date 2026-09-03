/**
 * "ACTIVE" / "VIEWING (active: X)" badge — the shared visual language for
 * "which budget profile does the data on screen belong to." Used by both
 * the Budget Profiles tab (BudgetSummaryBar) and the Savings Profiles tab
 * (SavingsAllocationPanel), since both are scoped to the same budget-profile
 * selection and should say so identically, rather than each inventing its
 * own "which profile" indicator.
 *
 * "Active" covers both the globally-active profile and one a Plan has made
 * active (a Plan making a profile effective is just that profile being
 * active, so there's no separate "pinned" state). "Viewing" is neither — the
 * page is just looking at a profile without it being in effect anywhere else.
 */
import { Badge } from "@/components/ui/badge";

export function ProfileViewingBadge({
  profileName,
  activeProfileName,
  isViewingNonActive,
  onActivate,
}: {
  profileName: string | null | undefined;
  activeProfileName?: string | null;
  isViewingNonActive: boolean;
  /** Shown as a visible "Activate" button (not hover-only) while viewing a
   *  non-active profile, so switching doesn't require finding the row in
   *  the sidebar. Omit to hide the button entirely (e.g. read-only views). */
  onActivate?: () => void;
}) {
  if (isViewingNonActive) {
    return (
      <span className="flex items-center gap-2">
        <Badge color="gray">Viewing</Badge>
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
  return (
    <span className="flex items-center gap-2">
      <Badge color="green">Active</Badge>
      <span className="text-xs text-muted">{profileName}</span>
    </span>
  );
}
