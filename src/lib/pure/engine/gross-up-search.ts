/** The gross-up's search: the draw whose proceeds (what routing delivers, less its own cost) meet a need. */
import { roundToCents } from "../../utils/math";

/** Within a cent of the need: the search has converged, and the need is met. */
export const RESIDUAL_TOLERANCE = 0.01;

/** One trial draw's evaluation: its cost and what routing couldn't deliver of it. */
export type TrialCost = { routedUnmet: number; netCost: number };
export type Trial<E extends TrialCost> = { W: number; e: E };

// What a trial actually delivers: the router can come up short of W.
export const deliveredOf = (t: Trial<TrialCost>) =>
  roundToCents(t.W - t.e.routedUnmet);
export const proceedsOf = (t: Trial<TrialCost>) => deliveredOf(t) - t.e.netCost;

/**
 * Finds W with `delivered(W) - netCost(W) >= need` from `first`, where cost jumps and
 * isn't monotone: a bracket search (secant inside it, else bisect; Picard under a
 * $1 span) returning `hi`, short of the need only when no larger W delivers more.
 */
export function searchGrossUp<E extends TrialCost>(
  need: number,
  pool: number,
  first: Trial<E>,
  evaluate: (W: number, from: E) => E,
): Trial<E> {
  // Smooth years exit in ~3 trials; 20 halvings take a five-figure bracket under
  // $0.10, inside the $1 a year may stop at. Short of the need, the gap is unmet.
  const MAX_TRIALS = 20;
  // Below this span, a secant slope between two cent-rounded costs is noise.
  const MIN_SECANT_SPAN = 1;

  const residualOf = (t: Trial<E>) => roundToCents(need - proceedsOf(t));

  let trial = first;
  let lo: Trial<E> | null = null;
  let hi: Trial<E> | null = null;
  // Bracket widths after the last two trials, for the forced bisection.
  let widthOneAgo = Infinity;
  let widthTwoAgo = Infinity;
  let prev: Trial<E> | null = null;
  let trials = 1;

  for (;;) {
    const residual = residualOf(trial);
    if (Math.abs(residual) <= RESIDUAL_TOLERANCE) break;
    if (residual > 0) {
      // Short of the need and no larger trial can do better: the whole pool is
      // asked for, or more W delivered nothing more (then the smaller trial wins;
      // asking for unreachable money only inflates the routed shortfall).
      if (trial.W >= pool - 0.01) break;
      if (
        trial.e.routedUnmet > 0.01 &&
        lo != null &&
        deliveredOf(trial) <= deliveredOf(lo) + 0.01
      ) {
        trial = lo;
        break;
      }
      if (lo == null || trial.W > lo.W) lo = trial;
    } else if (hi == null || trial.W < hi.W) {
      hi = trial;
    }
    if (lo != null && hi != null && hi.W - lo.W <= 0.01) break;
    if (lo == null || trials >= MAX_TRIALS) break;
    const width = hi != null ? hi.W - lo.W : Infinity;
    const bisectNow = hi != null && width > widthTwoAgo / 2;
    widthTwoAgo = widthOneAgo;
    widthOneAgo = width;

    let nextW = need + trial.e.netCost; // Picard
    if (prev != null && Math.abs(trial.W - prev.W) >= MIN_SECANT_SPAN) {
      const slope = (proceedsOf(trial) - proceedsOf(prev)) / (trial.W - prev.W);
      if (slope > 0 && Number.isFinite(slope))
        nextW = trial.W + residual / slope;
    }
    nextW = roundToCents(Math.min(nextW, pool));
    if (bisectNow || !(nextW > lo.W && (hi == null || nextW < hi.W))) {
      nextW =
        hi != null
          ? roundToCents((lo.W + hi.W) / 2)
          : roundToCents(Math.min(pool, lo.W + Math.max(0.01, residual)));
    }

    prev = trial;
    trial = { W: nextW, e: evaluate(nextW, trial.e) };
    trials++;
  }
  // Not converged: the smallest trial known to meet the need, if any.
  if (hi != null && Math.abs(residualOf(trial)) > RESIDUAL_TOLERANCE)
    trial = hi;
  return trial;
}
