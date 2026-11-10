import { roundToCents } from "../../../utils/math";
import { computeNiit } from "../../tax/niit";
import {
  computeLtcgTax,
  getLtcgRate,
  toLtcgTaxableIncome,
} from "@/lib/pure/tax/ltcg";
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
  // LTCG bracket: recompute on the revised ordinary income, converted once to
  // the taxable income the LTCG calls below use (they're its only readers).
  let postConversionLtcgRate: number;
  const revisedOrdinary = toLtcgTaxableIncome(
    actualTaxableIncome + rothConversionAmount,
    grownStandardDeduction,
  );
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    brokerageTaxCost = roundToCents(
      computeLtcgTax(
        revisedOrdinary,
        brokerageGainsPortion,
        filingStatus,
        grownLtcgBrackets,
      ),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      revisedOrdinary + brokerageGainsPortion,
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
        ? getLtcgRate(
            revisedOrdinary + brokerageGainsPortion,
            filingStatus,
            grownLtcgBrackets,
          )
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
