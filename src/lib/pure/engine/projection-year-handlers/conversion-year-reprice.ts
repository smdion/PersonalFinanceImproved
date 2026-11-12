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

/** The year's income as priced, by stream, with `rothConversions` of
 *  conversion: what its MAGI readings and the year's history read. */
function pricedYearIncome(
  thisYear: Pick<DecumulationYear, "ssIncome">,
  flow: Pick<DecumulationFlow, "rmd" | "priced" | "parts">,
  rothConversions: number,
): YearIncome {
  return {
    traditionalDraws: flow.rmd.totalTraditionalWithdrawal,
    rothTaxableGrowth: flow.priced.taxFromSlots.rothTaxableGrowth,
    rothConversions,
    realizedGains: flow.parts.brokerageGainsPortion,
    socialSecurity: {
      gross: thisYear.ssIncome,
      taxable: flow.priced.taxableSS,
    },
  };
}

/** The conversion year's gains re-priced, then NIIT, after the RMD excess is
 *  reinvested: today's order (funding NIIT first is v0.11). */
export function repriceConversionYear(
  ctx: ProjectionContext,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "rmd" | "priced" | "parts" | "conversion">,
) {
  const { filingStatus } = ctx.input;
  const { tables } = thisYear;
  const { grownLtcgBrackets } = tables;
  const taxRates = {
    ...thisYear.taxRates,
    taxBrackets: tables.grownTaxBrackets,
  };
  const { taxFromSlots, priceTax, taxableSS } = flow.priced;
  // The deduction priceYearTax priced the year with (the conversion's too).
  const grownStandardDeduction = flow.priced.standardDeduction;
  const { actualTaxableIncome, brokerageGainsPortion } = flow.parts;
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

  const income = pricedYearIncome(thisYear, flow, rothConversionAmount);
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
