import { isRetirementMoney } from "@/lib/config/account-types";
import { sumBy } from "@/lib/utils/math";

/** A year's employee contributions to retirement money — every spec but the
 *  Portfolio-parented ones (savings outside retirement accounts). The
 *  contribution rate is this over total compensation. */
export function retirementContributions(
  specs: readonly { baseAnnual: number; parentCategory?: string }[],
): number {
  return sumBy(
    specs.filter((s) => isRetirementMoney(s.parentCategory)),
    (s) => s.baseAnnual,
  );
}
