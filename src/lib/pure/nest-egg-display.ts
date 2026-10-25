/**
 * One rule for showing a nest egg, simulated or baseline — used by the
 * dashboard's Retirement card and the Retirement page's hero so the two
 * never pick, convert or label the figure differently.
 *
 * With a simulation for the current inputs: its median and middle-half
 * range at the target age (retirement age, or today when already retired),
 * with the fixed-return baseline alongside. Without one — or for a person
 * filter, since the simulation is the whole household's — the baseline
 * alone.
 */
import type { MonteCarloPercentileBand } from "@/lib/calculators/types";

export type NestEggDisplay =
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
   *  for these inputs. */
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
  /** Nominal dollars in `year` → display dollars (today's or future) —
   *  the same conversion the baseline went through. */
  toDisplay: (value: number, year: number) => number;
  personFiltered: boolean;
}): NestEggDisplay {
  const band = opts.personFiltered
    ? undefined
    : opts.bands?.find((b) => b.age === opts.targetAge);
  if (!band) return { kind: "baseline", baseline: opts.baseline };
  return {
    kind: "simulated",
    median: opts.toDisplay(band.p50, band.year),
    low: opts.toDisplay(band.p25, band.year),
    high: opts.toDisplay(band.p75, band.year),
    baseline: opts.baseline,
  };
}

/**
 * The fixed-return nest egg in nominal dollars, and its year: the engine's
 * retirement money (`retirementBalance`) at the target age — the retirement
 * answer, never a view's summed tax buckets. The caller converts it with
 * the same `toDisplay` it gives `simulatedOrBaseline`, so the baseline and
 * the simulated range go through one conversion. Null when the projection
 * has no year at that age.
 */
export function baselineNestEgg(
  years: readonly { age: number; year: number; retirementBalance: number }[],
  targetAge: number,
): { nominal: number; year: number } | null {
  const y = years.find((r) => r.age === targetAge);
  return y ? { nominal: y.retirementBalance, year: y.year } : null;
}
