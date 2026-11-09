import type { ReactNode } from "react";

/**
 * One line of a figures or settings panel: label (may wrap, optional hint below) and a
 * right-aligned value, on a shared two-column grid so values line up down the panel.
 */
export function FieldRow({
  label,
  hint,
  children,
  className = "",
  stacked = false,
}: {
  label: ReactNode;
  /** A second, smaller line under the label (e.g. how a deduction is taxed). */
  hint?: ReactNode;
  /** The value — text, an amount, or a control. */
  children: ReactNode;
  className?: string;
  /** The value on its own line under the label, right-aligned — for a wide
   *  control (e.g. a two-choice switch) in a narrow column. */
  stacked?: boolean;
}) {
  if (stacked)
    return (
      <div className={`space-y-1 ${className}`}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">{label}</div>
          {hint && <div className="text-caption text-faint">{hint}</div>}
        </div>
        <div className="flex justify-end">{children}</div>
      </div>
    );
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
