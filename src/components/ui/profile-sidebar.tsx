"use client";

/**
 * Shared left-rail profile list — the `grid-cols-[240px_1fr]` master-detail
 * shell every profile-manager surface (Budget, Contribution, Salary, and
 * now Retirement) uses, with a list of profiles on the left and the
 * selected one's editor on the right.
 *
 * Extracted 2026-08-30 from three near-identical, independently-maintained
 * copies (`budget-profile-sidebar.tsx`'s inline row markup, and a
 * `ProfileListItem` locally defined in both `contribution-profile-manager.tsx`
 * and `salary-profile-manager.tsx`) after Retirement Profiles' own manager
 * was built as a one-off flat pill row instead of matching this pattern —
 * the fourth divergent copy was the last straw.
 *
 * Rename is one gesture everywhere: the name renders as a click-to-edit
 * `InlineEdit` (2026-09-03) — the same always-visible affordance the app
 * uses for quick value edits elsewhere — driven by a single `onRename`
 * callback. A consumer that omits `onRename` (Savings, whose rail reuses
 * Budget profiles and is select-only) renders a plain, non-editable name.
 * This replaced a hover-reveal "rename" button that three of the four
 * managers wired and the fourth (Salary) didn't, plus two managers'
 * separate editor-body "Name" fields.
 */

import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";

type ProfileListRowProps = {
  name: string;
  /** Highlighted as the one currently being viewed/edited — not
   *  necessarily the same as `isActive` (Contribution's sidebar already
   *  distinguishes "viewing" from "globally active"; Retirement's Plan-pin
   *  "active in this Plan" case needs the same split). */
  isSelected: boolean;
  isActive: boolean;
  /** Defaults to "ACTIVE" (Budget/Contribution's existing copy). Pass an
   *  override for a more specific badge — e.g. Retirement's "Active in
   *  this Plan" when a session Plan is pinning this profile rather than
   *  it being the household's globally-active one. */
  activeLabel?: string;
  onSelect: () => void;

  /** Click-to-edit rename. Omit to render a plain, non-editable name
   *  (Savings' select-only rail). Called with the trimmed new name only
   *  when it actually changed. */
  onRename?: (newName: string) => void;

  /** Row actions — each is only rendered when its handler is provided.
   *  `onActivate` additionally hides itself once `isActive` is true. */
  onActivate?: () => void;
  onClone?: () => void;
  onDelete?: () => void;

  /** Type-specific summary line (Budget: $/yr + mode count; Contribution:
   *  contributions + employer match; Salary: job count or description). */
  meta?: React.ReactNode;
  /** Type-specific extra badge next to the name (Budget's API-link
   *  indicator is the only current user). */
  extraBadge?: React.ReactNode;
};

export function ProfileListRow({
  name,
  isSelected,
  isActive,
  activeLabel = "ACTIVE",
  onSelect,
  onRename,
  onActivate,
  onClone,
  onDelete,
  meta,
  extraBadge,
}: ProfileListRowProps) {
  const hasRowActions = onActivate || onClone || onDelete;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full cursor-pointer rounded-md px-3 py-2 text-left transition-colors ${
        isSelected
          ? "border border-blue-300 bg-blue-50"
          : "hover:bg-surface-sunken border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          {onRename ? (
            // Keep the row's own click/keyboard (select) from firing when
            // the name field is used — same guard the row-actions and
            // meta slots use.
            <span
              className="min-w-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <InlineEdit
                value={name}
                onSave={(next) => {
                  const trimmed = next.trim();
                  if (trimmed && trimmed !== name) onRename(trimmed);
                }}
                className="text-primary text-xs font-medium"
              />
            </span>
          ) : (
            <span className="text-primary truncate text-xs font-medium">
              {name}
            </span>
          )}
          {isActive && (
            <Badge color="green" className="shrink-0">
              {activeLabel}
            </Badge>
          )}
          {extraBadge}
        </div>
        {hasRowActions && (
          <div
            className="flex shrink-0 gap-1 transition-all md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[13rem] md:group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {onActivate && !isActive && (
              <button
                type="button"
                onClick={onActivate}
                className="text-caption text-faint hover:text-green-600"
              >
                activate
              </button>
            )}
            {onClone && (
              <button
                type="button"
                onClick={onClone}
                className="text-caption text-faint hover:text-blue-600"
              >
                clone
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-caption text-faint hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
      {meta && (
        <div className="text-caption text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {meta}
        </div>
      )}
    </div>
  );
}

/** Shared "Profiles" header — title + optional "+ New" trigger. Omit
 *  `onCreate` for a profile type with no bare-create path (Retirement:
 *  Duplicate is the only creation route, docblock in
 *  retirement-profile-manager.tsx explains why). */
export function ProfileSidebarHeader({
  title = "Profiles",
  onCreate,
}: {
  title?: string;
  onCreate?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-label text-muted font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="text-caption font-medium text-blue-600 hover:text-blue-700"
        >
          + New
        </button>
      )}
    </div>
  );
}
