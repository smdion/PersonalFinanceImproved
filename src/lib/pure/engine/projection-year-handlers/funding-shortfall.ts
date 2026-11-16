/** The decumulation year's unmet need: what the year couldn't fund. */
import { roundToCents } from "../../../utils/math";
import { shortfallFloor } from "../gap-year-draw";
import type { DecumulationYear } from "./types";
import type { RepricedFlow } from "./conversion-year-reprice";
import type { IrmaaCharge } from "./irmaa-charge";

/** unmetNeedRaw (the response's unmetNeed; its routed branch isn't floor-
 *  filtered), unmetNeedMaterial, and the IRMAA the year pays on top. */
export function fundingShortfallForYear(
  state: { portfolioWithdrawal: number | null },
  thisYear: DecumulationYear,
  flow: RepricedFlow,
  { irmaa }: { irmaa: IrmaaCharge },
) {
  const { totalWithdrawal } = flow.rmd;
  const { taxCost } = flow.repriced;
  const { penaltyCost, surplusCredit } = flow.parts;
  const { afterTaxNeed } = flow.need;
  const { routedUnmetNeed } = flow.route;
  // The router's unmet need misses gaps from an under-sized gross-up and from
  // tax that rose after routing (RMD, conversion, LTCG, NIIT); comparing what
  // was delivered with what was needed catches them. The larger one counts.
  const deliveredAfterTax = roundToCents(
    totalWithdrawal - taxCost - penaltyCost,
  );
  // A withdrawal-sized year's shortfall is the part of its amount that couldn't
  // leave the portfolio (later tax only lowers what's spent); otherwise the
  // need less what was delivered and Social Security's surplus credit.
  const fundingShortfall = roundToCents(
    state.portfolioWithdrawal !== null
      ? Math.max(0, state.portfolioWithdrawal - totalWithdrawal)
      : Math.max(0, afterTaxNeed - deliveredAfterTax - surplusCredit(taxCost)),
  );
  // Materiality floor, not a correctness tolerance (SHORTFALL_MATERIALITY).
  const shortfallMaterialityFloor = shortfallFloor(afterTaxNeed);
  const unmetNeedRaw =
    fundingShortfall > shortfallMaterialityFloor
      ? Math.max(routedUnmetNeed ?? 0, fundingShortfall)
      : routedUnmetNeed;
  // unmetNeedMaterial: the one materiality verdict for alerting. A no-gross-up
  // household's own tax and penalty are netted out: that gap is by design.
  const shouldGrossUp = thisYear.taxRates.grossUpForTaxes !== false;
  const grossUpExplainedGap = shouldGrossUp
    ? 0
    : roundToCents(Math.min(taxCost + penaltyCost, fundingShortfall));
  const netFundingShortfall = roundToCents(
    Math.max(0, fundingShortfall - grossUpExplainedGap),
  );
  const unmetNeedMaterial =
    Math.max(routedUnmetNeed ?? 0, netFundingShortfall) >
    shortfallMaterialityFloor;

  return {
    irmaaPaid: irmaa.onTop,
    deliveredAfterTax,
    shortfallMaterialityFloor,
    unmetNeedRaw,
    unmetNeedMaterial,
  };
}
