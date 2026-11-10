/** This year's household return, as the Taxes page shows it. */
import type * as schema from "@/lib/db/schema";
import { parseReturnFilingStatus } from "@/lib/config/filing-status";
import { medicareLiabilityKey } from "@/lib/config/tax-params";
import { returnDeductionTerms } from "@/lib/pure/tax/return-deductions";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import { liabilityBracketInput } from "@/server/services/paycheck/liability-bracket-input";

/** Federal tax on the earners' combined wages under the return's filing
 *  status, FICA per person; null without that status's standard table. */
export function householdReturnTax(
  earnings: Parameters<typeof calculateHouseholdTax>[0]["people"],
  filingStatus: string,
  allBrackets: (typeof schema.taxBrackets.$inferSelect)[],
  limitsMap: Map<string, number>,
  limitsRecord: Record<string, number>,
  taxYear: number,
) {
  const bracketRow = allBrackets.find(
    (b) => b.filingStatus === filingStatus && b.w4Checkbox === false,
  );
  if (!bracketRow) return null;
  return calculateHouseholdTax({
    people: earnings,
    taxBrackets: liabilityBracketInput(bracketRow, limitsMap),
    medicareLiabilityThreshold:
      limitsRecord[medicareLiabilityKey(filingStatus)] ?? null,
    // The page counts no one on the return 65+ (CALCULATIONS TAX-01).
    ageDeductions: {
      terms: returnDeductionTerms(
        limitsRecord,
        parseReturnFilingStatus(filingStatus),
      ),
      over65: 0,
      year: taxYear,
    },
  });
}
