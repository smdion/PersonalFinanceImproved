/** This year's household return, as the Taxes page shows it. */
import type * as schema from "@/lib/db/schema";
import {
  FILING_STATUS_RULES,
  filingTable,
  parseReturnFilingStatus,
} from "@/lib/config/filing-status";
import { ADDITIONAL_STANDARD_DEDUCTION_AGE } from "@/lib/constants";
import { limitAge } from "@/lib/pure/household/age";
import { medicareLiabilityKey } from "@/lib/config/tax-params";
import { returnDeductionTerms } from "@/lib/pure/tax/return-deductions";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import { liabilityBracketInput } from "@/server/services/paycheck/liability-bracket-input";

type Earnings = Parameters<typeof calculateHouseholdTax>[0]["people"][number];

/** Federal tax on the earners' combined wages under the return's filing
 *  status, with the 65+ deductions of the people on it, FICA per person;
 *  null without that status's standard table. */
export function householdReturnTax(
  results: { person: { dateOfBirth: string }; earnings: Earnings | null }[],
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
  const status = parseReturnFilingStatus(filingStatus);
  // People 65+ at Dec 31 of the tax year, at most as many as the return has.
  const over65 = Math.min(
    results.filter(
      (r) =>
        limitAge(r.person.dateOfBirth, taxYear) >=
        ADDITIONAL_STANDARD_DEDUCTION_AGE,
    ).length,
    status ? filingTable(FILING_STATUS_RULES, status).peopleOnReturn : 0,
  );
  return calculateHouseholdTax({
    people: results.flatMap((r) => (r.earnings ? [r.earnings] : [])),
    taxBrackets: liabilityBracketInput(bracketRow, limitsMap),
    medicareLiabilityThreshold:
      limitsRecord[medicareLiabilityKey(filingStatus)] ?? null,
    ageDeductions: {
      terms: returnDeductionTerms(limitsRecord, status),
      over65,
      year: taxYear,
    },
  });
}
