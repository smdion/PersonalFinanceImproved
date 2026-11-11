/**
 * The year's Roth IRA inputs per person (compensation, IRA limit, room,
 * route) from tax data and earnings.
 */
import {
  getAllCategories,
  hasEarlyAccessRule,
  isRothIncomeLimited,
  isTaxFree,
} from "@/lib/config/account-types";
import type { RothIraRoute } from "@/lib/config/enum-values";
import type { PaycheckContributionRow } from "@/lib/pure/contributions/paycheck-contribution-row";
import { irsLimitOrNull } from "@/lib/pure/contributions/irs-limits";
import { ageInYear } from "@/lib/utils/date";
import { sumBy } from "@/lib/utils/math";
import { rothIraPhaseoutKeys } from "@/lib/config/tax-params";

export type RothIraSummary = {
  filingStatus: string;
  /** null when the tax data lacks the year's phase-out rows. */
  phaseOut: { start: number; end: number } | null;
  people: {
    personId: number;
    name: string;
    /** Taxable compensation (≈ W-2 box 1): salary + bonus − pre-tax payroll money. */
    compensation: number;
    /** null when the year's IRA limit row is missing. */
    iraLimit: number | null;
    /** Has a workplace plan that could take a pre-tax IRA roll-in. */
    hasEmployerPlan: boolean;
    /** The cap pass's most this person can put into an IRA (null: no IRA
     *  contribution to size it from). */
    iraRoom: number | null;
    /** How their Roth IRA contribution gets there; null = none. */
    rothRoute: RothIraRoute | null;
  }[];
};

/** A workplace retirement plan (the employer-plan early-access rule) —
 *  where a pre-tax IRA balance could be rolled to clear the pro-rata pool. */
function isEmployerPlanType(accountType: string): boolean {
  return hasEarlyAccessRule(accountType, "employer_plan");
}

/**
 * The year's Roth IRA inputs from reference data and earnings, read softly (missing keys hide
 * the panel). No filing status (no one with a job) → null.
 */
export function rothIraSummary(args: {
  filingStatus: string | null;
  taxYear: number;
  limits: Record<string, number>;
  people: readonly {
    personId: number;
    name: string;
    birthYear: number;
    earnings: { gross: number; preTaxFederal: number } | null;
    /** Account types of the person's job-linked contribution accounts. */
    jobAccountTypes: readonly string[];
    /** The cap pass's most this person can put into an IRA (null: none). */
    iraRoom?: number | null;
    /** Their Roth IRA contribution's route (null/absent: none). */
    rothRoute?: RothIraRoute | null;
  }[];
}): RothIraSummary | null {
  const iraCategory = getAllCategories().find(isRothIncomeLimited);
  if (!args.filingStatus || !iraCategory) return null;
  const keys = rothIraPhaseoutKeys(args.filingStatus);
  const start = args.limits[keys.start];
  const end = args.limits[keys.end];
  return {
    filingStatus: args.filingStatus,
    phaseOut: start !== undefined && end !== undefined ? { start, end } : null,
    people: args.people.map((p) => ({
      personId: p.personId,
      name: p.name,
      compensation: p.earnings
        ? Math.max(0, p.earnings.gross - p.earnings.preTaxFederal)
        : 0,
      iraLimit: irsLimitOrNull(
        iraCategory,
        ageInYear(p.birthYear, args.taxYear),
        null,
        args.limits,
      ),
      hasEmployerPlan: p.jobAccountTypes.some(isEmployerPlanType),
      iraRoom: p.iraRoom ?? null,
      rothRoute: p.rothRoute ?? null,
    })),
  };
}

/** A person's money this year into IRAs other than a Roth IRA (Worksheet
 *  2-2 line 9): their non-Roth IRA rows' money after the IRS-limit caps. */
export function otherIraMoney(
  rows: readonly (Pick<
    PaycheckContributionRow,
    "accountType" | "taxTreatment"
  > & {
    cap?: { cappedAnnual: number };
  })[],
): number {
  return sumBy(
    rows.flatMap((r) =>
      isRothIncomeLimited(r.accountType) && !isTaxFree(r.taxTreatment) && r.cap
        ? [r.cap.cappedAnnual]
        : [],
    ),
    (amount) => amount,
  );
}
