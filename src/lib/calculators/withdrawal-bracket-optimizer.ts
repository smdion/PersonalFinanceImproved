/**
 * Multi-year withdrawal-policy optimizer — `rothBracketTarget`
 * search.
 *
 * Pure calculator — no DB, no tRPC, no React. Sits *above* the engine, same
 * architectural position as `coast-fire.ts`: never imports engine internals,
 * only calls `calculateProjection()` as a black box and compares results.
 *
 * What this solves: bracket_filling (and Roth conversions/RMD smoothing
 * layered on top of it) all read a single, fixed `rothBracketTarget` for
 * the whole plan. Households rarely pick the genuinely cost-minimizing
 * value for that target themselves — this searches the household's own
 * real marginal bracket rates and recommends whichever one minimizes
 * lifetime tax cost (plus a terminal-value penalty for Traditional money
 * left unconverted at end of plan), while still funding the household's
 * spending need.
 *
 * What this does NOT do: change withdrawal routing itself, add a new
 * `withdrawalRoutingMode`, or touch any engine module. It only constructs
 * candidate `ProjectionInput`s (via `decumulationOverrides`) and scores
 * the results — the exact same trick `findCoastFireAge` already uses to
 * answer "what's the earliest coast age" without becoming part of the
 * engine itself.
 */
import { calculateProjection } from "./engine";
import type {
  ProjectionInput,
  DecumulationOverride,
  EngineDecumulationYear,
} from "./types";

/**
 * v1 ships this as a fixed constant, empirically checked across a wide
 * range in the design doc's round 3 sensitivity pass (any value above
 * ~3% produced the same ranking for the test household — not fragile for
 * the common case). A real v1.1 candidate is deriving this from the
 * household's own projected future bracket instead of a flat guess;
 * deliberately deferred, not attempted here. Named and exported so it's
 * visible, not buried inside the scoring function.
 */
export const ASSUMED_TERMINAL_RATE = 0.22;

export type BracketOptimizerCandidate = {
  target: number;
  netCost: number;
  /** Ranking signal — floored `unmetNeed` summed over years where
   *  `unmetNeedMaterial` is true. NOT a sum of `unmetNeed` +
   *  `penaltyAvoidedShortfall` + `nonRetirementShortfall` — those two are
   *  documented subsets of `unmetNeed` (`engine-projection.ts`), not
   *  independent dollars, so summing all three would double/triple-count
   *  the same shortfall. */
  shortfallScore: number;
  /** `portfolioDepletionAge !== null` for this candidate — a hard
   *  exclusion, never ranked in regardless of its `netCost`. */
  depleted: boolean;
};

export type BracketOptimizerResult = {
  /** The target to switch to. `null` = the current setting already scores
   *  best among the candidates (or no candidate is feasible), i.e. there
   *  is nothing to recommend. */
  recommendedTarget: number | null;
  /** The household's current `rothBracketTarget`, echoed back so a caller
   *  doesn't need to re-derive it from `input` to compare against
   *  `recommendedTarget`. `null` when the plan has none configured. */
  currentTarget: number | null;
  candidates: BracketOptimizerCandidate[];
};

/**
 * Build the candidate rate set: the household's own real marginal bracket
 * rates (from `distributionTaxRates.taxBrackets`, the household's actual
 * W-4/filing-status brackets — never a hardcoded list), plus whatever the
 * household's current `rothBracketTarget` already is, so "stay where you
 * are" is always itself a scored candidate. De-duplicated, ascending.
 */
function candidateRates(input: ProjectionInput): number[] {
  const brackets = input.decumulationDefaults.distributionTaxRates.taxBrackets;
  const rates = new Set<number>();
  for (const b of brackets ?? []) {
    if (b.rate > 0) rates.add(b.rate);
  }
  const current =
    input.decumulationDefaults.distributionTaxRates.rothBracketTarget;
  if (current != null) rates.add(current);
  return Array.from(rates).sort((a, b) => a - b);
}

/** First year the plan is in decumulation, matching how `coast-fire.ts`
 *  derives its own probe years — `currentYear + (retirementAge -
 *  currentAge)`, not a scan of `projectionByYear` (this runs BEFORE any
 *  projection exists). */
function firstDecumulationYear(input: ProjectionInput): number {
  const currentYear = input.asOfDate.getFullYear();
  return currentYear + (input.retirementAge - input.currentAge);
}

/**
 * Build one candidate's `ProjectionInput`: a single `decumulationOverrides`
 * entry at the first decumulation year, sticky-forward (no reset, no later
 * entry) so it applies from retirement through end of plan — round 1's
 * answered question 1, no per-person window truncation.
 *
 * Sets `rothConversionTarget` to the SAME value as `rothBracketTarget`
 * whenever the household has `enableRothConversions` on (round 3/4's
 * resolved "joint policy, not an artificial freeze" design — searching
 * the bracket target without moving the conversion target alongside it
 * would silently evaluate a candidate the household could never actually
 * adopt as configured). Likewise threads `rmdSmoothingMaxBracketTarget`
 * to the same value when `rmdSmoothingEnabled` is on (Phase 1 plumbing,
 * used here for the first time) so a candidate is scored against the
 * ceiling it would really get, not a stale one seeded from a different
 * target.
 */
function buildCandidateInput(
  input: ProjectionInput,
  target: number,
): ProjectionInput {
  const { distributionTaxRates } = input.decumulationDefaults;
  const override: DecumulationOverride = {
    year: firstDecumulationYear(input),
    rothBracketTarget: target,
    ...(distributionTaxRates.enableRothConversions
      ? { rothConversionTarget: target }
      : {}),
    ...(input.decumulationDefaults.rmdSmoothingEnabled
      ? { rmdSmoothingMaxBracketTarget: target }
      : {}),
  };
  return {
    ...input,
    decumulationOverrides: [...input.decumulationOverrides, override],
  };
}

function decumulationYears(
  projectionByYear: (EngineDecumulationYear | { phase: string })[],
): EngineDecumulationYear[] {
  return projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
}

/**
 * Score one candidate: `netCost = lifetimeTax + ASSUMED_TERMINAL_RATE *
 * finalYear.balanceByTaxType.preTax`. `lifetimeTax` sums `taxCost +
 * rothConversionTaxCost + penaltyCost + irmaaCost` over every decumulation
 * year — the terminal-value term is load-bearing, NOT optional: without
 * it the objective is monotone in deferral (always prefers the highest
 * target, since converting nothing is always cheapest THIS year), so
 * dropping it would silently break the search rather than just make it
 * less accurate.
 */
function scoreCandidate(
  target: number,
  result: ReturnType<typeof calculateProjection>,
): BracketOptimizerCandidate {
  const decumYears = decumulationYears(result.projectionByYear);
  const lifetimeTax = decumYears.reduce(
    (sum, y) =>
      sum +
      (y.taxCost ?? 0) +
      (y.rothConversionTaxCost ?? 0) +
      (y.penaltyCost ?? 0) +
      (y.irmaaCost ?? 0),
    0,
  );
  const finalYear = result.projectionByYear[result.projectionByYear.length - 1];
  const traditionalEnd = finalYear?.balanceByTaxType?.preTax ?? 0;
  const netCost = lifetimeTax + ASSUMED_TERMINAL_RATE * traditionalEnd;

  // Ranking signal: floored `unmetNeed`, keyed off the canonical
  // `unmetNeedMaterial` flag (`engine-projection.ts` — "consumers must
  // key off THIS field rather than re-deriving their own materiality
  // threshold"). Deliberately NOT unmetNeed + penaltyAvoidedShortfall +
  // nonRetirementShortfall — see this file's docblock and
  // BracketOptimizerCandidate.shortfallScore.
  const shortfallScore = decumYears.reduce(
    (sum, y) => sum + (y.unmetNeedMaterial ? (y.unmetNeed ?? 0) : 0),
    0,
  );

  return {
    target,
    netCost,
    shortfallScore,
    depleted: result.portfolioDepletionAge !== null,
  };
}

/**
 * Lexicographic rank: `depleted` first (any candidate whose portfolio
 * actually runs out is a hard exclusion, never ranked in on `netCost`
 * alone — depletion isn't the kind of small residual this ranking is
 * meant to tolerate), then `shortfallScore` ascending, then `netCost`
 * ascending.
 *
 * Not a binary pass/fail filter: a hard "any shortfall excludes the
 * candidate" gate rejected every non-depleted candidate on the design
 * doc's round-4 test household because of an unrelated, target-
 * independent residual — a real household can very plausibly carry at
 * least one small shortfall year somewhere across a 30+ year horizon, and
 * a binary gate would return nothing for exactly the households most
 * likely to need this.
 */
/**
 * `shortfallScore` isn't bit-identical across candidates even when the
 * underlying shortfall is genuinely target-independent (the design doc's
 * "known limitation" — a tax-gross-up convergence artifact, not something
 * this feature causes): different `rothBracketTarget` overrides produce
 * slightly different intermediate rounding paths through the same
 * shortfall year, so two candidates that are financially identical on
 * this dimension can differ by a few dollars. A strict `!==` comparison
 * would let that sub-dollar noise, not the six-figure `netCost` spread it
 * sits in front of, decide the recommendation — empirically verified: it
 * did, on the design doc's own round-4 test household, before this
 * tolerance was added. Matches the codebase's existing $50 materiality
 * floor for "is this shortfall real" (`coast-fire.ts`'s `passes()`,
 * `decumulation-year.ts`'s `shortfallMaterialityFloor`) — a
 * `shortfallScore` gap smaller than this is noise, not a differentiator.
 */
const SHORTFALL_TIE_TOLERANCE = 50;

function compareCandidates(
  a: BracketOptimizerCandidate,
  b: BracketOptimizerCandidate,
): number {
  if (a.depleted !== b.depleted) return a.depleted ? 1 : -1;
  if (Math.abs(a.shortfallScore - b.shortfallScore) > SHORTFALL_TIE_TOLERANCE)
    return a.shortfallScore - b.shortfallScore;
  return a.netCost - b.netCost;
}

/**
 * Search the household's own real marginal bracket rates for the
 * `rothBracketTarget` that minimizes lifetime tax cost (plus a terminal-
 * value penalty for Traditional money left unconverted), while still
 * funding spending need through end of plan.
 *
 * Cost: one `calculateProjection` call per candidate rate (typically
 * 3-5 — the household's own bracket count, deduplicated with its current
 * setting), same order of magnitude as `findCoastFireAge`'s binary search.
 */
export function optimizeRothBracketTarget(
  input: ProjectionInput,
): BracketOptimizerResult {
  const currentTarget =
    input.decumulationDefaults.distributionTaxRates.rothBracketTarget ?? null;
  const rates = candidateRates(input);

  const candidates = rates
    .map((target) => {
      const candidateInput = buildCandidateInput(input, target);
      const result = calculateProjection(candidateInput);
      return scoreCandidate(target, result);
    })
    .sort(compareCandidates);

  const best = candidates[0];
  const recommendedTarget =
    best === undefined || best.depleted || best.target === currentTarget
      ? null
      : best.target;

  return { recommendedTarget, currentTarget, candidates };
}
