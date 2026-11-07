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
} from "../../../config/account-balance";
import {
  OVERFLOW_TOLERANCE,
  MAX_BROKERAGE_RAMP_YEARS,
} from "../../../constants";
import type { resolveAccumulationConfig } from "../override-resolution";
import { distributeContributions } from "../individual-accounts/contributions";
import { accrueIndividualBasis } from "../individual-accounts/ledger";
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
  useRealContribs: ReturnType<typeof yearZeroBasis>["useRealContribs"],
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
  if (useRealContribs) {
    overflowToBrokerage = 0;
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    overflowToBrokerage = specOverflow < OVERFLOW_TOLERANCE ? 0 : specOverflow;
  } else {
    const brokerageContrib =
      slots.find((s) => isOverflowTarget(s.category))?.employeeContrib ?? 0;
    // Base year brokerage is intentional; scale proportionally with salary
    // (no specs here, so nothing says whose it is: the household's pay).
    const baseIntentional = state.activeBaseYearContributions?.brokerage ?? 0;
    const salaryScale = safeDivide(projectedSalary, currentSalary, 1);
    const intentional = roundToCents(baseIntentional * salaryScale);
    const raw = Math.max(0, roundToCents(brokerageContrib - intentional));
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
  acctBal: ProjectionLoopState["acctBal"],
  yearIndex: number,
  brokerageContributionRamp: ProjectionContext["input"]["brokerageContributionRamp"],
  contribution: ContributionState,
  OVERFLOW_CATEGORY: ProjectionContext["OVERFLOW_CATEGORY"],
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
  brokBasis: ProjectionLoopState["brokBasis"],
  config: ReturnType<typeof resolveAccumulationConfig>,
  ctx: ProjectionContext,
  state: ProjectionLoopState,
) {
  // Update balances: contributions + employer match
  // Route contributions to correct tax buckets AND per-account balances
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    if (bs === "roth_traditional") {
      balances.preTax += slot.traditionalContrib + slot.employerMatch;
      balances.taxFree += slot.rothContrib;
      addTraditional(
        acctBal[slot.category],
        slot.traditionalContrib + slot.employerMatch,
      );
      addRoth(acctBal[slot.category], slot.rothContrib);
    } else if (bs === "single_bucket") {
      balances.hsa += slot.employeeContrib + slot.employerMatch;
      addBalance(
        acctBal[slot.category],
        slot.employeeContrib + slot.employerMatch,
      );
    } else {
      // basis_tracking (brokerage) -- track both balance and cost basis
      const brokerageContrib = slot.employeeContrib + slot.employerMatch;
      balances.afterTax += brokerageContrib;
      balances.afterTaxBasis += brokerageContrib;
      addBalance(acctBal[slot.category], brokerageContrib);
      addBasis(acctBal[slot.category], brokerageContrib);
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
    addBalance(acctBal[OVERFLOW_CATEGORY], rampAmount);
    addBasis(acctBal[OVERFLOW_CATEGORY], rampAmount);
  }

  // Apply lump sums (one-time injections, NOT subject to IRS limits)
  // Lump sums are cash in: new basis in the brokerage account they land in.
  followInflows(indAccts, indKey, indBal, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  return { rampAmount };
}

/** The year's contributions, match, overflow and ramp, spread to each account. */
export function distributeYearContributions(
  hasIndividualAccounts: boolean,
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
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
  let indContribs = new Map<string, number>();
  let indMatch = new Map<string, number>();
  let indIntentional = new Map<string, number>();
  let indOverflow = new Map<string, number>();
  let indRamp = new Map<string, number>();
  if (hasIndividualAccounts && contributionSpecs) {
    // Contributions, match, overflow and the ramp are cash in: new basis.
    const distResult = followInflows(indAccts, indKey, indBal, brokBasis, () =>
      distributeContributions({
        slots,
        contributionSpecs,
        indAccts,
        indKey,
        indBal,
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
    );
    indContribs = distResult.indContribs;
    indMatch = distResult.indMatch;
    indIntentional = distResult.indIntentional;
    indOverflow = distResult.indOverflow;
    indRamp = distResult.indRamp;
    // Tracked Roth basis grows by this year's contribution, which excludes
    // employer match (roth-basis-tracking.ts's docblock says why).
    accrueIndividualBasis(indAccts, indKey, indBasis, indContribs);
  }

  return { indContribs, indMatch, indIntentional, indOverflow, indRamp };
}
