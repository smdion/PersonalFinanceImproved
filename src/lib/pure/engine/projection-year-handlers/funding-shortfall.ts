/** The decumulation year's unmet need: what the year couldn't fund. */
import { roundToCents } from "../../../utils/math";
import { shortfallFloor } from "../gap-year-draw";
import type { DecumulationYear } from "./types";
import type { RepricedFlow } from "./conversion-year-reprice";
import { payIrmaaCharge, type IrmaaCharge } from "./irmaa-charge";
import { shortfallPartsInUnmet } from "./shortfall-parts";

/** The unmet need, its locked and Portfolio parts, and IRMAA paid. */
export function fundingShortfallForYear(
  state: { portfolioWithdrawal: number | null },
  thisYear: DecumulationYear,
  flow: RepricedFlow & { settle: { rmdExcessAmount: number } },
  { irmaa }: { irmaa: IrmaaCharge },
) {
  const { totalWithdrawal } = flow.rmd;
  const { taxCost } = flow.repriced;
  const { penaltyCost, surplusCredit } = flow.parts;
  const { afterTaxNeed } = flow.need;
  const { routedUnmetNeed } = flow.route;
  const deliveredAfterTax = roundToCents(
    totalWithdrawal - taxCost - penaltyCost,
  );
  const irmaaPayment = payIrmaaCharge(irmaa, state, thisYear, {
    deliveredAfterTax,
    rmdExcessAmount: flow.settle.rmdExcessAmount,
  });
  // A withdrawal-sized year's gap: what couldn't leave the portfolio; else
  // the need less what was delivered and Social Security's surplus credit.
  const needGap = roundToCents(
    state.portfolioWithdrawal !== null
      ? Math.max(0, state.portfolioWithdrawal - totalWithdrawal)
      : Math.max(0, afterTaxNeed - deliveredAfterTax - surplusCredit(taxCost)),
  );
  const fundingShortfall = roundToCents(needGap + irmaaPayment.unpaid);
  const floor = shortfallFloor(afterTaxNeed);
  // Routing fell short (its own figure is gross dollars, not need) or a material gap.
  const shown = routedUnmetNeed !== undefined || fundingShortfall > floor;
  const unmetNeedRaw = shown ? fundingShortfall : undefined;
  // A no-gross-up household's own tax and penalty gap is by design: netted out.
  const grossUpExplainedGap =
    thisYear.taxRates.grossUpForTaxes !== false
      ? 0
      : roundToCents(Math.min(taxCost + penaltyCost, needGap));
  const netFundingShortfall = roundToCents(
    Math.max(0, fundingShortfall - grossUpExplainedGap),
  );
  const unmetNeedMaterial = netFundingShortfall > floor;
  return {
    irmaaPayment,
    deliveredAfterTax,
    shortfallMaterialityFloor: floor,
    unmetNeedRaw,
    unmetNeedMaterial,
    ...shortfallPartsInUnmet(flow.route, fundingShortfall),
  };
}
