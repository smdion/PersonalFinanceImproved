/**
 * Searches the household's own marginal bracket rates for the `rothBracketTarget` minimizing
 * lifetime tax plus a terminal penalty on unconverted Traditional money, while funding spending.
 * Calls `calculateProjection()` as a black box via `decumulationOverrides`; no engine changes.
 */
import { withControlledOverrides } from "@/lib/pure/contributions/controlled-overrides";
import { calculateProjection } from "../engine";
import type {
  ProjectionInput,
  DecumulationOverride,
  EngineDecumulationYear,
} from "../engine/types";

/** Tax rate assumed on the Traditional balance left at the plan's end: a
 *  flat guess, not the household's own future bracket. The ranking is
 *  insensitive to it above about 3%. */
export const ASSUMED_TERMINAL_RATE = 0.22;

export type BracketOptimizerCandidate = {
  target: number;
  netCost: number;
  /** Σ (`taxCost` + `rothConversionTaxCost` + `penaltyCost` + `irmaaCost`) over decumulation:
   *  the tax half of `netCost`, exposed so a comparison UI can show the real tradeoff. */
  lifetimeTax: number;
  /** Traditional (pre-tax) balance left at end of plan for this candidate —
   *  the quantity the terminal-value penalty in `netCost` is applied to. */
  traditionalEnd: number;
  /** Ranking signal: floored `unmetNeed` summed over `unmetNeedMaterial` years. Never add
   *  `penaltyAvoidedShortfall`/`nonRetirementShortfall`: they're subsets of `unmetNeed`. */
  shortfallScore: number;
  /** `retirementDepletionAge !== null`: a hard exclusion regardless of `netCost`. Depletion
   *  only, not assessPlan: unmet spending is ranked by `shortfallScore`, so a household where
   *  every candidate falls short still gets a ranking. */
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
 * Candidate rates: the household's own marginal bracket rates (`distributionTaxRates.taxBrackets`)
 * plus its current `rothBracketTarget`, so staying put is scored too. De-duplicated, ascending.
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

/** First year the plan is in decumulation — the input's own year, not a
 *  scan of `projectionByYear` (this runs BEFORE any projection exists). */
function firstDecumulationYear(input: ProjectionInput): number {
  return input.retirementYear;
}

/**
 * One candidate's input: a sticky `decumulationOverrides` entry from the first decumulation year,
 * moving `rothConversionTarget` and `rmdSmoothingMaxBracketTarget` with the bracket target when
 * those features are on, so each candidate is one the household could really adopt.
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
    // The candidate's fields win over the saved rows' — a saved later-year
    // row must not quietly undo the target being scored.
    decumulationOverrides: withControlledOverrides(
      input.decumulationOverrides,
      [override],
    ),
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
 * `netCost = lifetimeTax + ASSUMED_TERMINAL_RATE * finalYear.balanceByTaxType.preTax`. The
 * terminal term is required: without it the objective always prefers the highest target.
 */
function scoreCandidate(
  target: number,
  result: ReturnType<typeof calculateProjection>,
): BracketOptimizerCandidate {
  const decumYears = decumulationYears(result.projectionByYear);
  const lifetimeTax = decumYears.reduce(
    (sum, y) =>
      sum +
      y.taxCost +
      y.rothConversionTaxCost +
      (y.penaltyCost ?? 0) +
      y.irmaaCost,
    0,
  );
  const finalYear = result.projectionByYear[result.projectionByYear.length - 1];
  const traditionalEnd = finalYear?.balanceByTaxType.preTax ?? 0;
  const netCost = lifetimeTax + ASSUMED_TERMINAL_RATE * traditionalEnd;

  // Ranking signal: floored `unmetNeed` keyed off the canonical `unmetNeedMaterial` flag (see
  // BracketOptimizerCandidate.shortfallScore).
  const shortfallScore = decumYears.reduce(
    (sum, y) => sum + (y.unmetNeedMaterial ? (y.unmetNeed ?? 0) : 0),
    0,
  );

  return {
    target,
    netCost,
    lifetimeTax,
    traditionalEnd,
    shortfallScore,
    depleted: result.retirementDepletionAge !== null,
  };
}

/** Shortfall gap (dollars) below which two candidates tie: the solver's
 *  rounding moves `shortfallScore` by a few dollars between targets, and a
 *  strict comparison would let that noise pick the recommendation. */
const SHORTFALL_TIE_TOLERANCE = 50;

/**
 * Rank: `depleted` first (a hard exclusion), then `shortfallScore` ascending, then `netCost`.
 * Shortfall ranks rather than filters, so a household with a small shortfall year still gets one.
 */
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
 * Searches the household's own marginal bracket rates for the `rothBracketTarget` minimizing
 * lifetime tax (plus the terminal penalty) while funding spending through end of plan.
 * One `calculateProjection` per candidate rate (typically 3-5).
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
