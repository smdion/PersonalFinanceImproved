"use client";

/**
 * The one control for choosing between a few options (2–4): one size, one
 * look, everywhere — "Bonus goes to", "Extra paycheck goes to", a period
 * toggle. The selected option is filled; the rest are quiet.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="border-default text-caption inline-flex shrink-0 overflow-hidden rounded-md border"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            disabled={disabled}
            onClick={() => !selected && onChange(o.value)}
            className={`px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "bg-blue-600 text-white"
                : "bg-surface-primary text-muted hover:text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
