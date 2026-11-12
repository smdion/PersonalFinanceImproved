import { roundToCents } from "../../../utils/math";
import { computeNiit } from "../../tax/niit";
import {
  getLtcgRate,
  scheduleDGainsTax,
  ltcgStackBase,
} from "@/lib/pure/tax/ltcg";
import { estimateEffectiveTaxRate } from "../tax-estimation";
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";
import type { DecumulationYear, ProjectionContext } from "./types";
import type { DecumulationFlow } from "./tax-year-settlement";

/** The flow once the conversion year is re-priced: what the shortfall and
 *  the cliff checks read. */
export type RepricedFlow = DecumulationFlow & {
  repriced: ReturnType<typeof repriceConversionYear>;
};

/** The conversion year's gains re-priced, then NIIT, after the RMD excess is
 *  reinvested: today's order (funding NIIT first is v0.11). */
export function repriceConversionYear(
  ctx: ProjectionContext,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "rmd" | "priced" | "parts" | "conversion">,
) {
  const { filingStatus } = ctx.input;
  const { ssIncome, tables } = thisYear;
  const { grownStandardDeduction, grownLtcgBrackets } = tables;
  const taxRates = {
    ...thisYear.taxRates,
    taxBrackets: tables.grownTaxBrackets,
  };
  const { taxFromSlots, priceTax, taxableSS } = flow.priced;
  const { actualTaxableIncome, brokerageGainsPortion } = flow.parts;
  const { totalTraditionalWithdrawal } = flow.rmd;
  const { rothConversionAmount } = flow.conversion;
  let brokerageTaxCost = taxFromSlots.brokerageTaxCost;
  let taxCost = taxFromSlots.taxCost;
  // Roth conversions are ordinary income and can push the gains into a higher
  // LTCG bracket: the gains are re-priced on the revised ordinary income, and
  // the shown rate reads it as taxable income.
  let postConversionLtcgRate: number;
  const revised = ltcgStackBase(
    actualTaxableIncome + rothConversionAmount,
    grownStandardDeduction,
    brokerageGainsPortion,
  );
  const revisedOrdinary = revised.ordinaryTaxable;
  const stackTop = revised.top;
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
