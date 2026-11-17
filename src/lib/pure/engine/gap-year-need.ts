/** What a gap year's pay leaves short of spending: pay, Social Security, contributions and tax. */
import { roundToCents, sumBy } from "../../utils/math";
import {
  growLtcgBrackets,
  growWithholdingBrackets,
  taxTableYears,
} from "./bracket-growth";
import { socialSecurityForYear } from "./social-security-income";
import { computeTaxableSS, estimateEffectiveTaxRate } from "./tax-estimation";
import type { ProjectionContext } from "./projection-year-handlers/types";

/** The year's need before any draw, and the income and tax tables the draw is priced on. */
export function gapYearNeed(
  ctx: ProjectionContext,
  args: {
    year: number;
    age: number;
    /** The part of the year the plan covers (year 0 is partial). */
    fraction: number;
    /** The year's pay, per person, and budget: scaled to `fraction`. */
    payByPerson: readonly number[];
    budget: number;
    /** The employee's contributions, and the part W-2 wages leave out
     *  (`payrollTaxSkipped`: pre-tax and HSA payroll money). */
    employeeContributions: number;
    pretaxContributions: number;
  },
) {
  const { input } = ctx;
  const { year, age, fraction, payByPerson, budget } = args;
  const { employeeContributions, pretaxContributions } = args;
  const pay = sumBy(payByPerson, (p) => p);
  const { decumulationDefaults, filingStatus } = input;
  const taxRates = decumulationDefaults.distributionTaxRates;

  const tableYears = taxTableYears(taxRates);
  const taxBrackets = taxRates.taxBrackets
    ? growWithholdingBrackets(
        taxRates.taxBrackets,
        ctx.inflation.growthSinceVintage(year, tableYears.brackets),
      )
    : undefined;
  const standardDeduction =
    taxRates.standardDeduction != null
      ? taxRates.standardDeduction *
        ctx.inflation.growthSinceVintage(year, tableYears.standardDeduction)
      : undefined;
  const ltcgBrackets = growLtcgBrackets(
    taxRates.ltcgBrackets,
    ctx.inflation.growthSinceVintage(year, tableYears.ltcg),
  );

  const ssIncome = roundToCents(
    socialSecurityForYear(
      input,
      year,
      age,
      ctx.inflation.growth(year - input.asOfDate.getFullYear()),
    ).ssIncome * fraction,
  );
  const wages = Math.max(0, pay - pretaxContributions);
  const taxableSsOn = (otherIncome: number) =>
    filingStatus ? computeTaxableSS(ssIncome, otherIncome, filingStatus) : 0;
  const incomeTaxOn = (income: number) =>
    income *
    (taxBrackets && taxBrackets.length > 0
      ? estimateEffectiveTaxRate(
          income,
          taxBrackets,
          taxRates.taxMultiplier,
          standardDeduction,
        )
      : taxRates.traditionalFallbackRate);
  const incomeAlone = wages + taxableSsOn(wages);
  const taxOnIncome = incomeTaxOn(incomeAlone);
  const { payrollTax } = input;
  const wageBase =
    payrollTax &&
    payrollTax.socialSecurityWageBase *
      ctx.inflation.growthSinceVintage(year, tableYears.standardDeduction);
  const payrollCost = payrollTax
    ? sumBy(
        payByPerson,
        (p) =>
          Math.min(p, wageBase! * fraction) * payrollTax.socialSecurityRate +
          p * payrollTax.medicareRate,
      )
    : 0;
  // Contribution lines inflate with the budget and aren't in a typed figure.
  const typedFigure = [...ctx.budgetOverrideMap.keys()].some((y) => y <= year);
  const contributionLines = typedFigure
    ? 0
    : input.budgetContributionLines *
      ctx.inflation.growth(year - input.asOfDate.getFullYear()) *
      fraction;
  const spending = Math.max(0, budget - contributionLines);
  const need = roundToCents(
    Math.max(
      0,
      spending -
        (pay + ssIncome - employeeContributions - taxOnIncome - payrollCost),
    ),
  );
  const figures = {
    pay,
    ssIncome,
    contributions: employeeContributions,
    taxOnIncome: roundToCents(taxOnIncome + payrollCost),
    spending: roundToCents(spending),
  };

  return {
    year,
    need,
    figures,
    wages,
    incomeAlone,
    taxOnIncome,
    taxableSsOn,
    taxBrackets,
    standardDeduction,
    ltcgBrackets,
  };
}

export type GapYearNeed = ReturnType<typeof gapYearNeed>;
