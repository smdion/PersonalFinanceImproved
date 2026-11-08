"use client";

import { moveChoice, rovingTabIndex } from "./arrow-keys";

/**
 * Each look is one of the option groups it replaced, class for class.
 * `bordered` is the blue-filled box; the others are a tray with a raised
 * chosen option.
 */
const LOOKS = {
  /** Bonus and extra-paycheck destinations, the contribution period. */
  bordered: {
    group:
      "border-default text-caption inline-flex shrink-0 overflow-hidden rounded-md border",
    option:
      "px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    on: "bg-blue-600 text-white",
    off: "bg-surface-primary text-muted hover:text-primary",
  },
  /** The dashboard's emergency-fund budget column. */
  "tray-caption": {
    group: "bg-surface-elevated flex rounded p-0.5",
    option: "text-caption rounded px-2 py-0.5 transition-colors",
    on: "bg-surface-primary text-primary font-medium shadow-sm",
    off: "text-muted hover:text-secondary",
  },
  /** A new fund's goal type: the options share the width. */
  "tray-fill": {
    group: "bg-surface-elevated flex rounded p-0.5",
    option: "flex-1 rounded px-2 py-1 text-xs transition-colors",
    on: "bg-surface-primary text-primary font-medium shadow-sm",
    off: "text-muted hover:text-secondary",
  },
  /** Net pay growth's % or $ per year. */
  "tray-strong": {
    group: "bg-surface-elevated flex rounded p-0.5",
    option: "text-caption rounded px-1.5 py-0.5",
    on: "bg-surface-strong text-primary",
    off: "text-faint hover:text-primary",
  },
  /** A savings transaction or transfer. */
  "tray-sunken": {
    group: "bg-surface-sunken flex w-fit items-center gap-1 rounded p-0.5",
    option: "rounded px-2.5 py-1 text-xs transition-colors",
    on: "bg-surface-primary text-primary font-medium shadow-sm",
    off: "text-faint hover:text-muted",
  },
  /** The portfolio chart's view and time frame. */
  "tray-label": {
    group: "bg-surface-elevated flex gap-0.5 rounded-md p-0.5",
    option: "text-label rounded px-2 py-0.5 transition-colors",
    on: "bg-surface-primary text-primary font-medium shadow-sm",
    off: "text-muted hover:text-secondary",
  },
  /** Performance's account categories. */
  "tray-lg": {
    group: "bg-surface-elevated flex gap-1 rounded-lg p-1",
    option: "rounded-md px-4 py-1.5 text-sm transition-colors",
    on: "bg-surface-primary text-primary font-medium shadow-sm",
    off: "text-muted hover:text-primary",
  },
} as const;

export type SegmentedLook = keyof typeof LOOKS;

/** The classes a look gives its group and an option; tests compare them. */
export function segmentedClasses(look: SegmentedLook, selected: boolean) {
  const l = LOOKS[look];
  return { group: l.group, option: `${l.option} ${selected ? l.on : l.off}` };
}

/**
 * The one control for choosing between a few options. Arrow keys, Home and
 * End move the choice; Tab reaches only the chosen option, or the first.
 * `reselect` also calls onChange on a click on the chosen option.
 */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  look = "bordered",
  reselect = false,
}: {
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  look?: SegmentedLook;
  reselect?: boolean;
}) {
  const values = options.map((o) => o.value);
  const chosen = values.indexOf(value);
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={LOOKS[look].group}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={rovingTabIndex(chosen, i)}
            title={o.title}
            disabled={disabled}
            onClick={() => (reselect || !selected) && onChange(o.value)}
            onKeyDown={(e) =>
              !disabled &&
              moveChoice(e, values, i, onChange, { vertical: true })
            }
            className={segmentedClasses(look, selected).option}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
