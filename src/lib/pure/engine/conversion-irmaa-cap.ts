/** A Roth conversion's room under the next IRMAA cliff. */
import { roundToCents } from "../../utils/math";
import {
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { yearMagi, type MagiIncome } from "@/lib/pure/tax/year-income";
import { countReachingAgeRule } from "@/lib/pure/household/age";

/** Whether anyone is on Medicare in the premium year that reads `year`'s
 *  MAGI, two years on (42 USC 1395r(i)(4)(B)(i)): only an enrollee pays
 *  IRMAA, so without one a conversion can't raise a premium. */
export function premiumYearHasEnrollee(
  perPersonBirthYears: readonly number[] | undefined,
  age: number,
  year: number,
): boolean {
  return (
    countReachingAgeRule(perPersonBirthYears, age + 2, "medicare", year + 2) > 0
  );
}

/** The most a conversion can add, in cents, with the year's IRMAA MAGI at
 *  or under the next cliff above it; null when no cliff lies above. */
export function irmaaConversionHeadroom(
  incomeBeforeConversion: MagiIncome<"irmaa">,
  filingStatus: ReturnFilingStatus,
  irmaaBrackets: Record<string, IrmaaBracket[]>,
): number | null {
  const magiWithoutConversion = yearMagi(incomeBeforeConversion, "irmaa");
  const nextCliff = getNextIrmaaCliff(
    magiWithoutConversion,
    filingStatus,
    irmaaBrackets,
  );
  if (nextCliff == null) return null;
  // A grown cliff keeps its fractions, so the nearest cent can land MAGI up
  // to half a cent over it and charge the whole tier: take a cent off then.
  const headroom = roundToCents(Math.max(0, nextCliff - magiWithoutConversion));
  return roundToCents(magiWithoutConversion + headroom) > nextCliff
    ? roundToCents(Math.max(0, headroom - 0.01))
    : headroom;
}
