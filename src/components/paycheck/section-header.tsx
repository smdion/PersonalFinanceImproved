import React from "react";

/** A Paycheck card section title; `note` says where the section's edits
 *  save (from resolvePaycheckEditTarget), on a line of its own. */
export function SectionHeader({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="space-y-0.5">
      <h4 className="text-faint flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
        <span className="bg-surface-strong h-px flex-1" />
        <span className="shrink-0">{children}</span>
        <span className="bg-surface-strong h-px flex-1" />
      </h4>
      {note && (
        <p className="text-caption text-faint text-center normal-case">
          {note}
        </p>
      )}
    </div>
  );
}
