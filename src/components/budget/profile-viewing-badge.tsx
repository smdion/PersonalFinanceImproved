/**
 * Shared "ACTIVE" / "VIEWING (active: X)" badge for the budget-profile tabs.
 * "Active" includes a profile a Plan makes active; "Viewing" is in effect nowhere.
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
        <span className="text-muted text-xs">{profileName}</span>
        {activeProfileName && (
          <span className="text-caption text-faint">
            (active: {activeProfileName})
          </span>
        )}
        {onActivate && (
          <button
            type="button"
            onClick={onActivate}
            className="text-micro rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-700 transition-colors hover:bg-green-200"
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
      <span className="text-muted text-xs">{profileName}</span>
    </span>
  );
}
