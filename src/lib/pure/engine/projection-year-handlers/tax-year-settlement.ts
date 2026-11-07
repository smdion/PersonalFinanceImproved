/** The decumulation year's tax: priced from its draws, then settled. */
import { computeTaxFromSlots, taxableSSFor } from "../tax-estimation";
import type { routeForMode } from "../withdrawal-routing";
import type { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import type {
  growLtcgBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import type { yearNeed } from "./year-need";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's tax from its routed (post-RMD) draws, with Social Security's
 *  taxable share re-derived from that income; priceTax re-prices it later. */
export function priceYearTax(
  slots: ReturnType<typeof routeForMode>["slots"],
  balances: ProjectionLoopState["balances"],
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined,
  grownStandardDeduction: number | undefined,
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  filingStatus: ProjectionContext["input"]["filingStatus"],
  totalTraditionalWithdrawal: number,
  totalRothWithdrawal: number,
  rothTaxSplit: { taxableGrowth: number },
  earlyWithdrawalPenalty: { penaltyCost: number },
  brokerageBasisRatio: ReturnType<
    typeof deriveBasisRankingInputs
  >["brokerageBasisRatio"],
  taxEst: ReturnType<typeof yearNeed>["taxEst"],
  ssIncome: number,
) {
  // One pricing call, shared with withdrawal-solver.ts's estimate and used
  // again after the conversion (never a hand copy of its formula).
  const priceTax = (ss: number, brokerageTaxCostOverride?: number) =>
    computeTaxFromSlots({
      slots,
      taxableSS: ss,
      balances,
      taxRates: {
        ...taxRates,
        taxBrackets: grownTaxBrackets,
        standardDeduction: grownStandardDeduction,
        ltcgBrackets: grownLtcgBrackets,
      },
      filingStatus,
      // The post-RMD totals, not re-derived from slots: RMD enforcement
      // rounds as it adds, which a fresh sum over the slots wouldn't match.
      totalTraditionalWithdrawal,
      totalRothWithdrawal,
      rothTaxableGrowth: rothTaxSplit.taxableGrowth,
      penaltyCost: earlyWithdrawalPenalty.penaltyCost,
      brokerageBasisRatio,
      brokerageTaxCostOverride,
    });
  // Taxable Social Security from this year's post-RMD income (the first
  // pass only supplies that income), then the year priced with it. Muni
  // bond interest isn't tracked, so no taxExemptInterest is passed.
  let { taxableSS } = taxEst;
  let taxFromSlots = priceTax(taxableSS);
  if (filingStatus && ssIncome > 0) {
    taxableSS = taxableSSFor(ssIncome, taxFromSlots, filingStatus);
    taxFromSlots = priceTax(taxableSS);
  }

  return { priceTax, taxableSS, taxFromSlots };
}
