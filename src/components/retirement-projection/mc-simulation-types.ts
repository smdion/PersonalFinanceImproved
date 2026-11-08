import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

/** The inputs computeMonteCarloProjection reports it ran with. */
export type SimulationInputs = Extract<
  RouterOutputs["projection"]["computeMonteCarloProjection"],
  { simulationInputs: unknown }
>["simulationInputs"];

/** One asset class's return/volatility override, as the query takes it. */
export type AssetClassOverride = NonNullable<
  RouterInputs["projection"]["computeMonteCarloProjection"]["assetClassOverrides"]
>[number];

/** In the dollars the page shows (`simulationDollars` — today's are the
 *  Simulation's per-trial deflation), so nothing here is deflated again. */
export type OutcomeDistribution = {
  successRate: number;
  medianEndBalance: number;
  p5EndBalance: number;
  terminalBalance: {
    p10: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
  };
  sustainableWithdrawalPV: { p25: number; p75: number };
  failureAge?: { median: number };
  computeTimeMs: number;
};
