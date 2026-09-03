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
  /** "lg" marks a PRIMARY control (the 1-2 choices worth a second look —
   *  Scenario, Chart type) — bigger and bolder than the "sm" default used
   *  for everything else, so the eye has an obvious entry point instead
   *  of every pill competing equally (UI/UX pass, 2026-08-29). */
  size?: "sm" | "lg";
  /** Active-state color — ties a primary control's fill to its zone
   *  (compute = blue, display = amber) so color reinforces the same
   *  grouping the zone background already carries. Secondary controls
   *  stay "neutral" (today's plain border/shadow) so the zone accent
   *  isn't repeated on every single pill. */
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
export function PillGroup({
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

/** Labeled `<select>` matching `LabeledPillGroup`'s visual weight — a
 *  small uppercase label beside a bordered/backgrounded box, so a native
 *  select reads as a first-class grouped control instead of a bare
 *  floating dropdown next to unrelated pills. */
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
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-caption text-faint font-medium whitespace-nowrap uppercase">
        {label}
        {helpTip}
      </span>
      <select
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

/** Tinted zone container — the load-bearing grouping device from the
 *  2026-08-29 UI/UX redesign (see the "Projection Control Rail" mockup
 *  this was approved against). "compute" (cool blue) holds controls that
 *  change what gets calculated (Scenario, simulation settings); "display"
 *  (warm amber) holds controls that only change how already-computed
 *  results are shown (Chart type, Baseline, Confidence Band, Dollars).
 *  The color + one-line `why` do double duty as both visual grouping and
 *  plain-language explanation, so a first-time viewer doesn't need to
 *  already know the app to guess what a control does — a bare label
 *  wasn't enough (live-user finding: "still overwhelming... where/what/
 *  why/how"). */
export function ControlZone({
  tone,
  title,
  why,
  children,
}: {
  /** "compute" (blue) = decisions that change what gets calculated.
   *  "display" (amber) = lenses on results already computed. "results"
   *  (violet) = the Monte Carlo summary bar itself — reuses the same
   *  violet family the app already colors MC output with elsewhere
   *  (Sim. Median line, confidence bands in CHART_COLORS), instead of
   *  reusing "compute" blue, which read as the same zone repeated
   *  (live-user finding, 2026-08-29). */
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
