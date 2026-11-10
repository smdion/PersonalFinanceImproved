/** A Roth conversion's room under the next IRMAA cliff. */
import { roundToCents } from "../../utils/math";
import {
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import type { MagiIncome } from "@/lib/pure/tax/year-income";

/** The most a conversion can add before the year's IRMAA MAGI passes the
 *  next cliff above it; null when no cliff lies above. */
export function irmaaConversionHeadroom(
  incomeBeforeConversion: MagiIncome<"irmaa">,
  filingStatus: ReturnFilingStatus,
  irmaaBrackets: Record<string, IrmaaBracket[]>,
): number | null {
  const income = incomeBeforeConversion;
  // Today's term order (float ties at a cliff); yearMagi once it rounds to cents.
  const magiWithoutConversion =
    income.traditionalDraws +
    income.realizedGains +
    income.socialSecurity.taxable +
    income.rothTaxableGrowth;
  const nextCliff = getNextIrmaaCliff(
    magiWithoutConversion,
    filingStatus,
    irmaaBrackets,
  );
  if (nextCliff == null) return null;
  return roundToCents(Math.max(0, nextCliff - magiWithoutConversion));
}
