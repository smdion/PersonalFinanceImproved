"use client";

/**
 * Shared toggle switch component.
 * Off state: light gray track, white dot flush-left — clearly "off".
 * On state: blue track, white dot flush-right — clearly "on".
 */
export function Toggle({
  isChecked,
  onChange,
  label,
  ariaLabel,
  size = "sm",
  title,
  disabled = false,
}: {
  isChecked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible pill text next to the switch. */
  label?: string;
  /** Accessible name when the switch sits beside its own title/description
   *  elsewhere (a settings row) instead of owning a visible label here —
   *  rendering `label` in that layout would duplicate the row's title. */
  ariaLabel?: string;
  size?: "xs" | "sm";
  title?: string;
  /** Renders the switch inert (read-only preview surfaces). */
  disabled?: boolean;
}) {
  const track = size === "xs" ? "w-7 h-4" : "w-9 h-5";
  const dot = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  const dotOff = "left-0.5";
  const dotOn = size === "xs" ? "left-3.5" : "left-[18px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={ariaLabel ?? label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!isChecked);
      }}
      title={title}
      disabled={disabled}
      className={`${disabled ? "opacity-60 cursor-not-allowed " : ""}inline-flex items-center gap-1.5 ${label ? "px-2 py-1 rounded text-caption font-medium" : ""} ${
        label
          ? isChecked
            ? "bg-blue-50 text-blue-700 border border-blue-200"
            : "bg-surface-sunken text-muted border hover:bg-surface-elevated"
          : ""
      } transition-colors`}
    >
      <span
        className={`inline-block ${track} rounded-full relative transition-colors duration-200 ${
          isChecked ? "bg-blue-500" : "bg-surface-strong border border-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 ${dot} rounded-full shadow-sm transition-all duration-200 ${
            // v0.5 M26: design tokens, not hardcoded grays. Off-state dot was
            // bg-gray-400 (invisible on light surfaces in some themes).
            isChecked
              ? `${dotOn} bg-white`
              : `${dotOff} bg-surface-elevated dark:bg-surface-primary border border-default`
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
