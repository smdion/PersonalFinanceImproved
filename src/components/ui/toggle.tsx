"use client";

/**
 * Shared toggle switch component.
 * Off state: light gray track, white dot flush-left — clearly "off".
 * On state: blue track, white dot flush-right — clearly "on".
 */
export function Toggle({
  checked,
  onChange,
  label,
  size = "sm",
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  size?: "xs" | "sm";
  title?: string;
}) {
  const track = size === "xs" ? "w-7 h-4" : "w-9 h-5";
  const dot = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  const dotOff = "left-0.5";
  const dotOn = size === "xs" ? "left-3.5" : "left-[18px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
      title={title}
      className={`inline-flex items-center gap-1.5 ${label ? "px-2 py-1 rounded text-[10px] font-medium" : ""} ${
        label
          ? checked
            ? "bg-blue-50 text-blue-700 border border-blue-200"
            : "bg-surface-sunken text-muted border hover:bg-surface-elevated"
          : ""
      } transition-colors`}
    >
      <span
        className={`inline-block ${track} rounded-full relative transition-colors duration-200 ${
          checked ? "bg-blue-500" : "bg-surface-strong border border-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 ${dot} rounded-full shadow-sm transition-all duration-200 ${
            checked ? `${dotOn} bg-white` : `${dotOff} bg-gray-400`
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
