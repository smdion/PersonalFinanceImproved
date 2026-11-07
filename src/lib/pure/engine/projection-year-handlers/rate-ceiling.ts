/** The retirement-rate ceiling on a working year's contribution slots. */
import { roundToCents, sumBy } from "../../../utils/math";
import { remainingRoom } from "../contribution-routing";
import type { AccumulationSlot } from "../types/routing";
import type { resolveAccumulationConfig } from "../override-resolution";
import {
  retirementRateCeiling,
  type ContributionState,
} from "@/lib/pure/contributions/contribution-state";

/**
 * Scales the spec slots' retirement money down to the year's contribution
 * rate, in place. Returns the scale (null under the ceiling) and the IRS
 * overflow, scaled with the slots.
 */
export function applyRateCeiling(
  slots: AccumulationSlot[],
  contribution: ContributionState,
  projectedSalary: number,
  config: ReturnType<typeof resolveAccumulationConfig>,
  proRate: number,
  specOverflow: number,
): { scale: number | null; specOverflow: number } {
  // The rate ceiling is authoritative: overrides always take effect. It
  // caps retirement money only; Portfolio-parented specs keep their
  // amounts, so adding Portfolio savings never shrinks a 401(k).
  const portfolioPart = (s: AccumulationSlot) => s.portfolioContrib ?? 0;
  const retirementTotal = roundToCents(
    sumBy(slots, (s) => s.employeeContrib - portfolioPart(s)),
  );
  const rateCeiling = retirementRateCeiling(
    contribution,
    roundToCents(
      projectedSalary * Math.max(0, config.contributionRate) * proRate,
    ),
  );
  if (rateCeiling.kind === "at" && retirementTotal > rateCeiling.amount) {
    const scale = rateCeiling.amount / retirementTotal;
    for (const slot of slots) {
      const portfolio = portfolioPart(slot);
      // Retirement part scaled, Portfolio part kept; each tax part scaled
      // on its own (with no Portfolio part, the ratio is the scale).
      const ratio =
        portfolio > 0 && slot.employeeContrib > 0
          ? (portfolio + (slot.employeeContrib - portfolio) * scale) /
            slot.employeeContrib
          : scale;
      const newEmployee = roundToCents(slot.employeeContrib * ratio);
      slot.rothContrib = roundToCents(slot.rothContrib * ratio);
      slot.traditionalContrib = roundToCents(slot.traditionalContrib * ratio);
      slot.employeeContrib = newEmployee;
      slot.remainingSpace = remainingRoom(slot, newEmployee);
    }
    // The IRS overflow inside the overflow target's slot scaled with the
    // rest; it is still overflow, routed to retirement money later.
    return { scale, specOverflow: roundToCents(specOverflow * scale) };
  }
  return { scale: null, specOverflow };
}
