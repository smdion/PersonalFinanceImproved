/** The decumulation year's standard deduction, grown to the year. */
import { ADDITIONAL_STANDARD_DEDUCTION_AGE } from "../../../constants";
import { returnDeductions } from "@/lib/pure/tax/return-deductions";
import { yearMagi } from "@/lib/pure/tax/year-income";
import { growAmount } from "../bracket-growth";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The base deduction plus the §63(f) senior add-on, grown from the limits
 *  year, then the OBBBA senior deduction (not indexed) on top. */
export function yearStandardDeduction(
  perPersonBirthYears: ProjectionContext["input"]["perPersonBirthYears"],
  year: number,
  age: number,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  incomeHistory: ProjectionLoopState["incomeHistory"],
  taxGrowth: number,
) {
  // Household members 65+ this year (one when birth years are missing and
  // the household's age is 65+).
  const seniorCount =
    perPersonBirthYears && perPersonBirthYears.length > 0
      ? perPersonBirthYears.filter(
          (by) => year - by >= ADDITIONAL_STANDARD_DEDUCTION_AGE,
        ).length
      : age >= ADDITIONAL_STANDARD_DEDUCTION_AGE
        ? 1
        : 0;
  // The senior deduction's phaseout reads last year's MAGI, unknown in the
  // first decumulation year ($0 that year).
  const lastYearIncome = incomeHistory.at(-1);
  const { standardDeduction, seniorDeduction } = returnDeductions({
    terms: {
      basic: taxRates.standardDeduction,
      addOnPerCondition: taxRates.additionalStdDeduction65PerSenior,
      senior: {
        perPerson: taxRates.obbbaSeniorDeductionPerPerson,
        phaseoutStart: taxRates.obbbaSeniorPhaseoutStart,
        phaseoutRate: taxRates.obbbaSeniorPhaseoutRate,
        sunsetYear: taxRates.obbbaSeniorSunsetYear,
      },
    },
    over65: seniorCount,
    magi: lastYearIncome
      ? { kind: "known", value: yearMagi(lastYearIncome, "seniorDeduction") }
      : { kind: "unknown" },
    year,
  });
  // The senior deduction is a fixed statutory figure, not CPI-indexed:
  // added after the base and §63(f) add-on are grown, never grown with them.
  const grownBaseAndAddOn = growAmount(standardDeduction, taxGrowth);
  const grownStandardDeduction =
    grownBaseAndAddOn != null
      ? grownBaseAndAddOn + seniorDeduction
      : grownBaseAndAddOn;

  return { grownStandardDeduction };
}
