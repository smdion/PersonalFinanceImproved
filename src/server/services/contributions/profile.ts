import type {
  RothIraRoute,
  TaxTreatment,
  ContributionMethod,
} from "@/lib/config/enum-values";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import {
  type AccountCategory,
  getParentCategory,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import {
  type SalaryProfileActiveMap,
  mergeSalaryProfileJobFields,
} from "@/lib/pure/household/compensation";
import type { Db } from "@/lib/db";
import { entryWithMergedRate } from "@/lib/pure/contributions/employer-match";
import { readStoredMatchType } from "@/lib/db/stored-match-type";
import { activeProfileId } from "@/server/data/active-profile";

/**
 * Resolve a profile against live data (`liveJobSalaries` already reflects the active
 * Salary Profile); generic so callers get their own row types back with fields applied.
 */
export function resolveProfile<
  C extends typeof schema.contributionAccounts.$inferSelect,
  J extends { id: number; personId: number },
  S extends {
    job: { id: number; personId: number };
    /** Payroll contribution basis (base salary). */
    salary: number;
    /** Un-blended current salary, BEFORE any bonus. The base every bonus
     *  formula multiplies; `salary` above may already include a bonus, so
     *  computing off it would compound. */
    baseSalary: number;
    totalComp: number;
  },
>(
  profile: Pick<
    typeof schema.contributionProfiles.$inferSelect,
    "contributionActiveFields"
  > & { id?: number },
  liveContribs: C[],
  liveJobs: J[],
  liveJobSalaries: S[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
) {
  const activeContribs = applyContribActiveFields(
    liveContribs,
    readContributionActiveFields(profile.contributionActiveFields, profile.id)
      .contributionAccounts,
  );

  // Jobs carry no Contribution-Profile-owned fields; pay schedule comes from the resolved
  // Salary Profile entry, the same axis as salary.
  const patchedJobs = mergeSalaryProfileJobFields(
    liveJobs,
    salaryProfileActiveMap,
  );

  const activeJobs = patchedJobs.map((j) => ({
    id: j.id,
    personId: j.personId,
    payPeriod: j.payPeriod,
  }));

  const jobSalaries = liveJobSalaries.map((js) => ({
    ...js,
    salary: js.baseSalary,
    bonusGross: js.totalComp - js.baseSalary,
  }));
  const combinedSalary = jobSalaries.reduce((sum, js) => sum + js.salary, 0);

  return {
    activeContribs,
    activeJobs,
    jobSalaries,
    combinedSalary,
    patchedJobs,
  };
}

/** What a profile's active fields put on an account row (with profile-only
 *  fields like displayNameCustom). */
type ContributionActiveFields = {
  contributionValue: string | number;
  contributionMethod: ContributionMethod;
  /** The stored match type is outside the set: read as no match, and shown. */
  matchTypeUnrecognised?: true;
  /** Also taken from bonus checks — always set once active fields apply. */
  fromBonus: boolean | undefined;
  /** A Roth IRA account's route — absent = direct. */
  rothRoute?: RothIraRoute;
  displayNameCustom?: string;
};

export type ContribRowWithActiveFields =
  typeof schema.contributionAccounts.$inferSelect & ContributionActiveFields;

/** Account rows with a profile's active fields merged on; a row whose profile
 *  sets no value is left out, as is an `isActive=false` row. */
export function applyContribActiveFields<
  R extends typeof schema.contributionAccounts.$inferSelect,
>(
  rows: readonly (R | (R & ContributionActiveFields))[],
  accountActiveFields: Record<string, Record<string, unknown>>,
  /** `true` for the What-If layer over resolved rows: a row with no entry here keeps its value. */
  isOverlay = false,
): (R & ContributionActiveFields)[] {
  return rows
    .map((row): (R & ContributionActiveFields) | null => {
      const activeFields = accountActiveFields[String(row.id)];
      // The first layer needs a value (there's no base value to fall back
      // to); an overlay entry may change just another field (e.g. fromBonus)
      // of a row the first layer already resolved.
      if (!activeFields) {
        return isOverlay ? (row as R & ContributionActiveFields) : null;
      }
      if (!isOverlay && activeFields.contributionValue === undefined)
        return null;
      return {
        ...row,
        ...entryWithMergedRate(row, activeFields),
        ...readStoredMatchType(row, activeFields),
        // An overlay layer that doesn't set it keeps the first layer's.
        fromBonus:
          (activeFields.fromBonus ??
            (row as Partial<ContributionActiveFields>).fromBonus) === true,
      } as R & ContributionActiveFields;
    })
    .filter((row): row is R & ContributionActiveFields => row !== null)
    .filter((row) => row.isActive !== false);
}

/** A What-If hypothetical account (no DB row; negative `id`, never colliding), with
 *  the defaults `contributionAccountInput` uses for a new real row. */
export function buildSandboxContribRow(
  addition: {
    personId: number;
    accountType: AccountCategory;
    contributionMethod: ContributionMethod;
    contributionValue: string;
  },
  syntheticId: number,
): ContribRowWithActiveFields {
  const category = addition.accountType; // checked by zSandboxContribAdditions
  return {
    id: syntheticId,
    jobId: null,
    personId: addition.personId,
    accountType: addition.accountType,
    subType: null,
    label: null,
    parentCategory: getParentCategory(category),
    taxTreatment: getDefaultTaxTreatment(category) as TaxTreatment,
    contributionMethod: addition.contributionMethod,
    contributionValue: addition.contributionValue,
    employerMatchType: "none",
    employerMatchValue: null,
    employerMatchRate: null,
    employerMaxMatchPct: null,
    employerMatchTaxTreatment: "pre_tax",
    hsaCoverageType: null,
    autoMaximize: false,
    isActive: true,
    ownership: "individual",
    performanceAccountId: null,
    targetAnnual: null,
    allocationPriority: 0,
    notes: null,
    isPayrollDeducted: null,
    fromBonus: false,
    priorYearContribAmount: "0",
    priorYearContribYear: null,
  };
}

/** paycheck_deductions row with a resolved amountPerPeriod attached. */
type DeductionRowWithActiveFields =
  typeof schema.paycheckDeductions.$inferSelect & {
    amountPerPeriod: string | number;
  };

/**
 * Apply a profile's deduction active fields (`{ "deductionId": { amountPerPeriod } }`):
 * a deduction with no entry has no amount and is excluded, not passed through as zero.
 */
export function applyDeductionActiveFields(
  deductions: (typeof schema.paycheckDeductions.$inferSelect)[],
  deductionActiveFields: Record<string, Record<string, unknown>>,
): DeductionRowWithActiveFields[] {
  return deductions
    .map((deduction): DeductionRowWithActiveFields | null => {
      const activeFields = deductionActiveFields[String(deduction.id)];
      if (!activeFields || activeFields.amountPerPeriod === undefined)
        return null;
      // Unconditional spread: amountPerPeriod isn't a `paycheck_deductions` column, so
      // pickEntityActiveFields's `field in deduction` filter would drop it.
      return { ...deduction, ...activeFields } as DeductionRowWithActiveFields;
    })
    .filter((d): d is DeductionRowWithActiveFields => d !== null);
}

/** The Contribution Profile a request runs on: the id given, else the active one; null only when
 *  none is active or the id is gone. Empty contributionActiveFields apply nothing. */
export async function fetchContributionProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.contributionProfiles.$inferSelect | null> {
  const id = profileId ?? (await activeProfileId(db, "contribution"));
  if (id === null) return null;
  const profiles = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, id));
  return profiles[0] ?? null;
}

/**
 * Load a profile by ID and apply its active fields: contribs (+ deductions when
 * `allDeductions` is passed) and jobs merged with the caller's `salaryProfileActiveMap`.
 * With none active (or the row gone) no contribution resolves.
 */
export async function loadAndApplyContribProfile(
  db: Db,
  profileId: number | undefined | null,
  allContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  allJobs: (typeof schema.jobs.$inferSelect)[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  allDeductions?: (typeof schema.paycheckDeductions.$inferSelect)[],
): Promise<{
  contribs: ContribRowWithActiveFields[];
  jobs: ReturnType<
    typeof mergeSalaryProfileJobFields<(typeof allJobs)[number]>
  >;
  deductions: DeductionRowWithActiveFields[];
  contribActiveFields: Record<string, Record<string, unknown>>;
}> {
  const profile = await fetchContributionProfile(db, profileId);
  return applyContribProfileRow(
    profile,
    allContribs,
    allJobs,
    salaryProfileActiveMap,
    allDeductions,
  );
}

/**
 * Synchronous `loadAndApplyContribProfile` for an already-fetched profile row (no DB).
 */
export function applyContribProfileRow(
  profile: typeof schema.contributionProfiles.$inferSelect | null | undefined,
  allContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  allJobs: (typeof schema.jobs.$inferSelect)[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  allDeductions?: (typeof schema.paycheckDeductions.$inferSelect)[],
): {
  contribs: ContribRowWithActiveFields[];
  jobs: ReturnType<
    typeof mergeSalaryProfileJobFields<(typeof allJobs)[number]>
  >;
  deductions: DeductionRowWithActiveFields[];
  contribActiveFields: Record<string, Record<string, unknown>>;
} {
  const jobs = mergeSalaryProfileJobFields(allJobs, salaryProfileActiveMap);
  if (!profile) {
    // No profile at all: nothing resolves (same "no fallback" rule as a
    // profile with empty active fields; accounts and deductions have no live value).
    return {
      contribs: applyContribActiveFields(allContribs, {}),
      jobs,
      deductions: [],
      contribActiveFields: {},
    };
  }
  const activeFieldsRoot = readContributionActiveFields(
    profile.contributionActiveFields,
    profile.id,
  );
  const contribActiveFields = activeFieldsRoot.contributionAccounts;
  const contribs = applyContribActiveFields(allContribs, contribActiveFields);
  const deductions = allDeductions
    ? applyDeductionActiveFields(allDeductions, activeFieldsRoot.deductions)
    : [];
  return { contribs, jobs, deductions, contribActiveFields };
}
