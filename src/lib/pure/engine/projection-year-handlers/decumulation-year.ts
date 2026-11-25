/** The decumulation year: runDecumulationYear calls its stages in order. */
import { socialSecurityForYear } from "../social-security-income";
import { retirementBrokerageBasisRatio } from "../brokerage-basis";
import { sumBy } from "../../../utils/math";
import { countPeople, countReachingAgeRule } from "@/lib/pure/household/age";
import { resolveDecumulationConfig } from "../override-resolution";
import { computeWithdrawalEligibility } from "@/lib/pure/accounts/eligibility";
import type {
  DecumulationYear,
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { yearRmdAndQcd } from "./year-rmd-qcd";
import { enforceYearRmd } from "./rmd-step";
import { settleYearTax } from "./tax-settlement";
import { fundingShortfallForYear } from "./funding-shortfall";
import { distributeYearDraws, routeYearDraw } from "./year-draws";
import { yearNeed } from "./year-need";
import { growYearTaxTables } from "./year-tax-tables";
import { decumulationPortfolioContributions } from "./portfolio-contributions";
import { yearCliffChecks } from "./year-cliffs";
import { yearStartIrmaaCharge } from "./irmaa-charge";
import { closeDecumulationYear } from "./year-end";
import { decumulationYearRow } from "./decumulation-row";

/** One decumulation year, its stages in today's order; each stage's file
 *  names its decision (UD-04 in rmd-step.ts and tax-year-settlement.ts,
 *  UD-08 in tax-year-settlement.ts). Pushes the row to state.projectionByYear. */
export function runDecumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
  setup: PreYearSetup,
): void {
  const { age, year, retirementBalance } = setup;
  const {
    input,
    sortedDecumulationOverrides,
    ledgerRuns,
    indAccounts,
    indKey,
  } = ctx;
  const { balances, indBalance, indBasis, brokBasis } = state;

  const { decumulationDefaults, perPersonBirthYears } = input;

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    sortedDecumulationOverrides,
  );

  // Each account's penalty-free/locked split this year, computed once for
  // both routeForMode sites (the solver's estimate and the real draw), from
  // the running Roth basis the UI shows.
  const eligibility = ctx.holdsRealAccount
    ? computeWithdrawalEligibility({
        year,
        indAccounts,
        indBalance,
        indKey,
        indBasis,
      })
    : undefined;
  // Portfolio-parented money never funds retirement spending: one exclusion
  // a year, read by every step that decides what's available.
  const { nonRetirement } = setup;

  // Social Security reduces the need (each person's from their start age).
  const { ssIncome, ssIncomeByPerson } = socialSecurityForYear(
    input,
    year,
    age,
    ctx.inflation.growth(year - input.asOfDate.getFullYear()),
  );
  const { owed, qcd } = yearRmdAndQcd(ctx, state, year, config);

  // This year's retirement withdrawals' basis ratio: the Retirement
  // brokerages' own (start of year), for the estimate, ranking and tax.
  const retirementBasisRatio = ledgerRuns
    ? retirementBrokerageBasisRatio(indAccounts, indKey, indBalance, brokBasis)
    : undefined;

  const taxRates = decumulationDefaults.distributionTaxRates;
  // Retirement money only (PreYearSetup.retirementBalance): Portfolio-
  // parented Traditional money is never withdrawn for spending, so it can't
  // be part of the estimate.
  const retirementPreTax =
    balances.preTax -
    (nonRetirement ? sumBy(Object.values(nonRetirement.trad), (v) => v) : 0);
  const estTraditionalPortion =
    retirementBalance > 0
      ? Math.max(0, retirementPreTax) / retirementBalance
      : 0;

  const tables = growYearTaxTables(ctx, state, year, age);

  const personsAge65Plus = countReachingAgeRule(
    perPersonBirthYears,
    age,
    "medicare",
    year,
  );
  const thisYear: DecumulationYear = {
    year,
    age,
    setup,
    config,
    eligibility,
    taxRates,
    tables,
    ssIncome,
    personsAge65Plus,
    personsUnder65: countPeople(perPersonBirthYears) - personsAge65Plus,
    retirementBasisRatio,
    ssIncomeByPerson,
    estTraditionalPortion,
    priorYearEndTradBalance: state.priorYearEndTradBalance,
  };
  const irmaa = yearStartIrmaaCharge(ctx, state, thisYear);
  const need = yearNeed(ctx, state, thisYear, irmaa);
  const route = routeYearDraw(ctx, state, thisYear, need);
  const rmd = enforceYearRmd(ctx, state, thisYear, route, owed, qcd);
  const drawn = distributeYearDraws(ctx, state, thisYear, { route, rmd });
  const drawnFlow = { need, route, rmd, drawn };
  const taxed = settleYearTax(ctx, state, thisYear, drawnFlow);
  const flow = { ...drawnFlow, ...taxed };
  const cliffs = yearCliffChecks(ctx, state, thisYear, flow, irmaa);
  const shortfall = fundingShortfallForYear(state, thisYear, flow, cliffs);

  const contributions = decumulationPortfolioContributions(
    ctx,
    state,
    yearIndex,
  );
  const yearFlow = { ...flow, contributions };
  const closed = closeDecumulationYear(ctx, state, thisYear, yearFlow);

  state.projectionByYear.push(
    decumulationYearRow(ctx, state, thisYear, yearFlow, {
      owed,
      qcd,
      settle: flow.settle,
      shortfall,
      cliffs,
      closed,
    }),
  );
}
