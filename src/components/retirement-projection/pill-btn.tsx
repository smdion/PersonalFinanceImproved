import { useId } from "react";

/** Shared pill button for toolbar/control bar toggles. */
export function PillBtn({
  active,
  onClick,
  label,
  disabled = false,
  title,
  size = "sm",
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  /** Shown on hover — required reading when `disabled` explains why. */
  title?: string;
  /** "lg" marks a PRIMARY control (e.g. Scenario, Chart type), bigger and
   *  bolder than the "sm" default so the eye has an obvious entry point. */
  size?: "sm" | "lg";
  /** Active-state color matching a primary control's zone (compute = blue,
   *  display = amber). Secondary controls stay "neutral" so the zone accent
   *  isn't repeated on every pill. */
  tone?: "neutral" | "compute" | "display";
}) {
  const sizeClasses =
    size === "lg"
      ? "px-3.5 py-1.5 text-label font-semibold"
      : "px-2 py-1 text-caption font-medium";
  const activeClasses =
    tone === "compute"
      ? "bg-blue-600 text-white shadow-sm"
      : tone === "display"
        ? "bg-amber-600 text-white shadow-sm"
        : "bg-surface-primary text-primary shadow-sm border";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded transition-colors ${sizeClasses} ${
        disabled
          ? "text-faint cursor-not-allowed"
          : active
            ? activeClasses
            : "text-muted hover:text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

/** Pill button group container. */
function PillGroup({
  children,
  size = "sm",
}: {
  children: React.ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <div
      className={`bg-surface-primary/60 inline-flex rounded-md border ${size === "lg" ? "gap-0.5 p-1" : "p-0.5"}`}
    >
      {children}
    </div>
  );
}

/** Labeled pill group with optional divider before it. */
export function LabeledPillGroup({
  label,
  children,
  helpTip,
  size = "sm",
}: {
  label: string;
  children: React.ReactNode;
  helpTip?: React.ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`font-medium whitespace-nowrap uppercase ${size === "lg" ? "text-caption text-secondary" : "text-caption text-faint"}`}
      >
        {label}
        {helpTip}
      </span>
      <PillGroup size={size}>{children}</PillGroup>
    </div>
  );
}

/** Labeled `<select>` matching `LabeledPillGroup`'s visual weight, so a
 *  native select reads as a grouped control rather than a bare dropdown. */
export function LabeledSelect({
  label,
  helpTip,
  value,
  onChange,
  title,
  children,
}: {
  label: string;
  helpTip?: React.ReactNode;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  title?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={`${id}-select`}
        className="text-caption text-faint font-medium whitespace-nowrap uppercase"
      >
        {label}
        {helpTip}
      </label>
      <select
        id={`${id}-select`}
        value={value}
        onChange={onChange}
        title={title}
        className="text-caption bg-surface-primary/60 text-muted h-6 cursor-pointer rounded border px-1.5"
      >
        {children}
      </select>
    </div>
  );
}

/** Tinted zone container that groups controls: "compute" (blue) changes what
 *  gets calculated, "display" (amber) only changes how results are shown.
 *  The `why` line explains the zone in plain language. */
export function ControlZone({
  tone,
  title,
  why,
  children,
}: {
  /** "compute" (blue) = what gets calculated; "display" (amber) = lenses on
   *  computed results; "results" (violet) = the Monte Carlo summary bar, in
   *  the violet family used for MC output elsewhere. */
  tone: "compute" | "display" | "results";
  title: string;
  why: string;
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === "compute"
      ? "bg-blue-50/50 border-blue-200/80 dark:bg-blue-950/20 dark:border-blue-900/50"
      : tone === "display"
        ? "bg-amber-50/50 border-amber-200/80 dark:bg-amber-950/20 dark:border-amber-900/50"
        : "bg-violet-50/50 border-violet-200/80 dark:bg-violet-950/20 dark:border-violet-900/50";
  const titleClasses =
    tone === "compute"
      ? "text-blue-700 dark:text-blue-300"
      : tone === "display"
        ? "text-amber-700 dark:text-amber-300"
        : "text-violet-700 dark:text-violet-300";
  return (
    <div className={`space-y-2 rounded-lg border px-3 py-2.5 ${toneClasses}`}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span
          className={`text-caption font-bold tracking-wide uppercase ${titleClasses}`}
        >
          {title}
        </span>
        <span className="text-caption text-faint">— {why}</span>
      </div>
      {children}
    </div>
  );
}

/** Quieter secondary-controls row inside a `ControlZone` — sits below the
 *  primary control(s), separated by a dashed rule so it reads as "more
 *  detail available" rather than competing for the same attention. */
export function ZoneSecondaryRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-current/15 pt-2">
      {children}
    </div>
  );
}
