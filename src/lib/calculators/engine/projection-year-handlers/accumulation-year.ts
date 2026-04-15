/**
 * runAccumulationYear — single-year accumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 refactor. Pure relocation — no logic changes, behavior byte-identical.
 */
import type {
  AccountCategory,
  AccumulationSlot,
  EngineAccumulationYear,
  IndividualAccountYearBalance,
} from "../../types";
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  categoriesWithIrsLimit,
  getLimitGroup,
  getRothFraction as configGetRothFraction,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  setBasis,
  getBasis,
} from "../../../config/account-types";
import {
  OVERFLOW_TOLERANCE,
  MAX_BROKERAGE_RAMP_YEARS,
  DEFAULT_TAX_RATE_BROKERAGE,
} from "../../../constants";
import { resolveAccumulationConfig } from "../override-resolution";
import {
  routeWaterfall,
  routePercentage,
  routeFromSpecs,
} from "../contribution-routing";
import { applyGrowth } from "../growth-application";
import {
  distributeContributions,
  distributeGoalWithdrawal,
  applyIndividualGrowth,
  buildIndividualYearBalances,
} from "../individual-account-tracking";
import { cloneAccountBalances } from "../balance-utils";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { updatePerPersonTradBalance } from "./helpers";
import { applyLumpSums } from "./lump-sum";

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
  y: number,
  setup: PreYearSetup,
): void {
  const { age, year, returnRate } = setup;
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
  const {
    balances,
    acctBal,
    contributionSpecs,
    activeEmployerMatchRateByCategory,
    activeBaseYearContributions,
    activeBaseYearEmployerMatch,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    indBal,
    specToAccount,
    accountsWithSpecs,
    projectedSalary,
    projectedSalaryByPerson,
  } = state;

  const {
    currentSalary,
    limitGrowthRate,
    baseLimits,
    catchupLimits,
    currentAge,
    brokerageContributionRamp,
    decumulationDefaults,
    retirementAge,
  } = input;

  const config = resolveAccumulationConfig(
    year,
    accumulationDefaults,
    sortedAccOverrides,
  );

  // IRS limits grow annually
  const lgf = Math.pow(1 + limitGrowthRate, y);
  const yearLimits: Record<AccountCategory, number> = Object.fromEntries(
    getAllCategories().map((cat) => {
      if (!getAccountTypeConfig(cat).hasIrsLimit) return [cat, 0];
      // Categories in a shared limit group use the group leader's base limit
      const limitKey = getLimitGroup(cat) ?? cat;
      return [
        cat,
        roundToCents((baseLimits[limitKey as AccountCategory] ?? 0) * lgf),
      ];
    }),
  ) as Record<AccountCategory, number>;

  // Add age-based catchup limits (grown at the same rate as base limits)
  if (catchupLimits) {
    const projectedAge = currentAge + y;
    for (const cat of categoriesWithIrsLimit()) {
      const cfg = getAccountTypeConfig(cat);
      const group = getLimitGroup(cat) ?? cat;
      const superRange = cfg.superCatchupAgeRange;
      // Super-catchup replaces regular catchup if in the age range
      if (
        superRange &&
        projectedAge >= superRange[0] &&
        projectedAge <= superRange[1]
      ) {
        const superKey = `${group}_super`;
        yearLimits[cat] += roundToCents((catchupLimits[superKey] ?? 0) * lgf);
      } else if (cfg.catchupAge !== null && projectedAge >= cfg.catchupAge) {
        yearLimits[cat] += roundToCents((catchupLimits[group] ?? 0) * lgf);
      }
    }
  }

  // Year 0 with real contribution data: use actual per-account amounts
  // instead of salary x rate which can create artificial overflow
  const useRealContribs =
    y === 0 && activeBaseYearContributions && activeBaseYearEmployerMatch;

  // Pro-rate year 0 contributions/match based on months remaining in the year
  const proRate = y === 0 ? firstYearFraction : 1;

  let targetContribution: number;
  if (useRealContribs) {
    targetContribution = roundToCents(
      Object.values(activeBaseYearContributions!).reduce((s, v) => s + v, 0) *
        proRate,
    );
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    // Sum projected per-account contributions (before IRS capping)
    const lgf = Math.pow(1 + limitGrowthRate, y);
    targetContribution = roundToCents(
      contributionSpecs.reduce((sum, spec) => {
        if (spec.method === "percent_of_salary") {
          return sum + projectedSalary * spec.salaryFraction * spec.value;
        }
        return sum + spec.baseAnnual * lgf;
      }, 0) * proRate,
    );
  } else {
    targetContribution = roundToCents(
      projectedSalary * Math.max(0, config.contributionRate) * proRate,
    );
  }

  // Apply contributionRate as a ceiling on targetContribution (waterfall/percentage fallback path).
  // The per-account specs path applies its own ceiling after routeFromSpecs returns.
  // Skip year 0 real contribs since those are actual paycheck data.
  if (
    !useRealContribs &&
    !(contributionSpecs && contributionSpecs.length > 0)
  ) {
    const rateCeiling = roundToCents(
      projectedSalary * Math.max(0, config.contributionRate) * proRate,
    );
    if (targetContribution > rateCeiling) {
      targetContribution = rateCeiling;
    }
  }

  // Employer match (grows with salary in future years; pro-rated for year 0)
  const yearEmployerMatch: Record<AccountCategory, number> = Object.fromEntries(
    getAllCategories().map((cat) => [
      cat,
      useRealContribs
        ? roundToCents((activeBaseYearEmployerMatch![cat] ?? 0) * proRate)
        : roundToCents(
            projectedSalary *
              Math.max(0, activeEmployerMatchRateByCategory[cat] ?? 0) *
              proRate,
          ),
    ]),
  ) as Record<AccountCategory, number>;

  let slots: AccumulationSlot[];
  let routeWarnings: string[];
  let specOverflow = 0; // overflow from per-account routing (only IRS cap spillover)
  let rateCeilingScale: number | null = null; // set when rate ceiling scales down contributions

  if (useRealContribs) {
    // Build slots from per-account annual projections, pro-rated for partial year 0
    const categories: AccountCategory[] = getAllCategories();
    slots = categories
      .filter(
        (cat) =>
          activeBaseYearContributions![cat] > 0 || yearEmployerMatch[cat] > 0,
      )
      .map((cat) => {
        const employeeContrib = roundToCents(
          activeBaseYearContributions![cat] * proRate,
        );
        const irsLimit = yearLimits[cat];
        const rothFrac = configGetRothFraction(cat, config.taxSplits);
        const rothContrib = roundToCents(employeeContrib * rothFrac);
        const tradContrib = roundToCents(employeeContrib - rothContrib);
        return {
          category: cat,
          irsLimit,
          effectiveLimit: isOverflowTarget(cat) ? 0 : irsLimit,
          employerMatch: yearEmployerMatch[cat],
          employeeContrib,
          rothContrib,
          traditionalContrib: tradContrib,
          remainingSpace: isOverflowTarget(cat)
            ? 0
            : roundToCents(Math.max(0, irsLimit - employeeContrib)),
          cappedByAccount: false,
          cappedByTaxType: false,
          overflowAmount: 0,
        };
      });
    routeWarnings = [];
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    // Per-account routing from DB specs -- respects each account's method
    const limitGrowthFactor = Math.pow(1 + limitGrowthRate, y);
    const routed = routeFromSpecs(
      contributionSpecs,
      projectedSalary,
      currentSalary,
      yearLimits,
      yearEmployerMatch,
      limitGrowthFactor,
      config,
    );
    slots = routed.slots;
    routeWarnings = routed.warnings;
    specOverflow = routed.totalOverflow;

    // Pro-rate year 0 spec-based employee contributions (routeFromSpecs computes full-year amounts)
    if (proRate < 1) {
      for (const slot of slots) {
        slot.employeeContrib = roundToCents(slot.employeeContrib * proRate);
        slot.rothContrib = roundToCents(slot.rothContrib * proRate);
        slot.traditionalContrib = roundToCents(
          slot.traditionalContrib * proRate,
        );
        slot.remainingSpace = isOverflowTarget(slot.category)
          ? 0
          : roundToCents(
              Math.max(0, slot.effectiveLimit - slot.employeeContrib),
            );
      }
      // Recompute overflow -- pro-rating may reduce or eliminate it
      specOverflow = roundToCents(specOverflow * proRate);
    }

    // Apply contributionRate ceiling to per-account spec output.
    // The rate ceiling is authoritative -- overrides always take effect.
    const specTotal = roundToCents(sumBy(slots, (s) => s.employeeContrib));
    const rateCeiling = roundToCents(
      projectedSalary * Math.max(0, config.contributionRate) * proRate,
    );
    if (specTotal > rateCeiling && rateCeiling > 0) {
      const scale = rateCeiling / specTotal;
      rateCeilingScale = scale;
      for (const slot of slots) {
        const newEmployee = roundToCents(slot.employeeContrib * scale);
        const newRoth = roundToCents(slot.rothContrib * scale);
        const newTrad = roundToCents(slot.traditionalContrib * scale);
        slot.employeeContrib = newEmployee;
        slot.rothContrib = newRoth;
        slot.traditionalContrib = newTrad;
        slot.remainingSpace = isOverflowTarget(slot.category)
          ? 0
          : roundToCents(Math.max(0, slot.effectiveLimit - newEmployee));
      }
      // Recompute overflow -- scaling down may eliminate it
      specOverflow = 0;
    }
  } else {
    // Fallback: Route contributions based on mode (blended rate)
    const routed =
      config.routingMode === "waterfall"
        ? routeWaterfall(
            targetContribution,
            config,
            yearLimits,
            yearEmployerMatch,
          )
        : routePercentage(
            targetContribution,
            config,
            yearLimits,
            yearEmployerMatch,
          );
    slots = routed.slots;
    routeWarnings = routed.warnings;
  }

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
    const baseIntentional = state.activeBaseYearContributions?.brokerage ?? 0;
    const salaryScale = currentSalary > 0 ? projectedSalary / currentSalary : 1;
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
  const rampYear = Math.min(y, MAX_BROKERAGE_RAMP_YEARS);
  const rampAmount =
    (brokerageContributionRamp ?? 0) > 0 && y > 0
      ? roundToCents(brokerageContributionRamp! * rampYear)
      : 0;
  if (rampAmount > 0) {
    balances.afterTax += rampAmount;
    balances.afterTaxBasis += rampAmount;
    addBalance(acctBal[OVERFLOW_CATEGORY], rampAmount);
    addBasis(acctBal[OVERFLOW_CATEGORY], rampAmount);
  }

  // Apply lump sums (one-time injections, NOT subject to IRS limits)
  applyLumpSums(config.lumpSums, ctx, state);

  // Route contributions, match, overflow, and ramp to individual accounts
  // Extracted to individual-account-tracking.ts
  let indContribs = new Map<string, number>();
  let indMatch = new Map<string, number>();
  let indIntentional = new Map<string, number>();
  let indOverflow = new Map<string, number>();
  let indRamp = new Map<string, number>();
  if (hasIndividualAccounts && contributionSpecs) {
    const distResult = distributeContributions({
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
      limitGrowthRate,
      yearIndex: y,
      proRate,
      overflowToBrokerage,
      rampAmount,
      employerMatchByParentCat: activeEmployerMatchByParentCat,
    });
    indContribs = distResult.indContribs;
    indMatch = distResult.indMatch;
    indIntentional = distResult.indIntentional;
    indOverflow = distResult.indOverflow;
    indRamp = distResult.indRamp;
  }

  // Apply growth to each bucket (pro-rated for year 0)
  // Extracted to growth-application.ts -- applies return rate to all balance structures.
  const effectiveReturn =
    y === 0 ? Math.pow(1 + returnRate, firstYearFraction) - 1 : returnRate;
  applyGrowth({ effectiveReturn, balances, acctBal });
  // Per-individual-account growth -- extracted to individual-account-tracking.ts
  const indGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, effectiveReturn)
    : new Map<string, number>();

  // Process brokerage goal withdrawals during accumulation
  const yearGoals = brokerageGoalsByYear.get(year) ?? [];
  const goalWithdrawals: EngineAccumulationYear["brokerageGoalWithdrawals"] =
    [];
  for (const goal of yearGoals) {
    const drawAmount = roundToCents(
      Math.min(goal.targetAmount, balances.afterTax),
    );
    if (drawAmount <= 0) {
      goalWithdrawals.push({
        goalId: goal.id,
        name: goal.name,
        amount: 0,
        basisPortion: 0,
        gainsPortion: 0,
        taxCost: 0,
      });
      routeWarnings.push(
        `Brokerage goal "${goal.name}" unfunded — insufficient balance`,
      );
      continue;
    }
    const basisRatio =
      balances.afterTax > 0
        ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
        : 0;
    const basisPortion = roundToCents(drawAmount * basisRatio);
    const gainsPortion = roundToCents(drawAmount - basisPortion);
    const taxCost = roundToCents(
      gainsPortion *
        (decumulationDefaults.distributionTaxRates?.brokerage ??
          DEFAULT_TAX_RATE_BROKERAGE),
    );
    balances.afterTax = roundToCents(balances.afterTax - drawAmount);
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - basisPortion),
    );
    addBalance(acctBal[OVERFLOW_CATEGORY], -drawAmount);
    setBasis(
      acctBal[OVERFLOW_CATEGORY],
      roundToCents(
        Math.max(0, getBasis(acctBal[OVERFLOW_CATEGORY]) - basisPortion),
      ),
    );
    // Distribute brokerage goal withdrawal -- extracted to individual-account-tracking.ts
    if (hasIndividualAccounts) {
      distributeGoalWithdrawal(drawAmount, indAccts, indKey, indBal);
    }
    goalWithdrawals.push({
      goalId: goal.id,
      name: goal.name,
      amount: drawAmount,
      basisPortion,
      gainsPortion,
      taxCost,
    });
  }

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
        },
      )
    : [];

  const endBalance = roundToCents(
    balances.preTax + balances.taxFree + balances.hsa + balances.afterTax,
  );

  // Divergence check: last accumulation year
  if (age === retirementAge - 1) {
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
    hasBudgetOverride: budgetOverrideMap.has(year),
    proRateFraction:
      y === 0 && firstYearFraction < 1 ? firstYearFraction : null,
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
    endBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: indYearBalances,
    returnRate: effectiveReturn,
    annualizedReturnRate:
      y === 0 && firstYearFraction < 1
        ? Math.pow(1 + effectiveReturn, 1 / firstYearFraction) - 1
        : returnRate,
    warnings: routeWarnings,
  };

  // Update RMD tracking at end of accumulation year
  state.priorYearEndTradBalance = balances.preTax;
  updatePerPersonTradBalance(ctx, state);

  state.projectionByYear.push(yearProjection);
}
