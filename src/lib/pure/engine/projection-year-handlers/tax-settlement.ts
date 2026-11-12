/** The tax-settlement stage: the year's tax priced, its draws settled, its
 *  conversion, then the year re-priced, in today's order (UD-04, UD-08). */
import {
  priceYearTax,
  pricedYearParts,
  settleYearDraws,
  yearRothConversion,
  type DecumulationFlow,
} from "./tax-year-settlement";
import { repriceConversionYear } from "./conversion-year-reprice";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The year's tax settled from its routed draws (tax-year-settlement.ts),
 *  then re-priced after the conversion (conversion-year-reprice.ts). */
export function settleYearTax(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "need" | "route" | "rmd" | "drawn">,
) {
  const { need, route, rmd } = flow;
  const priced = priceYearTax(ctx, state, thisYear, flow);
  const parts = pricedYearParts(state, { need, route, rmd, priced });

  const settled = { ...flow, priced, parts };
  const settle = settleYearDraws(ctx, state, thisYear, settled);
  const conversion = yearRothConversion(ctx, state, thisYear, settled);
  const repriced = repriceConversionYear(ctx, thisYear, {
    rmd,
    priced,
    parts,
    conversion,
  });
  return { priced, parts, settle, conversion, repriced };
}
