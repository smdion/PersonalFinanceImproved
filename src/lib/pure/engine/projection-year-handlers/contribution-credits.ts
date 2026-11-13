import { followInflows } from "../brokerage-basis";
import type { AccumulationSlot } from "../types/routing";
import { roundToCents, sumBy, safeDivide } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
} from "../../../config/account-types";
import {
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "../../accounts/account-balance";
import {
  OVERFLOW_TOLERANCE,
  MAX_BROKERAGE_RAMP_YEARS,
} from "../../../constants";
import type { resolveAccumulationConfig } from "../override-resolution";
import { distributeContributions } from "../individual-accounts/contributions";
import { accrueIndividualBasis, credit } from "../individual-accounts/ledger";
import { ownPartCredits } from "../individual-accounts/own-part-credits";
import type { ContributionState } from "@/lib/pure/contributions/contribution-state";
import { applyLumpSums } from "./lump-sum";
import type {
  yearContributionTarget,
  yearZeroBasis,
} from "./contribution-target";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's contribution totals and the overflow to brokerage. */
export function yearContributionTotals(
  slots: AccumulationSlot[],
  useRealContributions: ReturnType<
    typeof yearZeroBasis
  >["useRealContributions"],
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  specOverflow: number,
  state: ProjectionLoopState,
  projectedSalary: number,
  currentSalary: number,
  TAX_ADVANTAGED: ProjectionContext["TAX_ADVANTAGED"],
  year: number,
  age: number,
) {
  const totalEmployee = roundToCents(sumBy(slots, (s) => s.employeeContrib));
  const totalEmployer = roundToCents(sumBy(slots, (s) => s.employerMatch));
  const totalRoth = roundToCents(sumBy(slots, (s) => s.rothContrib));
  const totalTraditional = roundToCents(
    sumBy(slots, (s) => s.traditionalContrib),
  );
  // Overflow is only what spilled past the IRS caps to brokerage: none in
  // year 0 (its brokerage is intentional), the specs' cap spillover, or the
  // blended rate's brokerage less the base year's intentional amount.
  let overflowToBrokerage: number;
  if (useRealContributions) {
    overflowToBrokerage = 0;
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    overflowToBrokerage = specOverflow < OVERFLOW_TOLERANCE ? 0 : specOverflow;
  } else {
    const brokerageContribution =
      slots.find((s) => isOverflowTarget(s.category))?.employeeContrib ?? 0;
    // Base year brokerage is intentional; scale proportionally with salary
    // (no specs here, so nothing says whose it is: the household's pay).
    const baseIntentional = state.activeBaseYearContributions?.brokerage ?? 0;
    const salaryScale = safeDivide(projectedSalary, currentSalary, 1);
    const intentional = roundToCents(baseIntentional * salaryScale);
    const raw = Math.max(0, roundToCents(brokerageContribution - intentional));
    overflowToBrokerage = raw < OVERFLOW_TOLERANCE ? 0 : raw;
  }
  const totalTaxAdvSpace = roundToCents(
    slots
      .filter((s) => TAX_ADVANTAGED.has(s.category))
      .reduce((s, sl) => s + sl.irsLimit, 0),
  );

  // Track first overflow
  if (overflowToBrokerage > 0 && state.firstOverflowYear === null) {
    state.firstOverflowYear = year;
    state.firstOverflowAge = age;
    state.firstOverflowAmount = overflowToBrokerage;
  }

  return {
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    overflowToBrokerage,
    totalTaxAdvSpace,
  };
}

/** The slots, the brokerage ramp and the lump sums credited to the balances. */
export function creditYearContributions(
  slots: AccumulationSlot[],
  balances: ProjectionLoopState["balances"],
  accountBalance: ProjectionLoopState["accountBalance"],
  yearIndex: number,
  brokerageContributionRamp: ProjectionContext["input"]["brokerageContributionRamp"],
  contribution: ContributionState,
  OVERFLOW_CATEGORY: ProjectionContext["OVERFLOW_CATEGORY"],
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  brokBasis: ProjectionLoopState["brokBasis"],
  config: ReturnType<typeof resolveAccumulationConfig>,
  ctx: ProjectionContext,
  state: ProjectionLoopState,
) {
  // Buckets and categories here; the parts in distributeYearContributions.
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    if (bs === "roth_traditional") {
      balances.preTax += slot.traditionalContrib + slot.employerMatch;
      balances.taxFree += slot.rothContrib;
      addTraditional(
        accountBalance[slot.category],
        slot.traditionalContrib + slot.employerMatch,
      );
      addRoth(accountBalance[slot.category], slot.rothContrib);
    } else if (bs === "single_bucket") {
      balances.hsa += slot.employeeContrib + slot.employerMatch;
      addBalance(
        accountBalance[slot.category],
        slot.employeeContrib + slot.employerMatch,
      );
    } else {
      // basis_tracking (brokerage) -- track both balance and cost basis
      const brokerageContribution = slot.employeeContrib + slot.employerMatch;
      balances.afterTax += brokerageContribution;
      balances.afterTaxBasis += brokerageContribution;
      addBalance(accountBalance[slot.category], brokerageContribution);
      addBasis(accountBalance[slot.category], brokerageContribution);
    }
  }

  // Apply brokerage contribution ramp (additional $X x year index, starting year 1)
  const rampYear = Math.min(yearIndex, MAX_BROKERAGE_RAMP_YEARS);
  const rampAmount =
    (brokerageContributionRamp ?? 0) > 0 &&
    yearIndex > 0 &&
    contribution.kind !== "stopped"
      ? roundToCents(brokerageContributionRamp! * rampYear)
      : 0;
  if (rampAmount > 0) {
    balances.afterTax += rampAmount;
    balances.afterTaxBasis += rampAmount;
    addBalance(accountBalance[OVERFLOW_CATEGORY], rampAmount);
    addBasis(accountBalance[OVERFLOW_CATEGORY], rampAmount);
  }

  // Apply lump sums (one-time injections, NOT subject to IRS limits)
  // Lump sums are cash in: new basis in the brokerage account they land in.
  followInflows(indAccounts, indKey, indBalance, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  return { rampAmount };
}

/** The year's contributions, match, overflow and ramp, spread to each account. */
export function distributeYearContributions(
  hasIndividualAccounts: boolean,
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  brokBasis: ProjectionLoopState["brokBasis"],
  slots: AccumulationSlot[],
  indParentCat: ProjectionContext["indParentCat"],
  specToAccount: ProjectionLoopState["specToAccount"],
  accountsWithSpecs: ProjectionLoopState["accountsWithSpecs"],
  projectedSalary: number,
  currentSalary: number,
  personPay: ReturnType<typeof yearContributionTarget>["personPay"],
  limitGrowthRate: number,
  yearIndex: number,
  proRate: number,
  overflowToBrokerage: number,
  rampAmount: number,
  activeEmployerMatchByParentCat: ProjectionLoopState["activeEmployerMatchByParentCat"],
  indBasis: ProjectionLoopState["indBasis"],
) {
  let indContributions = new Map<string, number>();
  let indMatch = new Map<string, number>();
  let indIntentional = new Map<string, number>();
  let indOverflow = new Map<string, number>();
  let indRamp = new Map<string, number>();
  // Contributions, match, overflow and the ramp are cash in: new basis.
  const own = ownPartCredits(slots, rampAmount, contributionSpecs, indAccounts);
  if (own)
    followInflows(indAccounts, indKey, indBalance, brokBasis, () =>
      own.forEach(([ia, amount]) => credit(indKey(ia), amount, [indBalance])),
    );
  else if (hasIndividualAccounts && contributionSpecs) {
    ({ indContributions, indMatch, indIntentional, indOverflow, indRamp } =
      followInflows(indAccounts, indKey, indBalance, brokBasis, () =>
        distributeContributions({
          slots,
          contributionSpecs,
          indAccounts,
          indKey,
          indBalance,
          indParentCat,
          specToAccount,
          accountsWithSpecs,
          projectedSalary,
          currentSalary,
          personPay,
          limitGrowthRate,
          yearIndex,
          proRate,
          overflowToBrokerage,
          rampAmount,
          employerMatchByParentCat: activeEmployerMatchByParentCat,
        }),
      ));
    // Tracked Roth basis grows by this year's contribution, which excludes
    // employer match (roth-basis-tracking.ts's docblock says why).
    accrueIndividualBasis(indAccounts, indKey, indBasis, indContributions);
  }

  return { indContributions, indMatch, indIntentional, indOverflow, indRamp };
}
