/**
 * Sizes Roth conversions to shrink a future RMD toward projected spending need, netting out
 * estimated Traditional withdrawals. A cheap per-person analytical loop (no nested
 * re-simulation); each person's target sums into one household minimum.
 */
import { roundToCents, safeDivide } from "../../utils/math";
import { getRmdFactor } from "../../config/rmd-tables";
import { resolveReturnRateForAge } from "./growth-application";

export interface RmdSmoothingPersonInput {
  personId: number;
  /** This person's current age this projected year. */
  currentAge: number;
  /** This person's RMD start age (SECURE 2.0, birth-year-dependent). */
  rmdStartAge: number;
  /** This person's Traditional balance across all pre-tax accounts, Retirement and Portfolio
   *  together, as the RMD requirement is measured. */
  personTraditionalBalance: number;
}

export interface RmdSmoothingInput {
  enabled: boolean;
  people: RmdSmoothingPersonInput[];
  /** Household Traditional balance (`balances.preTax`): the denominator for this person's share
   *  of future Traditional withdrawals (not tracked per person outside RMDs). */
  householdTraditionalBalance: number;
  /** This year's age → return-rate map, read through `resolveReturnRateForAge` so the forward
   *  loop matches real growth. */
  returnRateMap: Map<number, number>;
  /** This year's Traditional and total withdrawal; their ratio approximates future spending's
   *  Traditional share (biased toward under-converting, recomputed every year). */
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  /** This year's portfolio withdrawal (`targetWithdrawal`), projected forward by simple
   *  compounding inflation. */
  currentProjectedAnnualSpendingNeed: number;
  /** Inflation rate used to project spending need forward — the same
   *  rate (`validatedPostRetirementInflation`) real decumulation-year
   *  expense projection already uses. */
  postRetirementInflationRate: number;
}

interface RmdSmoothingPersonResult {
  personId: number;
  thisYearSmoothingTarget: number;
}

interface RmdSmoothingResult {
  byPerson: RmdSmoothingPersonResult[];
  /** Sum of every person's `thisYearSmoothingTarget`: one household minimum for
   *  `performRothConversion`, whose balance-proportional fan-out picks the accounts. */
  householdSmoothingTarget: number;
}

const EMPTY_RESULT: RmdSmoothingResult = {
  byPerson: [],
  householdSmoothingTarget: 0,
};

/**
 * Each person's smoothing target and the household minimum. All zero when disabled, no one
 * qualifies, or the projected RMD already lands at or under spending need.
 */
export function computeRmdSmoothingTargets(
  input: RmdSmoothingInput,
): RmdSmoothingResult {
  if (!input.enabled || input.people.length === 0) return EMPTY_RESULT;

  const traditionalFractionOfSpending = safeDivide(
    input.totalTraditionalWithdrawal,
    input.totalWithdrawal,
    0,
  );
  if (traditionalFractionOfSpending <= 0) return EMPTY_RESULT;

  const byPerson: RmdSmoothingPersonResult[] = [];
  let householdSmoothingTarget = 0;

  for (const person of input.people) {
    const yearsRemaining = person.rmdStartAge - person.currentAge;
    if (yearsRemaining <= 0) continue; // already at/past RMD age
    if (person.personTraditionalBalance <= 0) continue; // nothing to smooth

    const personShare = safeDivide(
      person.personTraditionalBalance,
      input.householdTraditionalBalance,
      0,
    );
    if (personShare <= 0) continue;

    const personAvgAnnualTraditionalWithdrawal =
      input.currentProjectedAnnualSpendingNeed *
      traditionalFractionOfSpending *
      personShare;

    // Project through the year BEFORE rmdStartAge: the first RMD is
    // computed off the prior year-end balance (getRmdFactor's contract).
    let balance = person.personTraditionalBalance;
    let futureSpendingNeed = input.currentProjectedAnnualSpendingNeed;
    for (let age = person.currentAge + 1; age < person.rmdStartAge; age++) {
      const rate = resolveReturnRateForAge(input.returnRateMap, age);
      balance = Math.max(
        0,
        balance * (1 + rate) - personAvgAnnualTraditionalWithdrawal,
      );
      futureSpendingNeed =
        futureSpendingNeed * (1 + input.postRetirementInflationRate);
    }
    const projectedBalanceAtRmdAge = balance;
    if (projectedBalanceAtRmdAge <= 0) continue; // nothing left to force an RMD at all

    const factor = getRmdFactor(person.rmdStartAge);
    if (factor == null || factor <= 0) continue;

    // This person's tolerable future RMD: scaled by the same Traditional
    // fraction and personShare as their withdrawals, so a household's
    // summed tolerance equals real spending need.
    const targetBalanceAtRmdAge =
      futureSpendingNeed * traditionalFractionOfSpending * personShare * factor;
    const excessToConvert = Math.max(
      0,
      projectedBalanceAtRmdAge - targetBalanceAtRmdAge,
    );
    if (excessToConvert <= 0) continue; // future RMD already at/under spending need

    const thisYearSmoothingTarget = roundToCents(
      excessToConvert / yearsRemaining,
    );
    if (thisYearSmoothingTarget <= 0) continue;

    byPerson.push({ personId: person.personId, thisYearSmoothingTarget });
    householdSmoothingTarget = roundToCents(
      householdSmoothingTarget + thisYearSmoothingTarget,
    );
  }

  if (byPerson.length === 0) return EMPTY_RESULT;
  return { byPerson, householdSmoothingTarget };
}
