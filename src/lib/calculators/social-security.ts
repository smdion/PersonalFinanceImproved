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
 * A household's actual spousal benefit: the GREATER of the spouse's own
 * adjusted benefit or the spousal amount (up to 50% of the higher earner's
 * PIA, reduced for the spouse's own early claiming). Never additive — a
 * household never receives both, and a naive `own + spousal` sum would
 * overstate real income.
 */
export function computeSpousalBenefit(
  ownAdjustedBenefit: number,
  higherEarnerPia: number,
  higherEarnerBirthYear: number,
  spouseClaimingAgeMonths: number,
): number {
  const higherEarnerFra = getFullRetirementAge(higherEarnerBirthYear);
  const spousalMultiplier = getSpousalAdjustmentMultiplier(
    higherEarnerFra,
    spouseClaimingAgeMonths,
  );
  const spousalAmount =
    higherEarnerPia * SPOUSAL_BENEFIT_BASE_RATE * spousalMultiplier;
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
  /** Base projection input. If it has `socialSecurityEntries` (a
   *  multi-person household), there must be an entry matching `personId` —
   *  the sweep overrides that entry's `annualAmount`/`startAge` per
   *  candidate age and leaves every other entry (e.g. a spouse's)
   *  unchanged. If `socialSecurityEntries` is absent (a single-person
   *  household), the sweep instead overrides the SCALAR
   *  `socialSecurityAnnual`/`ssStartAge` fields — mirroring
   *  `build-engine-payload.ts`'s own single-person path, which
   *  deliberately never populates `socialSecurityEntries` (doing so would
   *  silently activate per-person RMD tracking a single-person household's
   *  real projection never uses — see the long comment there). This
   *  distinction is load-bearing: candidates built here must match
   *  production's real household-size branching, or the sweep would
   *  recommend an age based on a projection shape production never
   *  actually runs. */
  input: ProjectionInput;
  /** Which person's claiming age to sweep. For a multi-person household,
   *  matches `socialSecurityEntries[].personId`. For a single-person
   *  household (no entries), this is assumed to be that one person — not
   *  independently verified, since there's no entries array to check it
   *  against. */
  personId: number;
  /** This person's PIA (annual benefit at FRA). */
  pia: number;
  birthYear: number;
  /** Claiming ages to test, in whole years. Defaults to every age 62-70. */
  ages?: number[];
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

function buildCandidateInput(
  input: ProjectionInput,
  personId: number,
  claimingAge: number,
  adjustedAnnualBenefit: number,
): ProjectionInput {
  const entries = input.socialSecurityEntries;
  if (!entries) {
    // Single-person household: mirror build-engine-payload.ts's own
    // scalar path exactly. Do NOT synthesize a socialSecurityEntries array
    // here — that would activate per-person RMD tracking
    // (rmdStartAgeByPerson) that a real single-person household's
    // projection never uses, producing a candidate whose RMD behavior
    // doesn't match what production would actually compute for this
    // household.
    return {
      ...input,
      socialSecurityAnnual: adjustedAnnualBenefit,
      ssStartAge: claimingAge,
    };
  }
  if (!entries.some((e) => e.personId === personId)) {
    throw new Error(
      `sweepClaimingAges: no socialSecurityEntries entry for personId ${personId}`,
    );
  }
  return {
    ...input,
    socialSecurityEntries: entries.map((e) =>
      e.personId === personId
        ? { ...e, annualAmount: adjustedAnnualBenefit, startAge: claimingAge }
        : e,
    ),
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
  const { input, personId, pia, birthYear } = options;
  const ages = options.ages ?? defaultCandidateAges();

  const candidates = ages
    .map((claimingAge) => {
      const adjustedAnnualBenefit = computeAdjustedBenefit(
        pia,
        birthYear,
        claimingAge * 12,
      );
      const candidateInput = buildCandidateInput(
        input,
        personId,
        claimingAge,
        adjustedAnnualBenefit,
      );
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
