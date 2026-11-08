import { TRPCError } from "@trpc/server";
import type * as schema from "@/lib/db/schema";
import { isHsaCategory, isIraCategory } from "@/lib/config/account-types";
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
import type { TaxBracketInput } from "@/lib/pure/paycheck/paycheck.types";
import {
  buildLiabilityBracketInput,
  StandardW4BracketsRequiredError,
} from "@/lib/pure/paycheck/liability-brackets";
import type { WithholdingTableRow } from "@/lib/pure/paycheck/withholding";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { loadCapHousehold } from "@/server/services/contributions/caps";
import type { ContribRowWithActiveFields } from "@/server/services/contributions/profile";

/** buildLiabilityBracketInput for a service: its domain error answered as
 *  the client's BAD_REQUEST, with the same message. */
export function liabilityBracketInput(
  bracketRow: WithholdingTableRow,
  limits: Map<string, number>,
): TaxBracketInput {
  try {
    return buildLiabilityBracketInput(bracketRow, limits);
  } catch (e) {
    if (e instanceof StandardW4BracketsRequiredError)
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

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
  // Household annual income and tax. Federal on the combined income
  // with ONE standard deduction; FICA per person on FICA wages;
  // Additional Medicare on the household's combined Medicare wages
  // above the filing status's liability threshold.
  // Everyone with pay this year — a current job, or one that ended.
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
        r.rawContribs.find((c) => isIraCategory(c.accountType) && c.cap)?.cap
          ?.maxEmployee ?? null,
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
          (c) => isHsaCategory(c.accountType) && c.hsaCoverageType,
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
