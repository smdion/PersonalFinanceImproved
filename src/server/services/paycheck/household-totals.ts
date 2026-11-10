import type * as schema from "@/lib/db/schema";
import { paysMedical, isRothIncomeLimited } from "@/lib/config/account-types";
import { medicareLiabilityKey } from "@/lib/config/tax-params";
import { hsaCashBuffers } from "@/lib/pure/accounts/cash-positions";
import type { CapPassed } from "@/lib/pure/contributions/contribution-caps";
import {
  rothIraRouteOf,
  rothIraSummary,
} from "@/lib/pure/contributions/roth-ira";
import {
  type computeAnnualEarnings,
  sumHouseholdIncome,
} from "@/lib/pure/household/household-income";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { loadCapHousehold } from "@/server/services/contributions/caps";
import type { ContribRowWithActiveFields } from "@/server/services/contributions/profile";
import { liabilityBracketInput } from "@/server/services/paycheck/liability-bracket-input";

export function householdTotals(
  results: {
    person: typeof schema.people.$inferSelect;
    earnings: ReturnType<typeof computeAnnualEarnings> | null;
    rawContribs: (ContribRowWithActiveFields & CapPassed)[];
  }[],
  capHousehold: Awaited<ReturnType<typeof loadCapHousehold>>,
  allBrackets: (typeof schema.taxBrackets.$inferSelect)[],
  limitsMap: Map<string, number>,
  limitsRecord: Record<string, number>,
  taxYear: number,
) {
  // Household income and tax: federal on combined income with ONE standard
  // deduction; FICA per person; Additional Medicare on combined Medicare wages
  // above the threshold. Earners = everyone with pay this year.
  const earners = results.filter((r) => r.earnings);
  const householdIncome =
    earners.length > 0
      ? sumHouseholdIncome(earners.map((r) => r.earnings!))
      : null;
  // The household's tax-return filing status — the one the caps use
  // (loadCapHousehold), never a W-4 on its own: a W-4 status is a
  // withholding choice (married couples often pick Single).
  const householdFilingStatus = capHousehold.filingStatus || null;
  let householdTax = null;
  if (earners.length > 0 && householdFilingStatus) {
    const filingStatus = householdFilingStatus;
    const bracketRow = allBrackets.find(
      (b) => b.filingStatus === filingStatus && b.w4Checkbox === false,
    );
    if (bracketRow) {
      householdTax = calculateHouseholdTax({
        people: earners.map((r) => r.earnings!),
        taxBrackets: liabilityBracketInput(bracketRow, limitsMap),
        medicareLiabilityThreshold:
          limitsRecord[medicareLiabilityKey(filingStatus)] ?? null,
      });
    }
  }

  const rothIra = rothIraSummary({
    // No one with a job → no Roth IRA view, as before.
    filingStatus: earners.length > 0 ? householdFilingStatus : null,
    taxYear,
    limits: limitsRecord,
    people: results.map((r) => ({
      personId: r.person.id,
      name: r.person.name,
      birthYear: Number(r.person.dateOfBirth.slice(0, 4)),
      earnings: r.earnings,
      jobAccountTypes: r.rawContribs
        .filter((c) => c.jobId !== null)
        .map((c) => c.accountType),
      iraRoom:
        r.rawContribs.find((c) => isRothIncomeLimited(c.accountType) && c.cap)
          ?.cap?.maxEmployee ?? null,
      rothRoute: rothIraRouteOf(r.rawContribs),
    })),
  });

  // Default cash to keep in each person's HSA: the year's HDHP minimum
  // deductible for their coverage (from their HSA contribution account).
  const hsaBuffers = hsaCashBuffers({
    limits: limitsRecord,
    people: results.map((r) => ({
      personId: r.person.id,
      hsaCoverageType:
        r.rawContribs.find(
          (c) => paysMedical(c.accountType) && c.hsaCoverageType,
        )?.hsaCoverageType ?? null,
    })),
  });

  return {
    householdIncome,
    householdFilingStatus,
    householdTax,
    rothIra,
    hsaBuffers,
  };
}
