/**
 * RMD-aware Roth conversion smoothing (R47).
 *
 * Proactively sizes Roth conversions to shrink a FUTURE Required Minimum
 * Distribution toward projected spending need, instead of the existing
 * `performRothConversion` mechanism's opportunistic same-year bracket
 * filling, which only shrinks the future RMD base as a side effect.
 *
 * Design history: `.scratch/docs/plans/PLAN-r47-rmd-aware-roth-smoothing.md`
 * — two advisor rounds. Round 1 caught that a growth-only forward
 * projection systematically overstates a person's future Traditional
 * balance for anyone actively drawing it down for spending before RMD
 * age (the NORMAL case this feature targets, not an edge case) — fixed
 * by also netting out an ESTIMATED future Traditional withdrawal, not
 * just growth. Round 2 caught that a proposed per-person sequential
 * bracket-room priority ("soonest RMD age gets first claim") isn't
 * implementable against the real `performRothConversion`, which is a
 * single household call with a balance-proportional fan-out and no
 * person-awareness — resolved by summing each person's target into ONE
 * household minimum instead of sequencing them.
 *
 * Deliberately NOT a full nested re-simulation of the engine forward to
 * RMD age (computationally prohibitive at Monte Carlo scale — see the
 * plan's "why not re-simulate" section) — this is a bounded, cheap,
 * per-person analytical loop (at most ~20-30 iterations, plain
 * arithmetic, no routing/tax/RMD logic re-invoked), not a genuine
 * multi-year optimizer.
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
  /** This person's current Traditional balance across all their
   *  pre-tax accounts — same `priorYearEndTradByPerson`-derived figure
   *  R46/R49 already track. Deliberately BLENDED Retirement+Portfolio,
   *  not Retirement-only-scoped (matches how the RMD requirement itself
   *  is computed — a real IRS obligation on the full balance; R49 only
   *  scopes withdrawal DISTRIBUTION CAPACITY, never the balance the
   *  requirement is measured against). */
  personTraditionalBalance: number;
}

export interface RmdSmoothingInput {
  enabled: boolean;
  people: RmdSmoothingPersonInput[];
  /** Household total Traditional balance (`balances.preTax`) — the
   *  denominator for each person's share of the household's Traditional
   *  money, used to estimate how much of the household's future
   *  Traditional withdrawal will come from THIS person's accounts
   *  specifically (the engine doesn't track withdrawals per-person for
   *  ordinary spending, only for RMD). */
  householdTraditionalBalance: number;
  /** THIS year's already-computed return-rate lookup map (age → rate),
   *  the same one real growth application uses — reused via
   *  `resolveReturnRateForAge`, never re-derived, so the forward loop
   *  can't quietly diverge from how growth is actually applied elsewhere
   *  in the same projection. */
  returnRateMap: Map<number, number>;
  /** THIS year's realized Traditional withdrawal and total withdrawal —
   *  `totalTraditionalWithdrawal / totalWithdrawal` is used as a proxy
   *  for what fraction of future spending will come from Traditional
   *  accounts. A real simplification (this ratio drifts over the
   *  horizon as Traditional balances shrink from ordinary spending and
   *  from smoothing's own conversions) — the bias runs safe (under-, not
   *  over-conversion) and self-corrects every real year since this whole
   *  computation reruns fresh annually. */
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  /** THIS year's projected annual spending need (e.g. `afterTaxNeed` or
   *  `state.projectedExpenses`) — projected forward via simple compounding
   *  inflation (NOT the full spending-strategy dispatch a real future year
   *  would run; that's exactly the nested-re-simulation cost this design
   *  avoids). */
  currentProjectedAnnualSpendingNeed: number;
  /** Inflation rate used to project spending need forward — the same
   *  rate (`validatedPostRetirementInflation`) real decumulation-year
   *  expense projection already uses. */
  postRetirementInflationRate: number;
}

export interface RmdSmoothingPersonResult {
  personId: number;
  thisYearSmoothingTarget: number;
}

export interface RmdSmoothingResult {
  byPerson: RmdSmoothingPersonResult[];
  /** Sum of every person's `thisYearSmoothingTarget` — the single
   *  household-level minimum fed into `performRothConversion`'s existing
   *  sizing logic (never a signature change; WHICH person's accounts
   *  actually supply the converted dollars is decided by the function's
   *  existing balance-proportional fan-out, same as any other
   *  conversion). */
  householdSmoothingTarget: number;
}

const EMPTY_RESULT: RmdSmoothingResult = {
  byPerson: [],
  householdSmoothingTarget: 0,
};

/**
 * Compute each person's this-year Roth-conversion smoothing target and
 * the combined household minimum. Returns an all-zero result when
 * disabled, no people qualify (already past RMD age, no Traditional
 * balance, or a zero/negative years-remaining horizon), or the future
 * RMD is already projected to land at or under spending need (nothing to
 * smooth).
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

    // Project forward only through the end of the year BEFORE rmdStartAge
    // — the RMD due in the year someone turns rmdStartAge is computed off
    // the PRIOR year-end balance (see rmd-enforcement.ts /
    // getRmdFactor's contract), so the loop must stop one year short of
    // rmdStartAge, not run through it (advisor review, 2026-08-29 —
    // running through rmdStartAge compounded one extra year of growth
    // into the projected balance while also inflating futureSpendingNeed
    // by one extra year; those two errors partially canceled, which is
    // why it wasn't caught by directional-only tests).
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

    // THIS person's tolerable future RMD, not the whole household's —
    // must be scaled by the same traditionalFractionOfSpending/personShare
    // factors personAvgAnnualTraditionalWithdrawal already applies above,
    // or a multi-person household's summed tolerance silently becomes a
    // multiple of real spending need (advisor review, 2026-08-29 — this
    // was comparing one person's share of need against the household's
    // whole need, systematically under-converting or fully no-op-ing the
    // feature depending on the Traditional fraction).
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
