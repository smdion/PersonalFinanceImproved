import type { ReactNode } from "react";

/**
 * One line of a figures or settings panel: label on the left (may wrap, with
 * an optional hint line under it), value in a right-aligned column. Every
 * row uses the same two-column grid, so values line up down a panel no
 * matter how long a label is or whether a value is editable.
 */
export function FieldRow({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  /** A second, smaller line under the label (e.g. how a deduction is taxed). */
  hint?: ReactNode;
  /** The value — text, an amount, or a control. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 ${className}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">{label}</div>
        {hint && <div className="text-caption text-faint">{hint}</div>}
      </div>
      <div className="flex items-center justify-end text-right tabular-nums">
        {children}
      </div>
    </div>
  );
}
