"use client";

/**
 * An expanding row's chevron as a button with no handler: its click (or
 * Enter/Space) bubbles to the row's `onClick`, so the row toggles once.
 */
export function ExpandRowButton({
  expanded,
  label,
  glyph = "chevron",
}: {
  expanded: boolean;
  /** The row's name; screen readers hear it with the expanded state. */
  label: string;
  /** The chevron, or the text triangle a row drew before this button. */
  glyph?: "chevron" | "triangle";
}) {
  const turn = `transition-transform ${expanded ? "rotate-90" : ""}`;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      className="inline-flex cursor-[inherit] items-center"
    >
      {glyph === "triangle" ? (
        <span aria-hidden="true" className={`text-caption text-faint ${turn}`}>
          &#9654;
        </span>
      ) : (
        <svg
          aria-hidden="true"
          className={`text-faint h-2.5 w-2.5 ${turn}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}
