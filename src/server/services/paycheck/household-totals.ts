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
import { buildBracketInput } from "@/lib/pure/paycheck/withholding";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import { toTaxableIncomeBrackets } from "@/lib/pure/tax/tax-brackets";
import type { loadCapHousehold } from "@/server/services/contributions/caps";
import type { ContribRowWithActiveFields } from "@/server/services/contributions/profile";

/**
 * Annual-liability variant of buildBracketInput: same limits, but brackets
 * reshaped into real Form 1040 taxable-income space via
 * toTaxableIncomeBrackets (calculateHouseholdTax's own standardDeduction
 * subtraction was double-counting against the un-reshaped Pub 15-T
 * withholding brackets). Requires the standard (non-2c) row — the 2(c)
 * half-tables have no 1040 analogue.
 */
export function buildLiabilityBracketInput(
  bracketRow: typeof schema.taxBrackets.$inferSelect,
  limits: Map<string, number>,
): TaxBracketInput {
  if (bracketRow.w4Checkbox) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This calculation needs standard W-4 tax brackets (not the multiple-jobs checkbox).",
    });
  }
  // No yearBrackets: the liability path never reads w4Adjustment.
  const base = buildBracketInput(bracketRow, limits, []);
  return { ...base, brackets: toTaxableIncomeBrackets(base.brackets) };
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
        taxBrackets: buildLiabilityBracketInput(bracketRow, limitsMap),
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
