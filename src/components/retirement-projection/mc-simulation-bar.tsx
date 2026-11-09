/** The Simulation bar: what was run, its stat tiles and its run controls. */
import { gkAnchorRate } from "@/lib/pure/retirement/gk-anchor-rate";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { ControlZone } from "./pill-btn";
import { formatPercent } from "@/lib/utils/format";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types";
import type { ProjectionState } from "./projection-table-types";
import {
  SimulationRateTiles,
  SimulationRunTiles,
  SimulationRunControls,
} from "./mc-summary-tiles";

export type SimulationBarProps = {
  si: NonNullable<
    Extract<
      NonNullable<ProjectionState["mcQuery"]["data"]>,
      { simulationInputs: unknown }
    >["simulationInputs"]
  >;
  mcr: NonNullable<NonNullable<ProjectionState["mcQuery"]["data"]>["result"]>;
  result: ProjectionState["result"];
  deflate: ProjectionState["deflate"];
  dollarMode: ProjectionState["dollarMode"];
  handleRerun: ProjectionState["rerunAllMc"];
  isRerunning: ProjectionState["isRerunning"];
  handleClearCache: () => void;
  clearProjectionCacheMutation: ProjectionState["clearProjectionCacheMutation"];
  setShowAssumptions: ProjectionState["setShowAssumptions"];
};

/** The Simulation bar: the preset, the stat tiles and the run controls. */
export function SimulationBar({
  si,
  mcr,
  result,
  deflate,
  dollarMode,
  handleRerun,
  isRerunning,
  handleClearCache,
  clearProjectionCacheMutation,
  setShowAssumptions,
}: SimulationBarProps) {
  // First decumulation year — the same year Guyton-Klinger's
  // anchor rate below is captured from, and also the source
  // for the "starting income" tile: `spending` is what the
  // household spends that year under the ACTIVE strategy (per
  // coast-fire.ts's docblock — for every strategy but the 4
  // budget-continuation ones this is real, strategy-computed
  // math, not an echo of a flat rate setting), so this reflects
  // whatever withdrawal strategy/override is actually driving
  // the household's plan, not si.withdrawalRate.
  let firstDecumYear: EngineDecumulationYear | null = null;
  if (result) {
    const years = result.projectionByYear;
    for (let i = 0; i < years.length; i++) {
      const y = years[i]!;
      if (y.phase === "decumulation") {
        firstDecumYear = y;
        break;
      }
    }
  }

  // Guyton-Klinger's actual starting rate (see gkAnchorRate).
  const gkImpliedRate =
    si.withdrawalStrategy === "guyton_klinger" && result
      ? gkAnchorRate(result.projectionByYear)
      : null;

  const presetBar: Record<
    string,
    {
      border: string;
      pill: string;
      accent: string;
    }
  > = {
    aggressive: {
      border: "border-red-200",
      pill: "text-white bg-red-500",
      accent: "text-red-700",
    },
    default: {
      border: "border-blue-200",
      pill: "text-white bg-blue-500",
      accent: "text-blue-700",
    },
    conservative: {
      border: "border-green-200",
      pill: "text-white bg-green-600",
      accent: "text-green-700",
    },
    custom: {
      border: "border-purple-200",
      pill: "text-white bg-purple-500",
      accent: "text-purple-700",
    },
  };
  const ps = presetBar[si.preset] ?? presetBar["default"]!;
  // Asset mix behind the blended return/volatility tiles — same
  // weights (current glide-path allocation) for both, so one
  // description serves both tooltips.
  const mixLines = si.assetClasses
    .map((ac) => {
      const w = si.currentAllocation[ac.id] ?? 0;
      return w > 0
        ? `${formatPercent(w, 0)} ${ac.name} (${formatPercent(ac.meanReturn, 1)} return, ${formatPercent(ac.stdDev, 1)} volatility)`
        : null;
    })
    .filter((l): l is string => l !== null);
  return (
    <ControlZone tone="results" title="Simulation" why="what was run">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-caption rounded-md px-2 py-0.5 font-bold tracking-wider uppercase shadow-sm ${ps.pill}`}
          >
            {si.presetLabel}
          </span>
          <HelpTip
            maxWidth={280}
            text={`${si.presetDescription} Every trial in this simulation draws from these same return/volatility/inflation assumptions — the withdrawal strategy below (${si.withdrawalStrategy.replace(/_/g, " ")}) only decides how much gets spent each year, not what the market does.`}
          />
          {si.taxMode === "advanced" && (
            <span className="text-caption inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700">
              Tax-aware
              <HelpTip
                maxWidth={260}
                text="Advanced tax mode: every simulated trial tracks each account's own tax treatment (Traditional/Roth/HSA/brokerage) separately when computing withdrawals. Simple mode collapses these into one approximate balance instead, trading some precision for speed."
              />
            </span>
          )}
          {si.hasAssetClassOverrides && (
            <Badge color="amber" size="sm" case="normal">
              Your figures
              <HelpTip
                maxWidth={260}
                text="One or more asset classes are using custom return/volatility figures instead of this preset's own values — the return, volatility, and asset-mix figures below already reflect your numbers."
              />
            </Badge>
          )}
        </div>
        <div className="text-muted flex items-center gap-3 text-xs">
          <SimulationRateTiles
            si={si}
            mixLines={mixLines}
            gkImpliedRate={gkImpliedRate}
          />
          <SimulationRunTiles
            firstDecumYear={firstDecumYear}
            deflate={deflate}
            si={si}
            dollarMode={dollarMode}
            mcr={mcr}
          />
        </div>
        <SimulationRunControls
          si={si}
          handleRerun={handleRerun}
          isRerunning={isRerunning}
          handleClearCache={handleClearCache}
          clearProjectionCacheMutation={clearProjectionCacheMutation}
          setShowAssumptions={setShowAssumptions}
          ps={ps}
        />
      </div>
    </ControlZone>
  );
}
