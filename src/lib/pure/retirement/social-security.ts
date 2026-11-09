/**
 * Social Security claiming-age calculator: spousal "greater of" logic and a claiming-age sweep
 * calling `calculateProjection()` as a black box. PIA is a caller-supplied input; the
 * early/delayed adjustment math (fixed by law) lives in `lib/config/social-security.ts`.
 */
import { assessPlan } from "./plan-outcome";
import { calculateProjection } from "../engine";
import type { ProjectionInput } from "../engine/types";
import {
  getFullRetirementAge,
  getClaimingAdjustmentMultiplier,
  getSpousalAdjustmentMultiplier,
  SPOUSAL_BENEFIT_BASE_RATE,
  SS_EARLIEST_CLAIMING_AGE_MONTHS,
  SS_LATEST_CLAIMING_AGE_MONTHS,
} from "../../config/social-security";

/**
 * A worker's own adjusted annual benefit for claiming at `claimingAgeMonths` instead of FRA.
 * `pia` is the annual benefit at FRA (SSA quotes it monthly; the engine is annual).
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
 * The claiming spouse's annual benefit: own plus any spousal top-up, never two. The spousal
 * reduction runs on the CLAIMING spouse's FRA (POMS RS 00202.001). With `spouseOwnPia`, SSA's
 * reducedOwn + reducedExcess; without, max(own, reduced spousal), which can only understate.
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

type ClaimingAgeSweepCandidate = {
  /** Candidate claiming age, in whole years. */
  claimingAge: number;
  /** This person's adjusted annual benefit at this claiming age. */
  adjustedAnnualBenefit: number;
  /** Total net worth (all tax buckets) at end of plan for this candidate. */
  finalNetWorth: number;
  /** The plan fails for this candidate (assessPlan): a hard exclusion, never ranked in on
   *  `finalNetWorth`. */
  fails: boolean;
};

type ClaimingAgeSweepResult = {
  /** The claiming age that scores best among the candidates. `null` when
   *  every candidate fails (nothing safe to recommend). */
  recommendedAge: number | null;
  /** Sorted by rank (`compareCandidates`), not claiming age; an age-ordered table must sort by
   *  `claimingAge` itself. */
  candidates: ClaimingAgeSweepCandidate[];
};

type ClaimingAgeSweepOptions = {
  /** Base projection input, read only by the default candidate builder. */
  input: ProjectionInput;
  /** Whose claiming age to sweep, for the default builder and the displayed
   *  `adjustedAnnualBenefit`. */
  personId: number;
  /** This person's PIA (annual benefit at FRA). */
  pia: number;
  birthYear: number;
  /** Claiming ages to test, in whole years. Defaults to every age 62-70. */
  ages?: number[];
  /** Builds each candidate's input from a claiming age. Required for a multi-person household
   *  (the default builder would freeze a spouse's top-up); the router supplies it from the
   *  household's full `perPersonSettings`. */
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
 * Default candidate builder, correct only for a single-person household (no
 * `socialSecurityEntries`); throws for a multi-person one rather than freeze a spouse's entry.
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
  // Single person: the scalar path, as build-engine-payload.ts does. A synthesized
  // socialSecurityEntries array would switch on per-person RMD tracking production never uses.
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
 * Rank: `fails` first (a hard exclusion), then `finalNetWorth` descending (benefit-maximizing,
 * the reverse of the bracket optimizer's cost sort).
 */
function compareCandidates(
  a: ClaimingAgeSweepCandidate,
  b: ClaimingAgeSweepCandidate,
): number {
  if (a.fails !== b.fails) return a.fails ? 1 : -1;
  return b.finalNetWorth - a.finalNetWorth;
}

/**
 * Sweeps one person's claiming age over 62-70 (or a given subset) for the highest end-of-plan
 * household net worth, excluding failing candidates. One `calculateProjection` per age.
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
        fails: !assessPlan(result).succeeded,
      };
    })
    .sort(compareCandidates);

  const best = candidates[0];
  const recommendedAge =
    best === undefined || best.fails ? null : best.claimingAge;

  return { recommendedAge, candidates };
}
