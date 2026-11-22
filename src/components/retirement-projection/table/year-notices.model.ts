/** A table row's notices: the year's unmet need, worded from the year's own
 *  facts, then the engine's warnings. */
import type { EngineYearProjection } from "@/lib/pure/engine/types";
import { gapUnmetNeedMaterial } from "@/lib/pure/engine";
import { moneyGone } from "@/lib/pure/retirement/plan-outcome";
import { UNMET_PART_LABEL } from "@/lib/config/display-labels";
import { formatCurrency } from "@/lib/utils/format";
import type { ProjectionState } from "../projection-table-types";

const sentenceStart = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The household's unmet need, by the year's materiality test, under any row
 * filter, in the tooltip's dollars. Each part is stated against the whole
 * ("of it"): the parts overlap and are never added.
 */
export function unmetNeedNotice(
  year: EngineYearProjection,
  deflate: ProjectionState["deflate"],
): string | undefined {
  const money = (amount: number) => formatCurrency(deflate(amount, year.year));
  if (year.phase === "accumulation") {
    const gap = year.gapDraw;
    if (!gap || !gapUnmetNeedMaterial(gap)) return undefined;
    return `${money(gap.unmetNeed)} of this year's spending can't be funded with a paycheck gone.`;
  }
  if (!year.unmetNeedMaterial || year.unmetNeed === undefined) return undefined;
  const lead = `${money(year.unmetNeed)} of this year's spending can't be funded`;
  const parts = [
    {
      noun: UNMET_PART_LABEL.penaltyAvoided,
      amount: year.penaltyAvoidedShortfall,
    },
    {
      noun: UNMET_PART_LABEL.nonRetirement,
      amount: year.nonRetirementShortfall,
    },
  ].flatMap(({ noun, amount }) =>
    amount !== undefined && amount > 0
      ? [` ${sentenceStart(noun)} could cover ${money(amount)} of it.`]
      : [],
  );
  if (parts.length > 0) return `${lead}.${parts.join("")}`;
  return moneyGone(year)
    ? `${lead}: retirement money has run out.`
    : `${lead}.`;
}

/** The row's notices: the year's unmet need first, then the engine's warnings. */
export function yearNotices(
  year: EngineYearProjection,
  deflate: ProjectionState["deflate"],
): string[] {
  const notice = unmetNeedNotice(year, deflate);
  return notice === undefined ? year.warnings : [notice, ...year.warnings];
}
