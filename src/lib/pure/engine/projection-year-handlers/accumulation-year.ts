/**
 * runAccumulationYear — single-year accumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 */
import {
  followInflows,
  followReconciliation,
  syncAggregateBasis,
} from "../brokerage-basis";
import type { EngineAccumulationYear } from "../types/projection-result";
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { roundToCents, sumBy, safeDivide } from "../../../utils/math";
import {
  getAllCategories,
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
import { resolveAccumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import {
  distributeContributions,
  applyIndividualGrowth,
  buildIndividualYearBalances,
  accrueIndividualBasis,
  reconcileIndividualToAggregate,
} from "../individual-account-tracking";
import { cloneAccountBalances, scopedBalances } from "../balance-utils";
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { brokerageGoalDraws, yearGapDraw } from "./goal-draws";
import { updatePerPersonTradBalance } from "./helpers";
import { applyLumpSums } from "./lump-sum";
import { yearContributionTarget, yearZeroBasis } from "./contribution-target";
import { routeYearSlots, yearContributionLimits } from "./contribution-slots";

// ---------------------------------------------------------------------------
// Accumulation year handler
// ---------------------------------------------------------------------------

/**
 * Run a single accumulation year. Mutates state in place and pushes
 * the year projection to state.projectionByYear.
 *
 * Logic copied exactly from projection.ts lines 565-1077.
 */
export function runAccumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
  setup: PreYearSetup,
): void {
  const {
    age,
    year,
    returnRate,
    effectiveSalary: projectedSalary,
    effectiveSalaryByPerson: projectedSalaryByPerson,
    hasBonusAdjustment,
  } = setup;
  const {
    input,
    salaryOverrideMap,
    perPersonSalaryOverrides,
    budgetOverrideMap,
    brokerageGoalsByYear,
    sortedAccOverrides,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    firstYearFraction,
    OVERFLOW_CATEGORY,
    TAX_ADVANTAGED,
  } = ctx;
  // This year's specs: someone not at work this year has theirs zeroed.
  const contributionSpecs = setup.yearSpecs ?? state.contributionSpecs;
  const {
    balances,
    acctBal,
    activeEmployerMatchRateByCategory,
    activeBaseYearContributions,
    activeBaseYearEmployerMatch,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    indBal,
    indBasis,
    brokBasis,
    specToAccount,
    accountsWithSpecs,
  } = state;

  const {
    currentSalary,
    limitGrowthRate,
    irsLimitCaps,
    brokerageContributionRamp,
    decumulationDefaults,
    retirementYear,
  } = input;

  const config = resolveAccumulationConfig(
    year,
    accumulationDefaults,
    sortedAccOverrides,
  );

  // IRS limits grow annually
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex);

  const { useRealContribs, proRate, lateYearCut, totalLateYearCut } =
    yearZeroBasis(
      yearIndex,
      setup,
      activeBaseYearContributions,
      activeBaseYearEmployerMatch,
      firstYearFraction,
      contributionSpecs,
    );
  const { targetContribution, yearEmployerMatch, personPay, contribution } =
    yearContributionTarget(
      useRealContribs,
      activeBaseYearContributions,
      proRate,
      totalLateYearCut,
      contributionSpecs,
      projectedSalary,
      lgf,
      config,
      activeBaseYearEmployerMatch,
      activeEmployerMatchRateByCategory,
      input,
      hasPerPersonSalary,
      projectedSalaryByPerson,
      currentSalary,
      setup,
      state,
    );
  const { capped, yearLimits } = yearContributionLimits(
    contributionSpecs,
    year,
    irsLimitCaps,
    lgf,
    projectedSalary,
    currentSalary,
    personPay,
    yearEmployerMatch,
    hasPerPersonSalary,
    projectedSalaryByPerson,
    useRealContribs,
    activeBaseYearContributions,
  );
  const { slots, routeWarnings, specOverflow, rateCeilingScale } =
    routeYearSlots(
      useRealContribs,
      activeBaseYearContributions,
      yearEmployerMatch,
      proRate,
      lateYearCut,
      yearLimits,
      config,
      contributionSpecs,
      capped,
      contribution,
      projectedSalary,
      targetContribution,
    );

  const totalEmployee = roundToCents(sumBy(slots, (s) => s.employeeContrib));
  const totalEmployer = roundToCents(sumBy(slots, (s) => s.employerMatch));
  const totalRoth = roundToCents(sumBy(slots, (s) => s.rothContrib));
  const totalTraditional = roundToCents(
    sumBy(slots, (s) => s.traditionalContrib),
  );
  // Overflow = only the amount that spilled from tax-advantaged IRS caps to brokerage.
  // Year 0: no overflow (brokerage is intentional).
  // Per-account specs: use specOverflow (only IRS cap spillover, not intentional brokerage).
  // Fallback waterfall/percentage: subtract intentional brokerage (scaled from base year).
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

  // Route contributions, match, overflow, and ramp to individual accounts
  // Extracted to individual-account-tracking.ts
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
    // Tracked Roth basis -- grows by this year's
    // contribution, which distributeContributions already excludes
    // employer match from (see roth-basis-tracking.ts's docblock for why
    // that's load-bearing, not incidental).
    accrueIndividualBasis(indAccts, indKey, indBasis, indContribs);
  }

  const { gapRun, gapDraw } = yearGapDraw(
    setup,
    ctx,
    state,
    year,
    age,
    proRate,
    hasPerPersonSalary,
    projectedSalaryByPerson,
    projectedSalary,
    totalEmployee,
    rampAmount,
    totalTraditional,
    routeWarnings,
  );

  // Apply growth to each bucket (pro-rated for year 0)
  // Extracted to growth-application.ts -- applies return rate to all balance structures.
  const effectiveReturn =
    yearIndex === 0
      ? Math.pow(1 + returnRate, firstYearFraction) - 1
      : returnRate;
  applyGrowth({ effectiveReturn, balances, acctBal });
  // Per-individual-account growth -- extracted to individual-account-tracking.ts
  const indGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, effectiveReturn)
    : new Map<string, number>();

  const { goalWithdrawals } = brokerageGoalDraws(
    brokerageGoalsByYear,
    year,
    balances,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indBal,
    routeWarnings,
    brokBasis,
    decumulationDefaults,
    acctBal,
    OVERFLOW_CATEGORY,
  );

  // Build individual account year balances -- extracted to individual-account-tracking.ts
  const indYearBalances: IndividualAccountYearBalance[] = hasIndividualAccounts
    ? buildIndividualYearBalances(
        indAccts,
        indKey,
        indBal,
        indParentCat,
        "accumulation",
        {
          contribs: indContribs,
          match: indMatch,
          growth: indGrowth,
          intentional: indIntentional,
          overflow: indOverflow,
          ramp: indRamp,
          basis: indBasis,
          brokerageBasis: brokBasis,
          ...(gapRun?.accounts
            ? {
                withdrawal: gapRun.accounts.withdrawal,
                draws: gapRun.accounts.draws,
              }
            : {}),
        },
        gapRun?.accounts?.eligibility,
      )
    : [];

  // Reconcile indBal to acctBal once per year, as decumulation-year.ts does:
  // after the output row is built (output shows pre-cleanup figures, the
  // carried state post-cleanup) and before the divergence check below.
  if (hasIndividualAccounts) {
    routeWarnings.push(
      ...followReconciliation(
        indAccts,
        indKey,
        indBal,
        brokBasis,
        balances.afterTaxBasis,
        () => reconcileIndividualToAggregate(indAccts, indKey, indBal, acctBal),
      ),
    );
    // The aggregate basis is the accounts' sum.
    syncAggregateBasis(
      indAccts,
      indKey,
      indBal,
      brokBasis,
      balances,
      acctBal,
      routeWarnings,
    );
  }

  const { allAccountsBalance, retirementBalance } = scopedBalances(
    balances,
    hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccts, indBal, indKey)
      : undefined,
  );

  // Divergence check: last accumulation year
  if (year === retirementYear - 1) {
    const rothTotal = getAllCategories().reduce((s, cat) => {
      const b = acctBal[cat];
      return s + (b.structure === "roth_traditional" ? b.roth : 0);
    }, 0);
    if (Math.abs(rothTotal - balances.taxFree) > 1) {
      routeWarnings.push(
        `[DIAG] Roth divergence at end of accumulation (age ${age}): acctBal.roth=${rothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - rothTotal).toFixed(0)}`,
      );
    }
  }

  const yearProjection: EngineAccumulationYear = {
    year,
    age,
    phase: "accumulation",
    projectedSalary: roundToCents(projectedSalary),
    projectedSalaryByPerson: hasPerPersonSalary
      ? Object.fromEntries(
          Array.from(projectedSalaryByPerson.entries()).map(([pid, sal]) => [
            pid,
            roundToCents(sal),
          ]),
        )
      : undefined,
    projectedExpenses: roundToCents(state.projectedExpenses),
    hasSalaryOverride:
      salaryOverrideMap.has(year) || perPersonSalaryOverrides.has(year),
    hasBonusAdjustment,
    hasBudgetOverride: budgetOverrideMap.has(year),
    proRateFraction:
      yearIndex === 0 && firstYearFraction < 1 ? firstYearFraction : null,
    targetContribution,
    config,
    slots,
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    rateCeilingScale,
    overflowToBrokerage,
    brokerageRampContribution: rampAmount,
    totalTaxAdvSpace,
    brokerageGoalWithdrawals: goalWithdrawals,
    ...(gapDraw ? { gapDraw, savingStopped: setup.savingStopped } : {}),
    retirementBalance,
    allAccountsBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: indYearBalances,
    returnRate: effectiveReturn,
    annualizedReturnRate:
      yearIndex === 0 && firstYearFraction < 1
        ? Math.pow(1 + effectiveReturn, 1 / firstYearFraction) - 1
        : returnRate,
    warnings: routeWarnings,
  };

  // Update RMD tracking at end of accumulation year
  state.priorYearEndTradBalance = balances.preTax;
  updatePerPersonTradBalance(ctx, state);

  state.projectionByYear.push(yearProjection);
}
