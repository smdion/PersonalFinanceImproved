/** A working year's contributions sized, before anything is credited. */
import type { resolveAccumulationConfig } from "../override-resolution";
import { yearContributionTarget, yearZeroBasis } from "./contribution-target";
import { routeYearSlots, yearContributionLimits } from "./contribution-slots";
import { yearContributionTotals } from "./contribution-credits";
import { roundToCents, sumBy } from "../../../utils/math";
import type { AccumulationSlot } from "../types/routing";
import { fundGapYearSaving } from "./gap-year-saving";
import { rampIsPortfolioSaving } from "@/lib/pure/accounts/brokerage-ramp";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { gapYearNeed } from "../gap-year-need";
import type { ContributionState } from "@/lib/pure/contributions/contribution-state";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/**
 * Year 0's basis, the target and employer match, the IRS limits, the routed
 * slots and their totals; in a gap year, the Portfolio saving the pay left
 * after spending funds (fundGapYearSaving). Reads the balances not at all.
 */
export function sizeYearContributions(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  setup: PreYearSetup,
  terms: {
    yearIndex: number;
    config: ReturnType<typeof resolveAccumulationConfig>;
    lgf: number;
  },
) {
  const { yearIndex } = terms;
  const {
    year,
    age,
    effectiveSalary: projectedSalary,
    effectiveSalaryByPerson: projectedSalaryByPerson,
  } = setup;
  const { input, hasPerPersonSalary, TAX_ADVANTAGED } = ctx;
  const { currentSalary } = input;
  // This year's specs: someone not at work this year has theirs zeroed.
  const specs = setup.yearSpecs ?? state.contributionSpecs;
  const route = (s: typeof specs) =>
    routeYearContributions(ctx, state, setup, { ...terms, specs: s });
  const first = route(specs);
  // A gap year's need, from the pay and contributions before any is credited.
  const needOf = (slots: AccumulationSlot[], ramp: number) =>
    gapYearNeed(ctx, {
      year,
      age,
      fraction: first.proRate,
      payByPerson: (hasPerPersonSalary
        ? [...projectedSalaryByPerson.values()]
        : [projectedSalary]
      ).map((p) => p * first.proRate),
      budget: state.projectedExpenses * first.proRate,
      employeeContributions:
        roundToCents(sumBy(slots, (s) => s.employeeContrib)) + ramp,
      pretaxContributions: roundToCents(
        sumBy(slots, (s) => s.traditionalContrib),
      ),
    });
  const firstRamp = yearRampAmount(
    yearIndex,
    input.brokerageContributionRamp,
    first.contribution,
  );
  const funded = setup.gapYear
    ? fundGapYearSaving(
        specs,
        {
          amount: firstRamp,
          isPortfolio: rampIsPortfolioSaving(
            ctx.indAccounts,
            (ia) => ctx.indParentCat.get(ctx.indKey(ia)) ?? ia.parentCategory,
          ),
        },
        first,
        route,
        (slots, ramp) => needOf(slots, ramp).need,
      )
    : { specs, sized: first, ramp: firstRamp, skipped: 0 };
  const contributionSpecs = funded.specs;
  const rampAmount = funded.ramp;
  const {
    useRealContributions,
    proRate,
    targetContribution,
    personPay,
    contribution,
    slots,
    routeWarnings,
    specOverflow,
    rateCeilingScale,
  } = funded.sized;
  if (funded.skipped > 0)
    routeWarnings.push(
      `${year}: $${Math.round(funded.skipped).toLocaleString()} of Portfolio saving skipped: the pay left after spending doesn't cover it, and a gap year draws for spending only.`,
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

  const gapNeed = setup.gapYear ? needOf(slots, rampAmount) : null;

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
    rampAmount,
    gapNeed,
    contributionSpecs,
  };
}

/** Year 0's basis, the target and match, the IRS limits and the routed slots, for `specs`. */
function routeYearContributions(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  setup: PreYearSetup,
  terms: {
    yearIndex: number;
    config: ReturnType<typeof resolveAccumulationConfig>;
    lgf: number;
    specs: ProjectionLoopState["contributionSpecs"];
  },
) {
  const { yearIndex, config, lgf, specs: contributionSpecs } = terms;
  const {
    year,
    effectiveSalary: projectedSalary,
    effectiveSalaryByPerson: projectedSalaryByPerson,
  } = setup;
  const { input, hasPerPersonSalary, firstYearFraction } = ctx;
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

  return {
    useRealContributions,
    proRate,
    targetContribution,
    personPay,
    contribution,
    slots,
    routeWarnings,
    specOverflow,
    rateCeilingScale,
  };
}

/** The brokerage contribution ramp: $X more each year from year 1, none in a stopped year. */
function yearRampAmount(
  yearIndex: number,
  brokerageContributionRamp: ProjectionContext["input"]["brokerageContributionRamp"],
  contribution: ContributionState,
) {
  const rampYear = Math.min(yearIndex, MAX_BROKERAGE_RAMP_YEARS);
  return brokerageContributionRamp != null &&
    brokerageContributionRamp > 0 &&
    yearIndex > 0 &&
    contribution.kind !== "stopped"
    ? roundToCents(brokerageContributionRamp * rampYear)
    : 0;
}
