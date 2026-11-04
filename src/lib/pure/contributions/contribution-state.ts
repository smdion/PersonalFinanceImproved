/**
 * Whether a working year saves: contributing at its rate, paused (a change
 * to a 0% rate: no retirement contributions, no match that needs them,
 * flat employer money continues) or stopped (nothing in, no match).
 */
import { storedCeiling, type Ceiling } from "../../utils/ceiling";

export type ContributionState =
  | { readonly kind: "contributing"; readonly rate: number }
  | { readonly kind: "paused" }
  | { readonly kind: "stopped" };

export function contributionStateForYear(year: {
  /** Year 0's real paycheck contributions, which already happened. */
  readonly actual: boolean;
  /** Nobody saves this year (a gap-year choice, or nobody at work). */
  readonly savingStopped: boolean;
  /** This year's resolved retirement contribution rate. */
  readonly rate: number;
  /** The plan's own rate. */
  readonly defaultRate: number;
  readonly salary: number;
}): ContributionState {
  if (year.actual) return { kind: "contributing", rate: year.rate };
  if (year.savingStopped) return { kind: "stopped" };
  // A plan whose own rate is 0 has no rate to pause; no salary isn't a pause.
  if (year.rate === 0 && year.defaultRate > 0 && year.salary > 0)
    return { kind: "paused" };
  return { kind: "contributing", rate: year.rate };
}

/** The ceiling the retirement rate puts on the year's retirement
 *  contributions (`amount` is rate × pay): 0 when paused; a 0 rate
 *  otherwise sets no limit. */
export function retirementRateCeiling(
  state: ContributionState,
  amount: number,
): Ceiling {
  return state.kind === "paused"
    ? { kind: "at", amount: 0 }
    : storedCeiling(amount);
}
