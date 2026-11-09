"use client";

/**
 * Left-rail profile list for every profile manager's master-detail shell. The name is a
 * click-to-edit `InlineEdit` driven by `onRename`; without `onRename` it is plain text.
 */

import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { asButton } from "./as-button";

type ProfileListRowProps = {
  name: string;
  /** The profile being viewed/edited, which need not be the active one (`isActive`). */
  isSelected: boolean;
  isActive: boolean;
  /** Defaults to "ACTIVE"; pass a more specific badge, e.g. Retirement's "Active in this Plan"
   *  when a session Plan selects this profile. */
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
  /** Type-specific reference tag leading the meta line (e.g. Budget's API link), best as a
   *  subtle (no-fill) Badge. */
  metaTag?: React.ReactNode;
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
  metaTag,
}: ProfileListRowProps) {
  const hasRowActions = onActivate || onClone || onDelete;
  return (
    <div
      {...asButton(() => onSelect())}
      className={`group w-full cursor-pointer rounded-md px-3 py-2 text-left transition-colors ${
        isSelected
          ? "border border-blue-300 bg-blue-50"
          : "hover:bg-surface-sunken border border-transparent"
      }`}
    >
      {/* flex-wrap: on the narrow rail the visible actions drop to their own
          line; on md+ they appear on hover/focus and never wrap. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {onRename ? (
            // Keep the row's own click/keyboard (select) from firing when
            // the name field is used — same guard the row-actions and
            // meta slots use.
            <span
              role="presentation"
              className="min-w-0 flex-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <InlineEdit
                value={name}
                truncate
                onSave={(next) => {
                  const trimmed = next.trim();
                  if (trimmed && trimmed !== name) onRename(trimmed);
                }}
                className="text-primary text-xs font-medium"
              />
            </span>
          ) : (
            <span className="text-primary min-w-0 flex-1 truncate text-xs font-medium">
              {name}
            </span>
          )}
          {isActive && (
            <Badge color="green" className="shrink-0">
              {activeLabel}
            </Badge>
          )}
        </div>
        {hasRowActions && (
          <div
            role="presentation"
            className="flex shrink-0 gap-2 md:max-w-0 md:overflow-hidden md:opacity-0 md:transition-all md:group-focus-within:max-w-[13rem] md:group-focus-within:opacity-100 md:group-hover:max-w-[13rem] md:group-hover:opacity-100"
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
      {(metaTag || meta) && (
        <div className="text-caption text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {metaTag}
          {meta}
        </div>
      )}
    </div>
  );
}

/** Shared "Profiles" header: title + optional "+ New". Omit `onCreate` for a profile type with no
 *  bare create (Retirement creates only by Duplicate). */
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
