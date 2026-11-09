/**
 * One rule for showing a nest egg (dashboard Retirement card, Retirement hero): the simulation's
 * median and middle-half range at the target age with the fixed-return baseline alongside, or the
 * baseline alone without a current simulation or under a person filter.
 */
import type { MonteCarloPercentileBand } from "@/lib/pure/simulation/monte-carlo.types";

type NestEggDisplay =
  | {
      kind: "simulated";
      median: number;
      low: number;
      high: number;
      baseline: number;
    }
  | { kind: "baseline"; baseline: number };

export function simulatedOrBaseline(opts: {
  /** The simulation's balance bands (retirement money), if one was run
   *  for these inputs — already in display dollars (`simulationDollars`:
   *  today's are deflated per trial, so they're never converted here). */
  bands:
    | readonly Pick<
        MonteCarloPercentileBand,
        "age" | "year" | "p25" | "p50" | "p75"
      >[]
    | null
    | undefined;
  /** The fixed-return figure, already in display dollars. */
  baseline: number;
  /** Retirement age, or the current age when already retired. */
  targetAge: number;
  personFiltered: boolean;
}): NestEggDisplay {
  const band = opts.personFiltered
    ? undefined
    : opts.bands?.find((b) => b.age === opts.targetAge);
  if (!band) return { kind: "baseline", baseline: opts.baseline };
  return {
    kind: "simulated",
    median: band.p50,
    low: band.p25,
    high: band.p75,
    baseline: opts.baseline,
  };
}

/**
 * The fixed-return nest egg (engine `retirementBalance`) in nominal dollars at the target age,
 * and its year; the caller deflates it (simulated bands arrive in display dollars). Null when
 * the projection has no year at that age.
 */
export function baselineNestEgg(
  years: readonly { age: number; year: number; retirementBalance: number }[],
  targetAge: number,
): { nominal: number; year: number } | null {
  const y = years.find((r) => r.age === targetAge);
  return y ? { nominal: y.retirementBalance, year: y.year } : null;
}
