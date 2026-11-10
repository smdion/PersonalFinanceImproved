import type { SimulationInputs } from "./mc-simulation-types";
import { formatPercent } from "@/lib/utils/format";

export type AssumptionsOverviewProps = {
  activeOverrides: string[];
  fanBandRange: "off" | "p25-p75" | "p10-p90" | "p5-p95";
  inputs: SimulationInputs;
  numTrials: number;
  presetColors: Record<string, string>;
};

export function AssumptionsOverview({
  activeOverrides,
  fanBandRange,
  inputs,
  numTrials,
  presetColors,
}: AssumptionsOverviewProps) {
  return (
    <>
      {/* Preset badge + description */}
      <div
        className={`text-label rounded border px-2.5 py-2 leading-relaxed ${presetColors[inputs.preset]}`}
      >
        <span className="text-caption font-bold tracking-wider uppercase">
          {inputs.presetLabel}
        </span>
        <span className="mx-1.5">&mdash;</span>
        {inputs.presetDescription}
      </div>
      {/* Tax mode badge */}
      <div
        className={`text-label rounded border px-2.5 py-2 leading-relaxed ${
          inputs.taxMode === "simple"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-orange-200 bg-orange-50 text-orange-700"
        }`}
      >
        <span className="text-caption font-bold tracking-wider uppercase">
          {inputs.taxMode === "simple" ? "Simple" : "Advanced"}
        </span>
        <span className="mx-1.5">&mdash;</span>
        {inputs.taxMode === "simple"
          ? "Single balance, no tax (cFIREsim-comparable)"
          : "Tax-aware multi-account simulation with gross-up"}
      </div>

      {/* ELI5 explanation */}
      <div className="text-label text-muted bg-surface-primary border-subtle rounded border px-2.5 py-2 leading-relaxed">
        This runs{" "}
        <span className="text-secondary font-semibold">
          {numTrials.toLocaleString()}
        </span>{" "}
        simulated futures. Each trial randomizes annual investment returns
        (correlated log-normal draws per asset class) and inflation (your{" "}
        {formatPercent(inputs.inflationRate, 1)} &plusmn;{" "}
        {formatPercent(inputs.inflationRisk.stdDev, 1)} std dev). Your portfolio
        follows a glide path that shifts from stocks to bonds as you age. At
        your current allocation, the blended expected return is{" "}
        <span className="text-secondary font-semibold">
          {formatPercent(inputs.blendedReturn, 1)}
        </span>{" "}
        with{" "}
        <span className="text-secondary font-semibold">
          {formatPercent(inputs.blendedVol, 1)}
        </span>{" "}
        volatility. The fan chart shows the{" "}
        {fanBandRange === "p5-p95"
          ? "90%"
          : fanBandRange === "p10-p90"
            ? "80%"
            : "50%"}{" "}
        confidence range across all trials.
      </div>

      {/* Active overrides callout */}
      {activeOverrides.length > 0 && (
        <div className="text-label rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-700">
          <span className="font-semibold">Set by you:</span>
          <ul className="mt-0.5 ml-3 list-disc space-y-0">
            {activeOverrides.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
