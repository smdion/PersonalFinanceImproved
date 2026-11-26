/** The return rate a year's growth applies, from the plan's rate breakpoints. */
import { MIN_RETURN_RATE } from "../../constants";
import { returnRateAtAge } from "@/lib/pure/simulation/return-rate-breakpoints";

/**
 * Return rate for an age from a sparse breakpoint map: the breakpoint at or below `age`, throws
 * if none, floored at `MIN_RETURN_RATE`. Shared by growth and lookaheads (RMD smoothing).
 */
export function resolveReturnRateForAge(
  returnRateMap: Map<number, number>,
  age: number,
): number {
  const rate = returnRateAtAge(returnRateMap, age);
  if (rate === null) {
    throw new Error(
      `No return rate configured for age ${age}. Add return rates in retirement settings.`,
    );
  }
  return Math.max(MIN_RETURN_RATE, rate);
}
