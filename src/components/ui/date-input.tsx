"use client";

import { useState } from "react";

/**
 * A date field that saves once — on blur or Enter — not on every change.
 * A native date input fires change events while a year is still being
 * typed (0002, 0020, 0202…), and saving each of those would store a wrong
 * date. Escape puts the saved value back.
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
