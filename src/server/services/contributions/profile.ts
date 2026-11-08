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

/**
 * Resolve a profile against live data, returning effective contribs + salaries.
 *
 * `liveJobSalaries` already reflects the globally active Salary Profile
 * (resolved once by the caller, e.g. loadLiveContribData).
 *
 * Generic over the row shapes so callers can hand in their own richer row
 * types (e.g. full contribution_accounts rows) and get them back unchanged
 * apart from the applied overrides.
 */
export function resolveProfile<
  C extends { id: number },
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
  const accountActiveFields = readContributionActiveFields(
    profile.contributionActiveFields,
    profile.id,
  ).contributionAccounts;

  // The merge applyContribActiveFields does: an account with no value in
  // this profile has none anywhere, so it is excluded.
  const activeContribs = liveContribs
    .map((c) => {
      const activeFields = accountActiveFields[String(c.id)];
      // An entry can legitimately exist for isActive/displayNameCustom/match
      // fields alone — contributionValue is the specific thing with no
      // fallback, so that's what determines whether this account resolves
      // to anything at all.
      if (!activeFields || activeFields.contributionValue === undefined)
        return null;
      return {
        ...c,
        ...entryWithMergedRate(c, activeFields),
        fromBonus: activeFields.fromBonus === true,
      } as C & {
        contributionValue: string | number;
        contributionMethod: string;
        isActive?: boolean;
        fromBonus: boolean;
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => c.isActive !== false);

  // Jobs carry no Contribution-Profile-owned fields any more — the deleted
  // `jobs` active-fields bucket used to let a profile patch employer name /
  // bonus pay date / bonus-contribution flags; the bonus date moved to the
  // Salary Profile entry, the flags became each account's own `fromBonus`
  // election, and employerName lost its profile-override path (see
  // RULES.md). Pay schedule comes straight from the resolved Salary
  // Profile entry, same axis as salary itself.
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

/**
 * Apply a contribution profile's active fields to raw DB contribution
 * account rows. Merges all active fields onto the row generically — both DB
 * columns and profile-only fields (e.g. displayNameCustom). The Zod
 * .strict() schema on the write path prevents invalid fields from entering.
 * Rows marked isActive=false are filtered out.
 *
 * accountActiveFields shape: { "accountId": { field: value, ... } }
 */
export type ContribRowWithActiveFields =
  typeof schema.contributionAccounts.$inferSelect & {
    contributionValue: string | number;
    contributionMethod: string;
    /** Also taken from bonus checks — always set once active fields apply. */
    fromBonus: boolean | undefined;
    /** A Roth IRA account's route — absent = direct. */
    rothRoute?: RothIraRoute;
    displayNameCustom?: string;
  };

export function applyContribActiveFields(
  rows: (
    typeof schema.contributionAccounts.$inferSelect | ContribRowWithActiveFields
  )[],
  accountActiveFields: Record<string, Record<string, unknown>>,
  /**
   * Callers layer this twice: once against a profile's active fields (raw
   * account rows in, nothing resolved yet — the default), then again against
   * the What-If sandbox's edits (already-resolved rows in, from the first
   * pass). Pass `true` for that second layer so a row with no entry at THIS
   * layer stays resolved with whatever the first layer gave it, instead of
   * being excluded for having no value at this specific layer. See
   * getIncompleteContribAccountIds for surfacing a missing value to the UI.
   */
  isOverlay = false,
): ContribRowWithActiveFields[] {
  return rows
    .map((row): ContribRowWithActiveFields | null => {
      const activeFields = accountActiveFields[String(row.id)];
      // The first layer needs a value (there's no base value to fall back
      // to); an overlay entry may change just another field (e.g. fromBonus)
      // of a row the first layer already resolved.
      if (!activeFields) {
        return isOverlay ? (row as ContribRowWithActiveFields) : null;
      }
      if (!isOverlay && activeFields.contributionValue === undefined)
        return null;
      return {
        ...row,
        ...entryWithMergedRate(row, activeFields),
        // An overlay layer that doesn't set it keeps the first layer's.
        fromBonus:
          (activeFields.fromBonus ??
            (row as Partial<ContribRowWithActiveFields>).fromBonus) === true,
      } as ContribRowWithActiveFields;
    })
    .filter((row): row is ContribRowWithActiveFields => row !== null)
    .filter((row) => row.isActive !== false);
}

/**
 * Build a synthetic (no DB row) contribution account for the What-If tab's
 * hand-added hypothetical accounts. Negative `id`s so they can never
 * collide with a real autoincrement id; every field this app's calculators
 * actually read is filled in with the same defaults
 * `contributionAccountInput` (settings/contribution-accounts.ts) would use for a
 * freshly-created real row — no employer match, default tax treatment for
 * the chosen account type. One copy for the paycheck and contribution
 * summaries and budget.ts. */
export function buildSandboxContribRow(
  addition: {
    personId: number;
    accountType: string;
    contributionMethod: string;
    contributionValue: string;
  },
  syntheticId: number,
): ContribRowWithActiveFields {
  const category = addition.accountType as AccountCategory;
  return {
    id: syntheticId,
    jobId: null,
    personId: addition.personId,
    accountType: addition.accountType,
    subType: null,
    label: null,
    parentCategory: getParentCategory(category),
    taxTreatment: getDefaultTaxTreatment(category) as TaxTreatment,
    contributionMethod: addition.contributionMethod as ContributionMethod,
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
 * Apply a contribution profile's deduction active fields to raw DB
 * deduction rows. `paycheck_deductions` carries no `amountPerPeriod` column
 * of its own (Stage B dropped it) — same no-base-value, exclude-if-absent
 * rule as applyContribActiveFields: a deduction with no active-field entry
 * under this profile has no resolvable amount and is excluded, not passed
 * through with a stale/zero value. See getIncompleteDeductionIds for
 * surfacing the gap to the UI.
 *
 * deductionActiveFields shape: { "deductionId": { amountPerPeriod: value } }
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
      // Unconditional merge, not pickEntityActiveFields's presence filter —
      // amountPerPeriod is no longer a real `paycheck_deductions` column
      // (Stage B dropped it), so a `field in deduction` check would always
      // be false and silently drop it. Same unconditional-spread pattern
      // applyContribActiveFields already uses for contributionValue/Method.
      return { ...deduction, ...activeFields } as DeductionRowWithActiveFields;
    })
    .filter((d): d is DeductionRowWithActiveFields => d !== null);
}

/**
 * Fetch a contribution profile by id; null when no id is given or the row is
 * gone. A profile with empty contributionActiveFields applies nothing.
 */
export async function fetchContributionProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.contributionProfiles.$inferSelect | null> {
  if (profileId == null) return null;
  const profiles = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, profileId));
  return profiles[0] ?? null;
}

/**
 * Load a contribution profile by ID and apply its active fields to raw DB
 * rows. Returns modified contribs (+ deductions, when `allDeductions` is
 * passed) plus jobs merged with their resolved Salary Profile fields (see
 * mergeSalaryProfileJobFields) — or the originals if no profile is
 * selected / the row is gone.
 *
 * `allDeductions` is optional and deliberately not threaded through
 * everywhere this function is called (budget.ts, build-engine-payload.ts
 * don't need deduction data) — only the paycheck summary passes it.
 * See the Contribution Profile plan's Ground Rules: widening this
 * function's deduction support is scoped to its actual consumer, not
 * `resolveProfile` generally.
 *
 * `salaryProfileActiveMap` is the caller's own resolved Salary Profile —
 * an independent axis from Contribution Profile, never re-derived here.
 * Every existing caller already loads this map for its own comp
 * resolution (resolveCompensation) before calling this function.
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
 * Synchronous variant of `loadAndApplyContribProfile` — applies a
 * pre-fetched profile row without issuing any DB queries.
 *
 * Used by `buildEnginePayload` when the profile row was already fetched
 * in the `fetchRetirementData` parallel batch.
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
    // No profile at all — nothing resolves (same "no fallback" rule as a
    // profile with empty active fields; there is no longer a live account
    // value to fall back to for accounts OR deductions).
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
