/**
 * Social Security claiming-age calculator — spousal "greater of" logic and
 * a claiming-age sweep.
 *
 * Pure calculator — no DB, no tRPC, no React. Sits *above* the engine, same
 * architectural position as `withdrawal-bracket-optimizer.ts` and
 * `coast-fire.ts`: never imports engine internals, only calls
 * `calculateProjection()` as a black box and compares results.
 *
 * PIA (the benefit at Full Retirement Age) is a direct caller-supplied
 * input in this app, not derived from an earnings history — see
 * .scratch/docs/plans/SOCIAL-SECURITY-OPTIMIZATION-PLAN.md decision #1.
 * The early/delayed adjustment math itself lives in
 * `lib/config/social-security.ts` (fixed by law); this file is the layer
 * that applies it to a household's actual `ProjectionInput` and searches
 * across claiming ages.
 */
import { calculateProjection } from "./engine";
import type { ProjectionInput } from "./types";
import {
  getFullRetirementAge,
  getClaimingAdjustmentMultiplier,
  getSpousalAdjustmentMultiplier,
  SPOUSAL_BENEFIT_BASE_RATE,
  SS_EARLIEST_CLAIMING_AGE_MONTHS,
  SS_LATEST_CLAIMING_AGE_MONTHS,
  type FullRetirementAge,
} from "../config/social-security";

/**
 * A worker's own adjusted annual Social Security benefit for claiming at
 * `claimingAgeMonths` instead of FRA. `pia` is the annual benefit at FRA
 * (SSA's PIA is normally quoted monthly; this app's engine inputs are
 * annual, so pass PIA already annualized — same convention as the existing
 * `socialSecurityEntries[].annualAmount` field).
 */
export function computeAdjustedBenefit(
  pia: number,
  birthYear: number,
  claimingAgeMonths: number,
): number {
  const fra = getFullRetirementAge(birthYear);
  return pia * getClaimingAdjustmentMultiplier(fra, claimingAgeMonths);
}

/**
 * The claiming spouse's actual annual Social Security benefit, taking the
 * spousal benefit into account. A person receives their own benefit plus,
 * if entitled, a spousal top-up — never two full benefits.
 *
 * `workerPia` is the OTHER person's PIA — the only thing about the worker
 * that matters here (annual, as everywhere in this module). The spousal
 * reduction (25/36 of 1% per month early) is counted against the CLAIMING
 * SPOUSE's own Full Retirement Age, per SSA (POMS RS 00202.001 /
 * Pub 05-10035) — NOT the worker's FRA — so `spouseBirthYear` is the
 * claiming spouse's and the worker's birth year is not a parameter.
 *
 * With `spouseOwnPia` (the claiming spouse's OWN annual PIA — pass it
 * whenever the claiming spouse has opted into PIA), this uses SSA's exact
 * formula: `reducedOwn + reducedExcess`, where `reducedOwn` is the own PIA
 * cut by the OWN-benefit reduction schedule and `reducedExcess` is
 * `max(0, 0.5·workerPia − spouseOwnPia)` cut by the SPOUSAL reduction
 * schedule. The two schedules differ, so for an early claimer this is
 * strictly ≥ the `max(own, spousal)` shortcut (identical at/after FRA).
 *
 * Without `spouseOwnPia` (a claiming spouse still on the flat
 * pre-PIA `socialSecurityMonthly` model — no own-benefit-reduction
 * concept), it falls back to `max(ownAdjustedBenefit, reduced spousal
 * amount)`, which can only ever understate, never overstate.
 */
export function computeSpousalBenefit(
  ownAdjustedBenefit: number,
  workerPia: number,
  spouseBirthYear: number,
  spouseClaimingAgeMonths: number,
  spouseOwnPia?: number,
): number {
  const spouseFra = getFullRetirementAge(spouseBirthYear);
  const spousalMultiplier = getSpousalAdjustmentMultiplier(
    spouseFra,
    spouseClaimingAgeMonths,
  );

  if (spouseOwnPia != null) {
    const reducedOwn =
      spouseOwnPia *
      getClaimingAdjustmentMultiplier(spouseFra, spouseClaimingAgeMonths);
    const excess = Math.max(
      0,
      SPOUSAL_BENEFIT_BASE_RATE * workerPia - spouseOwnPia,
    );
    return reducedOwn + excess * spousalMultiplier;
  }

  const spousalAmount =
    workerPia * SPOUSAL_BENEFIT_BASE_RATE * spousalMultiplier;
  return Math.max(ownAdjustedBenefit, spousalAmount);
}

export type ClaimingAgeSweepCandidate = {
  /** Candidate claiming age, in whole years. */
  claimingAge: number;
  /** This person's adjusted annual benefit at this claiming age. */
  adjustedAnnualBenefit: number;
  /** Total net worth (all tax buckets) at end of plan for this candidate. */
  finalNetWorth: number;
  /** `portfolioDepletionAge !== null` for this candidate — a hard
   *  exclusion, never ranked in regardless of `finalNetWorth`, same
   *  convention as `withdrawal-bracket-optimizer.ts`'s `depleted`. */
  depleted: boolean;
};

export type ClaimingAgeSweepResult = {
  /** The claiming age that scores best among the candidates. `null` when
   *  every candidate is depleted (nothing safe to recommend). */
  recommendedAge: number | null;
  /** Sorted by RANK (best first, via `compareCandidates` — depletion
   *  exclusion, then descending final net worth), NOT by claiming age. A
   *  caller building an age-ordered comparison table must sort by
   *  `claimingAge` itself. */
  candidates: ClaimingAgeSweepCandidate[];
};

export type ClaimingAgeSweepOptions = {
  /** Base projection input. Only consulted by the DEFAULT candidate-input
   *  builder (see `buildCandidateInput`) — a caller that passes its own
   *  `buildCandidateInput` is free to derive candidates from richer data
   *  (e.g. the whole household's per-person settings) than this alone. */
  input: ProjectionInput;
  /** Which person's claiming age to sweep. Passed through to the default
   *  builder and to `computeAdjustedBenefit` for the displayed
   *  `adjustedAnnualBenefit` — not otherwise used when `buildCandidateInput`
   *  is supplied. */
  personId: number;
  /** This person's PIA (annual benefit at FRA). */
  pia: number;
  birthYear: number;
  /** Claiming ages to test, in whole years. Defaults to every age 62-70. */
  ages?: number[];
  /** Overrides how each candidate's `ProjectionInput` is built from a
   *  claiming age. REQUIRED for a multi-person household: the default
   *  builder only patches this person's own `socialSecurityEntries` entry
   *  in place and leaves every other entry (e.g. a spouse's spousal
   *  top-up, which depends on THIS person's claiming age) frozen at its
   *  base value — wrong for any household where spousal math is live.
   *  This module is pure (no server imports), so it can't call
   *  `buildSocialSecurityEntries` itself; the caller (the
   *  `sweepSocialSecurityClaimingAges` router, which has the household's
   *  full `perPersonSettings`) supplies it instead. Not consulted for a
   *  single-person household — the default scalar-override path is
   *  already correct there (see `buildCandidateInput`). */
  buildCandidateInput?: (
    claimingAge: number,
    adjustedAnnualBenefit: number,
  ) => ProjectionInput;
};

function defaultCandidateAges(): number[] {
  const ages: number[] = [];
  for (
    let months = SS_EARLIEST_CLAIMING_AGE_MONTHS;
    months <= SS_LATEST_CLAIMING_AGE_MONTHS;
    months += 12
  ) {
    ages.push(months / 12);
  }
  return ages;
}

/**
 * Default candidate-input builder — only correct for a single-person
 * household (no `socialSecurityEntries`). A multi-person household MUST
 * supply its own `buildCandidateInput` (see `ClaimingAgeSweepOptions`);
 * this throws rather than silently freezing a spouse's entry if one
 * wasn't provided.
 */
function buildDefaultCandidateInput(
  input: ProjectionInput,
  claimingAge: number,
  adjustedAnnualBenefit: number,
): ProjectionInput {
  if (input.socialSecurityEntries) {
    throw new Error(
      "sweepClaimingAges: a multi-person household (socialSecurityEntries present) requires an explicit buildCandidateInput — the default builder only patches one entry and would leave a spouse's spousal top-up frozen.",
    );
  }
  // Single-person household: mirror build-engine-payload.ts's own scalar
  // path exactly. Do NOT synthesize a socialSecurityEntries array here —
  // that would activate per-person RMD tracking (rmdStartAgeByPerson) that
  // a real single-person household's projection never uses, producing a
  // candidate whose RMD behavior doesn't match what production would
  // actually compute for this household.
  return {
    ...input,
    socialSecurityAnnual: adjustedAnnualBenefit,
    ssStartAge: claimingAge,
  };
}

function finalNetWorth(result: ReturnType<typeof calculateProjection>): number {
  const finalYear = result.projectionByYear[result.projectionByYear.length - 1];
  const balances = finalYear?.balanceByTaxType;
  if (!balances) return 0;
  return balances.preTax + balances.taxFree + balances.hsa + balances.afterTax;
}

/**
 * Lexicographic rank: `depleted` first (a candidate whose portfolio runs
 * out is a hard exclusion, never ranked in on `finalNetWorth` alone — same
 * convention as `withdrawal-bracket-optimizer.ts`'s `compareCandidates`),
 * then `finalNetWorth` descending (higher is better — unlike the bracket
 * optimizer's cost-minimization framing, this is a benefit-maximization
 * framing, so the sort direction is intentionally reversed).
 */
function compareCandidates(
  a: ClaimingAgeSweepCandidate,
  b: ClaimingAgeSweepCandidate,
): number {
  if (a.depleted !== b.depleted) return a.depleted ? 1 : -1;
  return b.finalNetWorth - a.finalNetWorth;
}

/**
 * Search claiming ages 62-70 (or a caller-supplied subset) for the one
 * person's Social Security claiming age that maximizes household net worth
 * at end of plan, while excluding any candidate that depletes the
 * portfolio.
 *
 * Cost: one `calculateProjection` call per candidate age (9 by default),
 * same order of magnitude as `optimizeRothBracketTarget`'s search.
 */
export function sweepClaimingAges(
  options: ClaimingAgeSweepOptions,
): ClaimingAgeSweepResult {
  const { input, pia, birthYear } = options;
  const ages = options.ages ?? defaultCandidateAges();
  const buildInput =
    options.buildCandidateInput ??
    ((claimingAge: number, adjustedAnnualBenefit: number) =>
      buildDefaultCandidateInput(input, claimingAge, adjustedAnnualBenefit));

  const candidates = ages
    .map((claimingAge) => {
      const adjustedAnnualBenefit = computeAdjustedBenefit(
        pia,
        birthYear,
        claimingAge * 12,
      );
      const candidateInput = buildInput(claimingAge, adjustedAnnualBenefit);
      const result = calculateProjection(candidateInput);
      return {
        claimingAge,
        adjustedAnnualBenefit,
        finalNetWorth: finalNetWorth(result),
        depleted: result.portfolioDepletionAge !== null,
      };
    })
    .sort(compareCandidates);

  const best = candidates[0];
  const recommendedAge =
    best === undefined || best.depleted ? null : best.claimingAge;

  return { recommendedAge, candidates };
}

export type { FullRetirementAge };
