"use client";

/**
 * A small on/off chip for a setting that sits inside dense content (a card
 * line, a summary banner), where a full Toggle switch is too heavy: ✓ and
 * solid blue when on (like SegmentedControl's
 * selected option), muted when off. Same role and state as Toggle (a switch).
 */
export function ChipToggle({
  isChecked,
  onChange,
  label,
  title,
}: {
  isChecked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      onClick={() => onChange(!isChecked)}
      title={title}
      className={`text-caption inline-flex items-center gap-1 rounded-full border px-2 py-0.5 whitespace-nowrap transition-colors ${
        isChecked
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-default text-muted hover:text-secondary"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={`h-3 w-3 shrink-0 ${isChecked ? "" : "opacity-0"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 8.5l3.2 3L13 4.5"
        />
      </svg>
      {label}
    </button>
  );
}
