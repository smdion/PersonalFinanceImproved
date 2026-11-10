import { roundToCents } from "../../../utils/math";
import { computeNiit } from "../../tax/niit";
import {
  getLtcgRate,
  scheduleDGainsTax,
  ltcgStackBase,
} from "@/lib/pure/tax/ltcg";
import { estimateEffectiveTaxRate } from "../tax-estimation";
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";
import type { growLtcgBrackets } from "../bracket-growth";
import type { priceYearTax } from "./tax-year-settlement";
import type { ProjectionContext } from "./types";

/** The conversion year's gains re-priced, then NIIT, after the RMD excess is
 *  reinvested: today's order (funding NIIT first is v0.11). */
export function repriceConversionYear(
  taxFromSlots: ReturnType<typeof priceYearTax>["taxFromSlots"],
  actualTaxableIncome: number,
  rothConversionAmount: number,
  grownStandardDeduction: number | undefined,
  filingStatus: ProjectionContext["input"]["filingStatus"],
  brokerageGainsPortion: number,
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  priceTax: ReturnType<typeof priceYearTax>["priceTax"],
  taxableSS: number,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  totalTraditionalWithdrawal: number,
  ssIncome: number,
) {
  let brokerageTaxCost = taxFromSlots.brokerageTaxCost;
  let taxCost = taxFromSlots.taxCost;
  // Roth conversions are ordinary income and can push the gains into a higher
  // LTCG bracket: the gains are re-priced on the revised ordinary income, and
  // the shown rate reads it as taxable income.
  let postConversionLtcgRate: number;
  const revised = ltcgStackBase(
    actualTaxableIncome + rothConversionAmount,
    grownStandardDeduction,
  );
  const revisedOrdinary = revised.ordinaryTaxable;
  const stackTop =
    revisedOrdinary +
    Math.max(0, brokerageGainsPortion - revised.unusedDeduction);
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    brokerageTaxCost = roundToCents(
      scheduleDGainsTax(
        actualTaxableIncome + rothConversionAmount,
        brokerageGainsPortion,
        filingStatus,
        {
          ...taxRates,
          standardDeduction: grownStandardDeduction,
          ltcgBrackets: grownLtcgBrackets,
        },
        estimateEffectiveTaxRate,
      ),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      stackTop,
      filingStatus,
      grownLtcgBrackets,
    );
    // Re-priced through the same computeTaxFromSlots call, never a hand copy.
    taxCost = priceTax(taxableSS, brokerageTaxCost).taxCost;
  } else {
    // Display-only: marginal bracket at the ceiling of the gains stack.
    // No tax is actually computed from this value.
    postConversionLtcgRate =
      brokerageGainsPortion > 0 && filingStatus
        ? getLtcgRate(stackTop, filingStatus, grownLtcgBrackets)
        : brokerageGainsPortion > 0
          ? taxRates.brokerage
          : filingStatus
            ? getLtcgRate(revisedOrdinary, filingStatus, grownLtcgBrackets)
            : taxRates.brokerage;
  }

  const income: YearIncome = {
    traditionalDraws: totalTraditionalWithdrawal,
    rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
    rothConversions: rothConversionAmount,
    realizedGains: brokerageGainsPortion,
    socialSecurity: { gross: ssIncome, taxable: taxableSS },
  };
  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  // Applies to lesser of net investment income or MAGI exceeding threshold.
  // Roth conversions raise MAGI but are NOT net investment income.
  const currentYearMagi = yearMagi(income, "niit");
  const niitAmount = filingStatus
    ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
    : 0;
  if (niitAmount > 0) {
    taxCost = roundToCents(taxCost + niitAmount);
  }

  return { taxCost, postConversionLtcgRate, income, niitAmount };
}
