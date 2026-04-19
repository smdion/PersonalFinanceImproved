"use client";

/**
 * ProjectionLoader — handles two distinct UI states:
 *
 *  1. Action state (showActionState=true): autoload is off and no data exists.
 *     Renders a full-width card at the CHART position explaining the user
 *     needs to run the simulation manually.
 *
 *  2. Slim progress strip: engine is done but MC / Coast FIRE is still
 *     running. Renders a single-line strip between the chart and table so
 *     real content is fully visible with just a status indicator.
 *
 *  Engine loading state is NOT handled here — the chart, hero, and toolbar
 *  each show their own in-place skeleton so the layout never shifts.
 */

type Phase = "pending" | "active" | "done" | "disabled";

type Props = {
  /** Phase 1: deterministic engine */
  enginePhase: Phase;
  /** Phase 2: Monte Carlo prefetch */
  mcPhase: Phase;
  /** Phase 2 parallel: Coast FIRE Monte Carlo (non-blocking) */
  coastFireMcPhase: Phase;
  /** True when engine autoload is off and no engine data exists yet */
  showActionState: boolean;
  onRunSimulation: () => void;
  onRunMonteCarlo: () => void;
  onRunCoastFireMc: () => void;
};

// Bar data for the action state background — intentional bell-curve shape.
const BARS = [
  { id: "b00", h: 14, delay: 0 },
  { id: "b01", h: 20, delay: 55 },
  { id: "b02", h: 27, delay: 110 },
  { id: "b03", h: 35, delay: 165 },
  { id: "b04", h: 44, delay: 220 },
  { id: "b05", h: 53, delay: 275 },
  { id: "b06", h: 61, delay: 330 },
  { id: "b07", h: 69, delay: 385 },
  { id: "b08", h: 76, delay: 440 },
  { id: "b09", h: 82, delay: 495 },
  { id: "b10", h: 87, delay: 550 },
  { id: "b11", h: 91, delay: 605 },
  { id: "b12", h: 94, delay: 660 },
  { id: "b13", h: 91, delay: 715 },
  { id: "b14", h: 86, delay: 770 },
  { id: "b15", h: 80, delay: 825 },
  { id: "b16", h: 73, delay: 880 },
  { id: "b17", h: 65, delay: 935 },
  { id: "b18", h: 56, delay: 990 },
  { id: "b19", h: 47, delay: 1045 },
  { id: "b20", h: 38, delay: 1100 },
  { id: "b21", h: 29, delay: 1155 },
  { id: "b22", h: 21, delay: 1210 },
  { id: "b23", h: 14, delay: 1265 },
];

export function ProjectionLoader({
  enginePhase,
  mcPhase,
  coastFireMcPhase,
  showActionState,
  onRunSimulation,
  onRunMonteCarlo,
  onRunCoastFireMc,
}: Props) {
  const mcLoading = mcPhase === "active";
  const coastLoading = coastFireMcPhase === "active";

  // ── Action state ───────────────────────────────────────────────────────────
  // Autoload is off — render a full card at the chart position with a prompt.
  if (showActionState) {
    return (
      <div className="rounded-lg border border-subtle overflow-hidden">
        <div className="relative h-40 bg-surface-sunken px-6 pt-4 pb-0">
          <div className="absolute inset-0 flex items-end gap-1 px-6 pb-0">
            {BARS.map(({ id, h, delay }) => (
              <div
                key={id}
                className="flex-1 rounded-t bg-surface-strong animate-pulse"
                style={{
                  height: `${h}%`,
                  animationDelay: `${delay}ms`,
                  animationDuration: "1.8s",
                }}
              />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-sunken/60 backdrop-blur-[1px]">
            <p className="text-sm text-muted text-center px-4">
              Auto-load is disabled. Run the simulation when ready.
            </p>
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={onRunSimulation}
                className="px-4 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Run Simulation
              </button>
            </div>
          </div>
        </div>
        <div className="bg-surface-primary border-t border-subtle px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <PhaseChip
              phase={enginePhase}
              label="Projection engine"
              activeColor="text-blue-400"
            />
            {mcPhase !== "disabled" ? (
              <PhaseChip
                phase={mcPhase}
                label="Simulations"
                activeColor="text-purple-400"
              />
            ) : (
              <button
                onClick={onRunMonteCarlo}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium"
              >
                + Run simulations
              </button>
            )}
            {coastFireMcPhase !== "disabled" ? (
              <PhaseChip
                phase={coastFireMcPhase}
                label="Coast FIRE simulations"
                activeColor="text-amber-400"
              />
            ) : (
              <button
                onClick={onRunCoastFireMc}
                className="text-xs text-amber-400 hover:text-amber-300 font-medium"
              >
                + Run Coast FIRE simulations
              </button>
            )}
          </div>
          <SettingsTip />
        </div>
      </div>
    );
  }

  // ── Slim progress strip ────────────────────────────────────────────────────
  // Engine is done; show a lightweight strip while MC / Coast FIRE runs.
  if (mcLoading || coastLoading) {
    return (
      <div className="rounded-lg border border-subtle bg-surface-primary px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <PhaseChip
            phase={enginePhase}
            label="Projection engine"
            activeColor="text-blue-400"
          />
          {mcPhase !== "disabled" ? (
            <PhaseChip
              phase={mcPhase}
              label="Simulations"
              activeColor="text-purple-400"
            />
          ) : null}
          {coastFireMcPhase !== "disabled" ? (
            <PhaseChip
              phase={coastFireMcPhase}
              label="Coast FIRE simulations"
              activeColor="text-amber-400"
            />
          ) : null}
        </div>
        <SettingsTip />
      </div>
    );
  }

  return null;
}

// ── Internal sub-components ────────────────────────────────────────────────

function PhaseChip({
  phase,
  label,
  activeColor,
}: {
  phase: Phase;
  label: string;
  activeColor: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <PhaseIcon phase={phase} activeColor={activeColor} />
      <span
        className={`text-xs transition-colors ${
          phase === "active"
            ? activeColor
            : phase === "done"
              ? "text-green-500"
              : "text-faint"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function PhaseIcon({
  phase,
  activeColor,
}: {
  phase: Phase;
  activeColor: string;
}) {
  if (phase === "active") {
    return (
      <svg
        aria-hidden="true"
        className={`shrink-0 animate-spin h-3 w-3 ${activeColor}`}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    );
  }
  if (phase === "done") {
    return (
      <svg
        aria-hidden="true"
        className="shrink-0 h-3 w-3 text-green-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <span className="shrink-0 h-3 w-3 rounded-full border border-surface-strong" />
  );
}

function SettingsTip() {
  return (
    <p className="text-[10px] text-faint whitespace-nowrap">
      <a href="/settings" className="underline hover:text-muted">
        Settings → General
      </a>{" "}
      to configure
    </p>
  );
}
