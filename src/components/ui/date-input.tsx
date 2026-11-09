"use client";

import { useState } from "react";

/**
 * A date field that saves on blur or Enter, not on every change (a native date input fires while
 * a year is half-typed: 0002, 0020…). Escape restores the saved value.
 */
export function DateInput({
  value,
  onCommit,
  disabled,
  ariaLabel,
  className = "",
}: {
  /** "YYYY-MM-DD", or "" for none. */
  value: string;
  /** Called with the new "YYYY-MM-DD" (or "" when cleared), only if it changed. */
  onCommit: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      type="date"
      aria-label={ariaLabel}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      disabled={disabled}
      className={className}
    />
  );
}
