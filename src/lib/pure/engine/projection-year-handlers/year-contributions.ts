/** A working year's contributions sized, before anything is credited. */
import type { resolveAccumulationConfig } from "../override-resolution";
import { yearContributionTarget, yearZeroBasis } from "./contribution-target";
import { routeYearSlots, yearContributionLimits } from "./contribution-slots";
import { yearContributionTotals } from "./contribution-credits";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/**
 * Year 0's basis, the target and employer match, the IRS limits, the routed
 * slots and their totals. Reads the balances not at all.
 */
export function sizeYearContributions(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  setup: PreYearSetup,
  terms: {
    yearIndex: number;
    config: ReturnType<typeof resolveAccumulationConfig>;
    lgf: number;
    contributionSpecs: ProjectionLoopState["contributionSpecs"];
  },
) {
  const { yearIndex, config, lgf, contributionSpecs } = terms;
  const {
    year,
    age,
    effectiveSalary: projectedSalary,
    effectiveSalaryByPerson: projectedSalaryByPerson,
  } = setup;
  const { input, hasPerPersonSalary, firstYearFraction, TAX_ADVANTAGED } = ctx;
  const { currentSalary, irsLimitCaps } = input;
  const { activeBaseYearContributions, activeBaseYearEmployerMatch } = state;

  const { useRealContributions, proRate, lateYearCut, totalLateYearCut } =
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
      ctx,
      state,
      setup,
      { useRealContributions, proRate, lateYearCut, totalLateYearCut },
      { config, lgf, contributionSpecs },
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
    useRealContributions,
    activeBaseYearContributions,
  );
  const { slots, routeWarnings, specOverflow, rateCeilingScale } =
    routeYearSlots(
      useRealContributions,
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
  const {
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    overflowToBrokerage,
    totalTaxAdvSpace,
  } = yearContributionTotals(
    slots,
    useRealContributions,
    contributionSpecs,
    specOverflow,
    state,
    projectedSalary,
    currentSalary,
    TAX_ADVANTAGED,
    year,
    age,
  );

  return {
    proRate,
    targetContribution,
    personPay,
    contribution,
    slots,
    routeWarnings,
    rateCeilingScale,
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    overflowToBrokerage,
    totalTaxAdvSpace,
  };
}
