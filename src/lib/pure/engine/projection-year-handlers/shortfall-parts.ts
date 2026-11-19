/** A year's locked and Portfolio parts of its unmet need. */
import { roundToCents } from "../../../utils/math";

type RoutedShortfall = {
  routedUnmetNeed?: number;
  penaltyAvoidedShortfall?: number;
  nonRetirementShortfall?: number;
};

/**
 * Each part's share comes from routing (its part of routing's shortfall), its
 * amount from the unmet need: routing's figures are in its trial's dollars.
 * The two parts overlap: each is at most the unmet need, never summed.
 */
export function shortfallPartsInUnmet(
  route: RoutedShortfall,
  unmetNeed: number,
): Pick<RoutedShortfall, "penaltyAvoidedShortfall" | "nonRetirementShortfall"> {
  const { routedUnmetNeed } = route;
  const inUnmet = (part: number | undefined) => {
    if (part === undefined) return undefined;
    if (routedUnmetNeed === undefined || !(routedUnmetNeed > 0))
      throw new Error(
        `A shortfall part of ${part} with no routing shortfall (${routedUnmetNeed})`,
      );
    return roundToCents(unmetNeed * Math.min(1, part / routedUnmetNeed));
  };
  return {
    penaltyAvoidedShortfall: inUnmet(route.penaltyAvoidedShortfall),
    nonRetirementShortfall: inUnmet(route.nonRetirementShortfall),
  };
}
