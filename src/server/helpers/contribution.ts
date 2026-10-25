/**
 * Contribution computation, aggregation, and profile resolution helpers.
 */
import type { RothIraRoute } from "@/lib/config/enum-values";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { EntityFieldMap } from "@/lib/db/schema";
import { roundToCents, safeDivide, sumBy } from "@/lib/utils/math";
import { isRetirementMoney, isTaxFree } from "@/lib/config/account-types";
import type {
  ContributionAccountInput,
  ContributionSpec,
  AccountCategory,
  RetirementContribSlice,
} from "@/lib/calculators/types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import {
  buildCategoryRecord,
  categoriesWithTaxPreference,
  getAllCategories,
  getDisplayGroup,
  getParentCategory,
  getDefaultTaxTreatment,
  isPayrollFicaExemptCategory,
} from "@/lib/config/account-types";
import type {
  TaxTreatment,
  ContributionMethod,
} from "@/lib/config/enum-values";
import { computeValue, type CapPassed } from "@/lib/pure/contribution-caps";
import type { ContribSaveChecker } from "./contribution-caps";
import { toNumber, getPeriodsPerYear } from "./transforms";
import type { Db, DbOrTx } from "./transforms";
import {
  filterActiveJobs,
  resolveContribFieldDisplayState,
  type ContribResolutionStatus,
} from "@/lib/pure/profiles";
import {
  bonusCheckContribution,
  isPaidThroughPayroll,
} from "@/lib/calculators/paycheck";
import { payrollFicaExemptCap } from "@/lib/pure/contributions";
import {
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
  loadEffectiveSalaryProfile,
  mergeSalaryProfileJobFields,
} from "./salary";
import type { SalaryProfileActiveMap } from "./salary";
import {
  computeGroupedEmployerMatch,
  matchGroupKey,
  matchPayGroupsWithBonus,
} from "./contribution-match";

// Employer match lives in contribution-match.ts; re-exported so callers
// keep importing contribution helpers from one place.
export {
  computeEmployerMatch,
  computeGroupedEmployerMatch,
  matchGroupKey,
  matchPayGroupsWithBonus,
  type GroupableMatchRow,
  type GroupedMatchResult,
} from "./contribution-match";

/**
 * Compute annual contribution amount from DB contribution row fields.
 * Eliminates the duplicated if/else chain for contribution methods.
 */
export function computeAnnualContribution(
  method: string,
  value: number,
  salary: number,
  periodsPerYear: number,
): number {
  switch (method) {
    case "percent_of_salary":
      return salary * (value / 100);
    case "fixed_per_period":
      return value * periodsPerYear;
    case "fixed_monthly":
      return value * 12;
    default: // fixed_annual
      return value;
  }
}

/**
 * Fallback periods-per-year for a jobless contribution account: the first
 * active job's pay period, or `incomplete: true` if there are none (no job
 * anywhere to resolve a schedule from — `periodsPerYear` is a meaningless
 * placeholder in that case, not a real value; callers must not use it for a
 * `fixed_per_period` account without also honoring `incomplete`). Shared by
 * computeActiveSummary's forward computation and
 * applyContributionAccountEdit's inverse so the two can't drift apart.
 */
export function resolveJoblessPeriodsPerYear(
  activeJobs: { payPeriod: string | undefined }[],
): { periodsPerYear: number; incomplete: boolean } {
  const withSchedule = activeJobs.find((j) => j.payPeriod != null);
  return withSchedule
    ? {
        periodsPerYear: getPeriodsPerYear(withSchedule.payPeriod!),
        incomplete: false,
      }
    : { periodsPerYear: 0, incomplete: true };
}

/**
 * Resolve the periods-per-year for a single contribution row's method,
 * and whether that resolution is incomplete. Only `fixed_per_period`
 * actually consumes `periodsPerYear` (see computeAnnualContribution) — for
 * every other method this always resolves complete with an unused `0`,
 * so a missing/unresolvable job never marks a `percent_of_salary` or
 * `fixed_monthly` account incomplete (see the plan's method-gated
 * treatment). `job` is the row's own resolved job (by jobId, or by
 * personId for a jobless account) — `undefined` means no job could be
 * resolved for this row at all.
 */
export function resolveContribPeriods(
  method: string,
  job: { payPeriod: string | undefined } | undefined,
): { periodsPerYear: number; incomplete: boolean } {
  if (method !== "fixed_per_period")
    return { periodsPerYear: 0, incomplete: false };
  if (!job || job.payPeriod == null)
    return { periodsPerYear: 0, incomplete: true };
  return {
    periodsPerYear: getPeriodsPerYear(job.payPeriod),
    incomplete: false,
  };
}

/**
 * Inverse of computeAnnualContribution for the flat-dollar methods a
 * budget-linked contribution account can use (linking is restricted to
 * jobId === null, so percent_of_salary — which needs a salary — never
 * applies here; reject it loudly rather than silently writing $0).
 */
export function computeContributionValueFromMonthly(
  method: string,
  monthlyAmount: number,
  periodsPerYear: number,
): number {
  switch (method) {
    case "fixed_monthly":
      return monthlyAmount;
    case "fixed_per_period":
      return (monthlyAmount * 12) / periodsPerYear;
    case "fixed_annual":
      return monthlyAmount * 12;
    default:
      throw new Error(
        `Cannot edit a "${method}" contribution account from a flat monthly amount`,
      );
  }
}

/**
 * Resolves the shared periods-per-year input `mergeContributionAccountEdit`
 * needs, independent of which profile/account is being edited — split out
 * so a batch of edits (see `applyContributionAccountEditsBatch`) resolves
 * it once instead of once per profile.
 */
async function resolveActiveJobPeriodsPerYear(
  db: DbOrTx,
): Promise<{ periodsPerYear: number; incomplete: boolean }> {
  const rawActiveJobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(isNull(schema.jobs.endDate), eq(schema.jobs.isSpeculative, false)),
    );
  // Salary Profile is an independent axis from Contribution Profile — a
  // job's pay schedule is never Contribution-Profile-owned, so this always
  // resolves against whichever Salary Profile is globally active, same as
  // loadLiveContribData's own "no specific preference" resolution.
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    rawActiveJobs,
    salaryProfileActiveMap,
  );
  return resolveJoblessPeriodsPerYear(activeJobs);
}

/**
 * Pure merge step of a contribution-account edit: given a profile's CURRENT
 * `contributionActiveFields` blob and one edit, returns the next blob, or
 * `null` if nothing should change (rounds to the same value already
 * stored, or the account's method needs a pay schedule no active job can
 * supply). No DB access — split out so a batch of edits against the SAME
 * profile can fold through one in-memory snapshot instead of one
 * SELECT+UPDATE round trip per edit (see `applyContributionAccountEditsBatch`).
 */
function mergeContributionAccountEdit(
  activeFields: EntityFieldMap,
  contributionAccountId: number,
  monthlyAmount: number,
  periodsPerYear: number,
  incomplete: boolean,
): EntityFieldMap | null {
  const accountFields = (activeFields.contributionAccounts?.[
    String(contributionAccountId)
  ] ?? {}) as Record<string, unknown>;

  // No account-level method to fall back to — a not-yet-valued account
  // defaults to fixed_monthly, the exact unit this edit is already in.
  const method =
    (accountFields.contributionMethod as string) ?? "fixed_monthly";

  // No active job anywhere to resolve a pay schedule from. This is a
  // budget-linked (jobId === null) account whose method needs periodsPerYear
  // — nothing sane to write, and this path isn't a user-facing save action
  // that can reject with an error (see the plan's jobless-account
  // treatment), so leave the value as-is rather than writing a fabricated
  // number.
  if (incomplete && method === "fixed_per_period") return null;

  const newValue = roundToCents(
    computeContributionValueFromMonthly(method, monthlyAmount, periodsPerYear),
  );

  const currentValue = accountFields.contributionValue;
  if (
    currentValue != null &&
    Math.abs(newValue - Number(currentValue)) < 0.005
  ) {
    return null;
  }

  return {
    ...activeFields,
    contributionAccounts: {
      ...activeFields.contributionAccounts,
      [String(contributionAccountId)]: {
        ...accountFields,
        contributionValue: String(newValue),
        contributionMethod: method,
      },
    },
  };
}

/**
 * Write-through for editing a budget-linked contribution account's value
 * from a monthly dollar amount (what the Budget page displays/edits).
 * Converts into the account's native unit and skips the write if the
 * profile's already at that value (avoids float/rounding drift on
 * fixed_annual / fixed_per_period round-trips).
 *
 * Writes into `contributionProfileId`'s active fields — accounts carry no
 * value of their own (see applyContribActiveFields), so the caller must
 * have already resolved which profile this edit belongs to (same
 * Plan-pin → column-pin → local-selection → global-default precedence the
 * rest of the page uses; see resolveEffectiveContribProfileIdForItem in
 * routers/budget.ts).
 *
 * Callers editing more than one account should use
 * `applyContributionAccountEditsBatch` instead of looping this — it folds
 * every edit for the same profile through a single read-merge-write.
 */
export async function applyContributionAccountEdit(
  db: DbOrTx,
  contributionAccountId: number,
  monthlyAmount: number,
  contributionProfileId: number,
  /** The IRS-limit save check (assertWithinIrsLimits) — required, so no
   *  budget edit can save a contribution over its limit. */
  check: ContribSaveChecker,
): Promise<void> {
  const { periodsPerYear, incomplete } =
    await resolveActiveJobPeriodsPerYear(db);

  const [profile] = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
  if (!profile) return; // stale FK — nothing to update

  const activeFields = (profile.contributionActiveFields ??
    {}) as EntityFieldMap;
  const nextActiveFields = mergeContributionAccountEdit(
    activeFields,
    contributionAccountId,
    monthlyAmount,
    periodsPerYear,
    incomplete,
  );
  if (nextActiveFields === null) return;
  await check(db as Db, {
    profileId: contributionProfileId,
    before: activeFields.contributionAccounts ?? {},
    after: nextActiveFields.contributionAccounts ?? {},
    touched: [contributionAccountId],
  });

  await db
    .update(schema.contributionProfiles)
    .set({ contributionActiveFields: nextActiveFields })
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
}

/**
 * Batch form of `applyContributionAccountEdit` — one SELECT + one UPDATE
 * per DISTINCT profile touched, no matter how many accounts in `edits`
 * belong to it, instead of one round trip per account.
 *
 * Why this exists: a multi-cell paste that lands several edits on
 * accounts in the SAME contribution profile previously ran
 * `applyContributionAccountEdit` once per account — N sequential
 * read-merge-write cycles against that one profile row inside the paste's
 * surrounding transaction. Two concurrent writers to the same profile can
 * always lose an update in a plain read-then-write (this app has no
 * optimistic-concurrency check on the row), but N round trips instead of
 * one needlessly repeats the read side of that window N times over the
 * transaction's lifetime for no benefit — folding them into a single
 * read + write removes the repetition. `db` should be a transaction when
 * the caller is also writing other rows in the same request (matches
 * `applyContributionAccountEdit`'s own contract).
 */
export async function applyContributionAccountEditsBatch(
  db: DbOrTx,
  edits: {
    contributionAccountId: number;
    monthlyAmount: number;
    contributionProfileId: number;
  }[],
  /** The IRS-limit save check (assertWithinIrsLimits) — required. */
  check: ContribSaveChecker,
): Promise<void> {
  if (edits.length === 0) return;

  const { periodsPerYear, incomplete } =
    await resolveActiveJobPeriodsPerYear(db);

  const byProfile = new Map<number, typeof edits>();
  for (const edit of edits) {
    const list = byProfile.get(edit.contributionProfileId) ?? [];
    list.push(edit);
    byProfile.set(edit.contributionProfileId, list);
  }

  for (const [contributionProfileId, profileEdits] of byProfile) {
    const [profile] = await db
      .select()
      .from(schema.contributionProfiles)
      .where(eq(schema.contributionProfiles.id, contributionProfileId));
    if (!profile) continue; // stale FK — nothing to update

    const original = (profile.contributionActiveFields ?? {}) as EntityFieldMap;
    let activeFields = original;
    let changed = false;
    for (const edit of profileEdits) {
      const next = mergeContributionAccountEdit(
        activeFields,
        edit.contributionAccountId,
        edit.monthlyAmount,
        periodsPerYear,
        incomplete,
      );
      if (next !== null) {
        activeFields = next;
        changed = true;
      }
    }
    if (!changed) continue;
    await check(db as Db, {
      profileId: contributionProfileId,
      before: original.contributionAccounts ?? {},
      after: activeFields.contributionAccounts ?? {},
      touched: profileEdits.map((e) => e.contributionAccountId),
    });

    await db
      .update(schema.contributionProfiles)
      .set({ contributionActiveFields: activeFields })
      .where(eq(schema.contributionProfiles.id, contributionProfileId));
  }
}

/**
 * Build ContributionAccountInput[] from DB rows for a given job + person.
 * Handles percent_of_salary (stored as whole number, e.g. 14 = 14%),
 * fixed_per_period, and fixed_annual methods. Employer match cap
 * (employerMaxMatchPct) is stored as a fraction (e.g. 0.06 = 6%); the
 * match rate (employerMatchValue) is a whole-number percent.
 *
 * Employer match is computed via computeGroupedEmployerMatch so a Roth +
 * Traditional split of the same physical account gets capped against
 * their combined contribution — see that function's docblock.
 */
export function buildContribAccounts(
  jobContribs: (ContribRowWithActiveFields & CapPassed)[],
  personalContribs: (ContribRowWithActiveFields & CapPassed)[],
  salary: number,
  periodsPerYear: number,
  /** The year's limits and the person's age at Dec 31 — sizes each
   *  account's FICA-exempt cap (payrollFicaExemptCap). Required so no
   *  caller can quietly treat exempt payroll money as FICA wages. */
  ficaContext: { limits: Record<string, number>; ageAtYearEnd: number | null },
  /** The job's bonus (contributionPay). Each account takes its share only
   *  when set to (fromBonus); its match counts it the same way
   *  (matchPayGroupsWithBonus). */
  bonusGross = 0,
): ContributionAccountInput[] {
  const allContribs = [...jobContribs, ...personalContribs];
  const bonusGroups = matchPayGroupsWithBonus(allContribs);
  const matchPay = (c: (typeof allContribs)[number]) =>
    salary + (bonusGroups.has(matchGroupKey(c)) ? bonusGross : 0);

  const annualById = new Map<number, number>();
  for (const c of allContribs) {
    const contribValue = computeValue(c);
    annualById.set(
      c.id,
      computeAnnualContribution(
        c.contributionMethod,
        contribValue,
        salary,
        periodsPerYear,
      ),
    );
  }

  const matchByRow = computeGroupedEmployerMatch(
    allContribs.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualContributionWithBonus(
        c,
        { salary, bonusGross },
        periodsPerYear,
      ),
      salary: matchPay(c),
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: c.employerMatchTaxTreatment,
    })),
  );

  // The same match on regular paychecks alone — the difference is what the
  // bonus check's deferral earns (Year-End estimates place it by date).
  const baseMatchByRow =
    bonusGroups.size > 0 && bonusGross > 0
      ? computeGroupedEmployerMatch(
          allContribs.map((c) => ({
            id: c.id,
            jobId: c.jobId,
            personId: c.personId,
            accountType: c.accountType,
            parentCategory: c.parentCategory,
            annual: annualById.get(c.id)!,
            salary,
            employerMatchType: c.employerMatchType,
            employerMatchValue: toNumber(c.employerMatchValue),
            employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
            employerMatchTaxTreatment: c.employerMatchTaxTreatment,
          })),
        )
      : matchByRow;

  const accounts = allContribs.map((c) => {
    const contribValue = computeValue(c);
    const annual = annualById.get(c.id)!;
    const perPeriod =
      c.contributionMethod === "fixed_per_period"
        ? contribValue
        : annual / periodsPerYear;

    const match = matchByRow.get(c.id)!;

    // Group from config displayGroup
    const group = getDisplayGroup(c.accountType as AccountCategory);
    const isPayrollDeducted = isPaidThroughPayroll(c);

    return {
      id: c.id,
      name: c.subType || c.label || c.accountType,
      annualContribution: roundToCents(annual),
      perPeriodContribution: roundToCents(perPeriod),
      rateOfGross:
        c.contributionMethod === "percent_of_salary"
          ? contribValue / 100
          : null,
      taxTreatment: c.taxTreatment,
      isPayrollDeducted,
      fromBonus: c.fromBonus === true,
      group,
      employerMatch: roundToCents(match.matchAnnual),
      employerMatchOnBonus: roundToCents(
        match.matchAnnual - baseMatchByRow.get(c.id)!.matchAnnual,
      ),
      employerMatchAvailable: roundToCents(match.matchAvailableAnnual),
      employerMatchTaxTreatment: match.employerMatchTaxTreatment,
      // A capped row's payroll money is already within the IRS limit less
      // employer money, so all of it is exempt (one split: the cap pass).
      ficaExemptAnnualCap: !isPayrollDeducted
        ? null
        : c.cap && isPayrollFicaExemptCategory(c.accountType)
          ? c.cap.cappedAnnual
          : payrollFicaExemptCap(
              c.accountType,
              ficaContext.ageAtYearEnd,
              c.hsaCoverageType ?? null,
              ficaContext.limits,
              match.matchAnnual,
            ),
    };
  });
  return accounts;
}

// ---------------------------------------------------------------------------
// Contribution aggregation by waterfall category
// ---------------------------------------------------------------------------

/** Per-category contribution totals with tax breakdown. */
export type ContribCategorySummary = {
  annual: number;
  rothFraction: number;
  rothAnnual: number;
  tradAnnual: number;
};

/** Minimal fields needed from the DB contribution_accounts row. */
export type ContribRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string;
  contributionMethod: string;
  contributionValue: string | number;
  taxTreatment: string;
  employerMatchType: string | null;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
  /** Set by the IRS-limit cap pass; calculations read computeValue(c). */
  cappedValue?: number;
};

type PersonRef = { id: number; name: string };
export type JobRef = {
  id: number;
  personId: number;
  payPeriod: string | undefined;
};
/** A job's contributionPay (server/helpers/salary.ts): base salary and the bonus. */
export type JobSalaryRef = {
  job: { id: number; personId: number };
  salary: number;
  bonusGross?: number;
  /** This year's bonus (the pinned one when set) — this year's lines only. */
  bonusGrossThisYear?: number;
};

/**
 * The job whose pay a contribution is figured on: its own job, or — for an
 * account not tied to one — the person's job. One lookup for the summary,
 * the display specs and the engine specs.
 */
function jobPayFor<T extends { job: { id: number; personId: number } }>(
  c: { jobId: number | null; personId: number | null },
  jobSalaries: readonly T[],
): T | undefined {
  return c.jobId
    ? jobSalaries.find((x) => x.job.id === c.jobId)
    : jobSalaries.find((x) => x.job.personId === c.personId);
}

/**
 * A contribution's yearly amount, the paycheck's way: what the regular
 * paychecks take from the base salary, plus what the bonus check takes
 * (bonusCheckContribution — percent-of-pay at its rate of the bonus, a fixed
 * amount once more; only for payroll accounts set to be taken from bonus
 * checks). The one
 * yearly amount the contribution summary and the retirement projection
 * use. (The budget follows regular paychecks only — base salary.) This
 * year's figures pass the pinned bonus as `bonusGross`; the projection
 * passes the formula bonus (contributionPay).
 */
export function annualContributionWithBonus(
  c: {
    contributionMethod: string | null;
    contributionValue: string | number | null;
    jobId: number | null;
    isPayrollDeducted?: boolean | null;
    fromBonus: boolean | undefined;
    cappedValue?: number;
  },
  pay: { salary: number; bonusGross?: number },
  periodsPerYear: number,
): number {
  const method = c.contributionMethod ?? "percent_of_salary";
  const value = computeValue(c);
  const regular = computeAnnualContribution(
    method,
    value,
    pay.salary,
    periodsPerYear,
  );
  return (
    regular +
    bonusCheckContribution(
      {
        isPayrollDeducted: isPaidThroughPayroll(c),
        fromBonus: c.fromBonus,
        rateOfGross: method === "percent_of_salary" ? value / 100 : null,
        perPeriodContribution:
          method === "fixed_per_period" ? value : regular / periodsPerYear,
      },
      pay.bonusGross ?? 0,
    )
  );
}

/**
 * Each contribution row's yearly employee money (from computeValue — the
 * capped value when set), the pay its match is figured on, and the rows
 * whose pay period can't be resolved (yearly money 0). One computation for
 * the category aggregate and the cap pass.
 */
export function contribRowAmounts(
  activeContribs: readonly ContribRow[],
  activeJobs: readonly JobRef[],
  jobSalaries: readonly JobSalaryRef[],
): {
  annualById: Map<number, number>;
  salaryById: Map<number, number>;
  incompleteAccountIds: number[];
} {
  const incompleteAccountIds: number[] = [];
  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  const bonusGroups = matchPayGroupsWithBonus([...activeContribs]);
  for (const c of activeContribs) {
    // Direct job link, or fall back to person's first active job when jobId is null
    const js = jobPayFor(c, jobSalaries);
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
      c.contributionMethod,
      job,
    );
    if (incomplete) incompleteAccountIds.push(c.id);
    const annual = incomplete
      ? 0
      : annualContributionWithBonus(
          c,
          { salary, bonusGross: js?.bonusGross },
          periods,
        );
    // Match on the pay the deferrals came from, bonus checks included.
    salaryById.set(
      c.id,
      salary + (bonusGroups.has(matchGroupKey(c)) ? (js?.bonusGross ?? 0) : 0),
    );
    annualById.set(c.id, annual);
  }
  return { annualById, salaryById, incompleteAccountIds };
}

/**
 * Aggregate contributions and employer match by waterfall category in a single pass.
 * Replaces the duplicate loops in the retirement router that separately compute
 * `employerMatchByCategory` and `contribByCategory`.
 *
 * Returns both the per-category employee contribution summary and the per-category
 * employer match totals. Used by the retirement engine and available to any consumer.
 */
export function aggregateContributionsByCategory(
  activeContribs: (ContribRow & CapPassed)[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): {
  contribByCategory: Record<AccountCategory, ContribCategorySummary>;
  employerMatchByCategory: Record<AccountCategory, number>;
  /** Employer money per contribution row id. */
  employerMatchById: Map<number, number>;
  /** Employer match broken down by category → parentCategory → amount. */
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  /** The same totals over retirement money only (`isRetirementMoney`):
   *  what Simple tax mode simulates. */
  retirementOnly: {
    contribByCategory: Record<AccountCategory, ContribCategorySummary>;
    employerMatchByCategory: Record<AccountCategory, number>;
  };
  /** Ids of `fixed_per_period` accounts with no resolvable job/pay period —
   *  excluded from the totals above (annual treated as 0) rather than
   *  defaulted to a guessed pay period. See resolveContribPeriods. */
  incompleteAccountIds: number[];
} {
  const emptySummaries = () =>
    buildCategoryRecord((): ContribCategorySummary => ({
      annual: 0,
      rothFraction: 0,
      rothAnnual: 0,
      tradAnnual: 0,
    }));
  const contribByCategory = emptySummaries();
  const retirementContribByCategory = emptySummaries();
  const employerMatchByCategory = buildCategoryRecord(() => 0);
  const retirementMatchByCategory = buildCategoryRecord(() => 0);
  const employerMatchByParentCat = new Map<
    AccountCategory,
    Map<string, number>
  >();

  const { annualById, salaryById, incompleteAccountIds } = contribRowAmounts(
    activeContribs,
    activeJobs,
    jobSalaries,
  );
  for (const c of activeContribs) {
    const annual = annualById.get(c.id)!;
    for (const summaries of isRetirementMoney(c.parentCategory)
      ? [contribByCategory, retirementContribByCategory]
      : [contribByCategory]) {
      summaries[c.accountType].annual += annual;
      if (isTaxFree(c.taxTreatment)) {
        summaries[c.accountType].rothAnnual += annual;
      } else {
        summaries[c.accountType].tradAnnual += annual;
      }
    }
  }

  const matchByRow = computeGroupedEmployerMatch(
    activeContribs.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualById.get(c.id)!,
      salary: salaryById.get(c.id)!,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: "pre_tax", // not used by this aggregation
    })),
  );

  for (const c of activeContribs) {
    const cat = c.accountType;
    const matchAmount = matchByRow.get(c.id)!.matchAnnual;
    employerMatchByCategory[cat] += matchAmount;
    if (isRetirementMoney(c.parentCategory))
      retirementMatchByCategory[cat] += matchAmount;

    // Track match by parentCategory for correct per-account distribution
    if (matchAmount > 0 && c.parentCategory) {
      if (!employerMatchByParentCat.has(cat))
        employerMatchByParentCat.set(cat, new Map());
      const catMap = employerMatchByParentCat.get(cat)!;
      catMap.set(
        c.parentCategory,
        (catMap.get(c.parentCategory) ?? 0) + matchAmount,
      );
    }
  }

  // Compute Roth fractions from actual account data
  for (const summaries of [contribByCategory, retirementContribByCategory])
    for (const cat of categoriesWithTaxPreference()) {
      const total = summaries[cat].rothAnnual + summaries[cat].tradAnnual;
      summaries[cat].rothFraction = safeDivide(
        summaries[cat].rothAnnual,
        total,
        1,
      );
    }

  return {
    contribByCategory,
    employerMatchByCategory,
    employerMatchById: new Map(
      [...matchByRow].map(([id, m]) => [id, m.matchAnnual]),
    ),
    employerMatchByParentCat,
    retirementOnly: {
      contribByCategory: retirementContribByCategory,
      employerMatchByCategory: retirementMatchByCategory,
    },
    incompleteAccountIds,
  };
}

// ---------------------------------------------------------------------------
// Per-record contribution spec builder with match redistribution
// ---------------------------------------------------------------------------

/** Output of buildContributionDisplaySpecs — per-record spec with match. */
export type ContribDisplaySpec = {
  /** Source contribution_accounts.id — the only reliable way to look this
   *  spec's row back up when personId/ownerName can't disambiguate (e.g.
   *  multiple joint contributions in the same category, where both are
   *  personId: null and ownerName: null). */
  id: number;
  category: AccountCategory;
  name: string;
  method: string;
  value: number;
  baseAnnual: number;
  taxTreatment: string;
  ownerName: string | null;
  personId: number | null;
  matchAnnual: number;
  /** True for a `fixed_per_period` account with no resolvable job/pay
   *  period — baseAnnual is 0 (excluded), not a guessed pay period. */
  incomplete: boolean;
};

/**
 * Build per-record contribution display specs from DB rows.
 * Each record gets its own matchAnnual computed individually.
 * Then, within each (person, category) group, total match is redistributed
 * proportionally by contribution amount. This ensures Roth+Traditional 401k
 * for the same person each show their fair share of the employer match.
 *
 * This is the single source of truth for "how do we display per-spec match?"
 * Used by the retirement engine card and available to any other consumer.
 */
export function buildContributionDisplaySpecs(
  activeContribs: (ContribRow & CapPassed)[],
  people: PersonRef[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): ContribDisplaySpec[] {
  const filtered = activeContribs.filter(
    (c) => Number(c.contributionValue) > 0,
  );

  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  const incompleteById = new Map<number, boolean>();
  const bonusGroups = matchPayGroupsWithBonus(filtered);
  for (const c of filtered) {
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const js = jobPayFor(c, jobSalaries);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
      c.contributionMethod,
      job,
    );
    const cv = computeValue(c);
    salaryById.set(
      c.id,
      salary +
        (bonusGroups.has(matchGroupKey(c))
          ? (js?.bonusGrossThisYear ?? js?.bonusGross ?? 0)
          : 0),
    );
    incompleteById.set(c.id, incomplete);
    annualById.set(
      c.id,
      incomplete
        ? 0
        : roundToCents(
            annualContributionWithBonus(
              { ...c, contributionValue: cv },
              // This year's contribution lines: the pinned bonus when set.
              {
                salary,
                bonusGross: js?.bonusGrossThisYear ?? js?.bonusGross,
              },
              periods,
            ),
          ),
    );
  }

  // computeGroupedEmployerMatch already does the correct proportional
  // redistribution within each account's group (see its docblock) — no
  // separate redistribution pass needed here any more.
  const matchByRow = computeGroupedEmployerMatch(
    filtered.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualById.get(c.id)!,
      salary: salaryById.get(c.id)!,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: "pre_tax", // not used by ContribDisplaySpec
    })),
  );

  return filtered.map((c) => {
    const ownerPerson = people.find((p) => p.id === c.personId);
    const cv = computeValue(c);
    const method = c.contributionMethod ?? "percent_of_salary";
    const value = method === "percent_of_salary" ? cv / 100 : cv;

    return {
      id: c.id,
      category: c.accountType,
      name: c.subType ?? c.accountType,
      method,
      value,
      baseAnnual: annualById.get(c.id)!,
      taxTreatment: c.taxTreatment,
      ownerName: ownerPerson?.name ?? null,
      personId: c.personId,
      matchAnnual: roundToCents(matchByRow.get(c.id)!.matchAnnual),
      incomplete: incompleteById.get(c.id) ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Contribution profile resolution
// ---------------------------------------------------------------------------

/**
 * Row shape returned by loadLiveContribData for aggregation. No
 * contributionMethod/contributionValue here — those are never carried by
 * the account row itself (see applyContribActiveFields); resolveProfile
 * adds them from a specific profile's active fields, and only for accounts
 * that have an entry there.
 */
export type LiveContribRow = {
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string;
  taxTreatment: string;
  employerMatchType: string | null;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  id: number;
};

/** LiveContribRow with a specific profile's active fields resolved onto
 *  it — guaranteed to carry contributionValue/contributionMethod, since
 *  rows with no active entry are excluded (see resolveProfile). */
export type ResolvedContribRow = LiveContribRow & {
  contributionValue: string | number;
  contributionMethod: string;
  fromBonus: boolean | undefined;
};

/**
 * Load all live contribution data needed for profile resolution.
 * Intentionally live/unmodified — this is the baseline every named
 * Contribution Profile's active fields get layered ON TOP OF (see
 * resolveProfile's callers), so it can't itself reflect a Plan's active
 * salary without corrupting that layering. See applyActiveSalary's docblock
 * (./salary.ts) for the live-vs-active rule.
 *
 * A job has no salary/bonus of its own — the globally-ACTIVE Salary
 * Profile is the only live source (see resolveCompensation's docblock).
 * Resolving against it here (rather than "no profile at all") is what lets
 * a Contribution Profile's percent-of-salary math have a real number to
 * work from; Contribution and Salary Profiles remain independent axes —
 * this always uses whichever Salary Profile is globally active, never a
 * specific one a caller picked.
 */
export async function loadLiveContribData(db: Db) {
  const [allJobs, allContribs, allPeople, allPerfAccounts] = await Promise.all([
    db.select().from(schema.jobs),
    db.select().from(schema.contributionAccounts),
    db.select().from(schema.people),
    db.select().from(schema.performanceAccounts),
  ]);
  const activeJobsRaw = filterActiveJobs(allJobs);
  const activeContribs = allContribs.filter((c) => c.isActive);
  const perfAccountMap = new Map(allPerfAccounts.map((pa) => [pa.id, pa]));

  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    activeJobsRaw,
    salaryProfileActiveMap,
  );

  const jobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: { id: j.id },
      ...contributionPay(comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
      personId: j.personId,
    };
  });

  const peopleMap = new Map(allPeople.map((p) => [p.id, p]));

  // Build ContribRow-compatible rows for aggregation (active only for live resolution)
  const contribs: LiveContribRow[] = activeContribs.map((c) => ({
    personId: c.personId,
    jobId: c.jobId,
    accountType: c.accountType as AccountCategory,
    subType: c.subType,
    label: c.label,
    parentCategory:
      c.parentCategory ?? getParentCategory(c.accountType as AccountCategory),
    taxTreatment: c.taxTreatment,
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue,
    employerMaxMatchPct: c.employerMaxMatchPct,
    id: c.id,
  }));

  return {
    contribs,
    jobs: activeJobs,
    jobSalaries: jobSalaries.map((js) => ({
      job: { id: js.job.id, personId: js.personId },
      salary: js.salary,
      bonusGross: js.bonusGross,
      baseSalary: js.baseSalary,
      totalComp: js.totalComp,
    })),
    rawContribRows: allContribs, // All accounts (active + inactive/stubbed) for profile editor
    peopleMap,
    perfAccountMap,
    salaryProfileActiveMap,
  };
}

/**
 * Resolve a profile against live data, returning effective contribs + salaries.
 *
 * `liveJobSalaries` already reflects whichever Salary Profile is globally
 * active (resolved once by the caller, e.g. loadLiveContribData) —
 * contribution profiles no longer carry salary and there is nothing left
 * to layer on top of it here.
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
  >,
  liveContribs: C[],
  liveJobs: J[],
  liveJobSalaries: S[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
) {
  const contribActiveFieldsRoot = profile.contributionActiveFields as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const accountActiveFields =
    contribActiveFieldsRoot.contributionAccounts ?? {};

  // Apply contribution account active fields — same no-fallback,
  // unconditional-merge, exclude-if-absent rule as applyContribActiveFields
  // (the single source of truth for how active fields merge onto a row; a
  // second hand-rolled copy of this logic here is exactly the kind of drift
  // that let this one differ — filtering merged fields by `field in c` — from
  // that one, which does a full merge). An account with no active-field
  // entry under this profile has no value anywhere and is excluded, not
  // passed through with a stale/absent value.
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
        ...activeFields,
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
 * columns and profile-only fields (e.g. displayNameActive). The Zod
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
    /** @deprecated legacy key. */
    displayNameActive?: string;
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
        ...activeFields,
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
 * Which of these accounts have no active value set under the given
 * profile's active fields — the "incomplete profile" surface for the UI.
 * Not a blocker: an incomplete profile still works everywhere (those
 * accounts are simply excluded from calculations by applyContribActiveFields
 * above), this is purely for surfacing the gap so it's never a silent one.
 */
export function getIncompleteContribAccountIds(
  rows: { id: number }[],
  accountActiveFields: Record<string, Record<string, unknown>>,
): number[] {
  return rows
    .filter(
      (row) =>
        accountActiveFields[String(row.id)]?.contributionValue === undefined,
    )
    .map((row) => row.id);
}

/**
 * Classify why a linked contribution account resolves the way it does for
 * one (profile, column) pair — reusing resolveContribFieldDisplayState so
 * this can't drift from the Compare view/Profile Manager's own "why is this
 * $0" logic (RULES.md Rule 6: those two already had to be de-duplicated
 * once). Checked in this order because each check can only be meaningful
 * once the earlier ones have passed: an account absent from the global
 * active fetch has no per-profile active fields to look at; a profile with
 * no value for it was never a candidate for the sandbox layer to disable.
 */
export function classifyContribResolution(
  accountId: number,
  rawContribIds: Set<number>,
  profileActiveFields: Record<string, Record<string, unknown>>,
  activeContribIds: Set<number>,
  incompleteIds: Set<number>,
): ContribResolutionStatus {
  if (!rawContribIds.has(accountId)) return "account_unavailable";
  const { hasValue, isDisabled } = resolveContribFieldDisplayState(
    profileActiveFields[String(accountId)] ?? null,
  );
  if (!hasValue) return "not_in_profile";
  if (isDisabled) return "inactive_in_profile";
  if (!activeContribIds.has(accountId)) return "inactive_in_sandbox";
  if (incompleteIds.has(accountId)) return "no_pay_period";
  return "ok";
}

/**
 * Build a synthetic (no DB row) contribution account for the What-If tab's
 * hand-added hypothetical accounts. Negative `id`s so they can never
 * collide with a real autoincrement id; every field this app's calculators
 * actually read is filled in with the same defaults
 * `contributionAccountInput` (settings/paycheck.ts) would use for a
 * freshly-created real row — no employer match, default tax treatment for
 * the chosen account type. Exists once here so paycheck.ts, contribution.ts,
 * and budget.ts can't each guess the defaults differently.
 */
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
export type DeductionRowWithActiveFields =
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
 * Which of these deductions have no active amount set under the given
 * profile's active fields — the "incomplete profile" surface for the UI,
 * same purpose as getIncompleteContribAccountIds.
 */
export function getIncompleteDeductionIds(
  rows: { id: number }[],
  deductionActiveFields: Record<string, Record<string, unknown>>,
): number[] {
  return rows
    .filter(
      (row) =>
        deductionActiveFields[String(row.id)]?.amountPerPeriod === undefined,
    )
    .map((row) => row.id);
}

/**
 * Fetch a contribution profile by ID, returning null when no profile is
 * selected (null/undefined id) or the row no longer exists.
 *
 * There is no `isDefault` concept any more: a profile whose
 * contributionActiveFields are empty is simply a profile with nothing
 * customized, and applying it is a no-op by content rather than by flag.
 * Was duplicated between this file's loadAndApplyContribProfile and
 * retirement.ts's own scenario-comparison resolver — retirement.ts applies
 * salary overrides with different layering semantics (no existing-override
 * priority), so it
 * keeps its own override-application logic and only shares this fetch.
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
 * don't need deduction data) — only the paycheck router path passes it.
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
  const activeFieldsRoot = profile.contributionActiveFields as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const contribActiveFields = activeFieldsRoot.contributionAccounts ?? {};
  const contribs = applyContribActiveFields(allContribs, contribActiveFields);
  const deductions = allDeductions
    ? applyDeductionActiveFields(
        allDeductions,
        activeFieldsRoot.deductions ?? {},
      )
    : [];
  return { contribs, jobs, deductions, contribActiveFields };
}

// ---------------------------------------------------------------------------
// Profile → Engine data builder
// ---------------------------------------------------------------------------

/** Context needed from the main buildEnginePayload for spec building. */
export type ProfileContribContext = {
  perfCategoryMap: Map<number, string>;
  perfRetirementBehaviorMap: Map<number, string>;
  perfContributionScalingMap: Map<number, string>;
  personNameById: Map<number, string>;
  accountBreakdownByCategory: Record<
    string,
    {
      name: string;
      taxType: string;
      accountType?: string;
      ownerName?: string;
      parentCategory?: string;
    }[]
  >;
};

/** One physical account row as it appears in `accountBreakdownByCategory`. */
export type BreakdownAccount = {
  name: string;
  taxType: string;
  accountType?: string;
  ownerName?: string;
  parentCategory?: string;
};

/**
 * Resolve which physical account (from one category's breakdown) a
 * contribution spec maps to, via a 6-tier precedence cascade — tightest
 * match first, loosening one facet at a time:
 *
 *   1. owner name + tax type + account type + parent category
 *   2. no owner        + tax type + account type + parent category
 *   3. owner name + tax type +              parent category   (drop account type)
 *   4. no owner        + tax type +              parent category
 *   5. owner name +                           parent category  (drop tax type)
 *   6. owner name OR no owner                                  (loosest)
 *
 * "No owner" (`ownerName === undefined`) means a joint/household account,
 * which any of that household's contributions may land in. A parent-category
 * criterion of `undefined` on the spec, or `undefined` on the account row,
 * is treated as "matches anything" (see `parentCatMatches`).
 *
 * Split out of `buildProfileContribData`'s inline `.map()` so the
 * cascade has a name, a doc, and isolated test coverage in a file that
 * was the site of an employer-match grouping bug; `tests/server/
 * match-account-for-contribution.test.ts` pins each tier.
 */
export function matchAccountForContribution(
  catAccts: BreakdownAccount[],
  criteria: {
    // null and undefined behave identically here — both mean "no such
    // constraint" for parentCat, and neither will `===` a real taxType /
    // owner string (matching the pre-extraction inline behavior).
    contribOwner: string | null | undefined;
    matchTaxType: string | null | undefined;
    accountType: string | null | undefined;
    contribParentCat: string | null | undefined;
  },
): BreakdownAccount | undefined {
  const { contribOwner, matchTaxType, accountType, contribParentCat } =
    criteria;
  const exactOwner = (a: BreakdownAccount) => a.ownerName === contribOwner;
  const ownerMatch = (a: BreakdownAccount) =>
    a.ownerName === contribOwner || a.ownerName === undefined;
  const parentCatMatches = (a: BreakdownAccount) => {
    if (a.parentCategory && contribParentCat)
      return a.parentCategory === contribParentCat;
    return true;
  };

  return (
    catAccts.find(
      (a) =>
        exactOwner(a) &&
        a.taxType === matchTaxType &&
        a.accountType === accountType &&
        parentCatMatches(a),
    ) ??
    catAccts.find(
      (a) =>
        a.ownerName === undefined &&
        a.taxType === matchTaxType &&
        a.accountType === accountType &&
        parentCatMatches(a),
    ) ??
    catAccts.find(
      (a) => exactOwner(a) && a.taxType === matchTaxType && parentCatMatches(a),
    ) ??
    catAccts.find(
      (a) =>
        a.ownerName === undefined &&
        a.taxType === matchTaxType &&
        parentCatMatches(a),
    ) ??
    catAccts.find((a) => exactOwner(a) && parentCatMatches(a)) ??
    catAccts.find((a) => ownerMatch(a))
  );
}

/** Result of building engine contribution data from a resolved profile. */
export type ProfileContribData = {
  contributionSpecs: ContributionSpec[];
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchRateByCategory: Record<AccountCategory, number>;
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  /** Base-year amounts and match rates over retirement money only. */
  retirementOnly: RetirementContribSlice;
  salaryByPerson: Record<number, number>;
  combinedSalary: number;
  /** Ids of `fixed_per_period` accounts with no resolvable job/pay period —
   *  excluded from contributionSpecs and the category totals. */
  incompleteAccountIds: number[];
};

/** Minimal contribution row shape needed by buildProfileContribData. */
export type ContribInputRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label?: string | null;
  parentCategory?: string | null;
  contributionMethod: string | null;
  contributionValue: string | number | null;
  taxTreatment: string | null;
  employerMatchType: string | null;
  employerMatchValue: string | number | null;
  employerMaxMatchPct: string | number | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
  performanceAccountId?: number | null;
  targetAnnual?: string | number | null;
  allocationPriority?: number | null;
  ownership?: string | null;
  hsaCoverageType?: string | null;
  /** Set by the IRS-limit cap pass; calculations read computeValue(c). */
  cappedValue?: number;
};

/**
 * Build engine contribution data (specs, employer match, base-year amounts)
 * from a resolved contribution profile.
 *
 * This is the same logic that buildEnginePayload() uses inline for the default
 * profile, extracted so it can be called for each profile-switch year.
 */
export function buildProfileContribData(
  activeContribs: (ContribInputRow & CapPassed)[],
  activeJobs: { id: number; personId: number; payPeriod: string | undefined }[],
  jobSalaries: {
    job: { id: number; personId: number };
    salary: number;
    bonusGross?: number;
    totalComp: number;
  }[],
  ctx: ProfileContribContext,
): ProfileContribData {
  // salary = base salary; bonusGross = the bonus (contributionPay — each
  // account takes its share only when set to, fromBonus); totalComp =
  // always includes bonus — used for rate calculations
  const totalCompensation = jobSalaries.reduce(
    (sum, js) => sum + js.totalComp,
    0,
  );

  // Aggregate contributions and employer match by category
  const contribRows: (ContribRow & CapPassed)[] = activeContribs.map((c) => ({
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    accountType: c.accountType,
    subType: c.subType,
    label: c.label ?? null,
    parentCategory: c.parentCategory ?? "",
    contributionMethod: c.contributionMethod ?? "percent_of_salary",
    contributionValue: String(c.contributionValue ?? "0"),
    cappedValue: c.cappedValue,
    capPassed: c.capPassed,
    taxTreatment: c.taxTreatment ?? "pre_tax",
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue
      ? String(c.employerMatchValue)
      : null,
    employerMaxMatchPct: c.employerMaxMatchPct
      ? String(c.employerMaxMatchPct)
      : null,
    isPayrollDeducted: c.isPayrollDeducted,
    fromBonus: c.fromBonus,
  }));

  const {
    contribByCategory,
    employerMatchByCategory,
    employerMatchById,
    employerMatchByParentCat,
    retirementOnly,
    incompleteAccountIds: aggregationIncompleteIds,
  } = aggregateContributionsByCategory(
    contribRows,
    activeJobs,
    jobSalaries.map((js) => ({
      job: { id: js.job.id, personId: js.job.personId },
      salary: js.salary,
      bonusGross: js.bonusGross,
    })),
  );

  // Employer match rates (fraction of total compensation)
  const matchRates = (match: Record<AccountCategory, number>) =>
    Object.fromEntries(
      getAllCategories().map((cat) => [
        cat,
        totalCompensation > 0 ? match[cat] / totalCompensation : 0,
      ]),
    ) as Record<AccountCategory, number>;
  const employerMatchRateByCategory = matchRates(employerMatchByCategory);

  // Build per-account contribution specs. A `fixed_per_period` account with
  // no resolvable job/pay period can't produce a real spec (periodsPerYear
  // would be a guess) — it's dropped and reported via
  // specBuilderIncompleteIds instead, per the method-gated incomplete
  // treatment (see resolveContribPeriods).
  const specBuilderIncompleteIds: number[] = [];
  const contributionSpecs: ContributionSpec[] = activeContribs
    .filter((c) => {
      const cv = toNumber(String(c.contributionValue ?? "0"));
      return cv > 0;
    })
    .map((c): ContributionSpec | null => {
      const cat = c.accountType;
      const cv = computeValue(c);
      const method = (c.contributionMethod ??
        "percent_of_salary") as ContributionSpec["method"];
      let value: number;
      let baseAnnual: number;
      let periodsPerYear: number | undefined;

      let salaryFraction = 1;
      const js = jobPayFor(c, jobSalaries);
      let personPayShare: number | undefined;
      if (method === "percent_of_salary") {
        value = cv / 100;
        // The pay this rate applies to — base salary, plus the bonus when
        // its check carries this contribution (annualContributionWithBonus)
        // — as a share of total pay, so it grows with salary in the engine.
        const pay = js
          ? safeDivide(annualContributionWithBonus(c, js, 1), value, js.salary)
          : 0;
        baseAnnual = roundToCents(pay * value);
        salaryFraction = safeDivide(pay, totalCompensation, 1);
        // The same pay as a share of this person's total pay — what the
        // engine re-applies each year when it tracks salary per person.
        const personTotal = sumBy(
          jobSalaries.filter((x) => x.job.personId === js?.job.personId),
          (x) => x.totalComp,
        );
        personPayShare = safeDivide(pay, personTotal, 1);
      } else if (method === "fixed_per_period") {
        value = cv;
        const job = activeJobs.find((j) => j.id === c.jobId);
        const resolved = resolveContribPeriods(method, job);
        if (resolved.incomplete) {
          specBuilderIncompleteIds.push(c.id);
          return null;
        }
        periodsPerYear = resolved.periodsPerYear;
        // Includes the bonus check's one extra deduction, when it carries one.
        baseAnnual = roundToCents(
          js
            ? annualContributionWithBonus(c, js, periodsPerYear)
            : cv * periodsPerYear,
        );
      } else {
        // fixed_monthly / fixed_annual — the shared yearly amount (a bonus
        // check carrying contributions takes one more pay period's share).
        value = cv;
        const job = activeJobs.find((j) => j.id === js?.job.id);
        baseAnnual = roundToCents(
          annualContributionWithBonus(
            c,
            js ?? { salary: 0 },
            resolveContribPeriods(method, job).periodsPerYear,
          ),
        );
      }

      // Match contribution to its individual account
      const contribOwner =
        c.personId != null ? ctx.personNameById.get(c.personId) : undefined;
      const matchTaxType =
        TAX_TREATMENT_TO_TAX_TYPE[c.taxTreatment ?? "pre_tax"] ??
        c.taxTreatment;
      const catAccts = ctx.accountBreakdownByCategory[cat] ?? [];
      const contribParentCat =
        c.parentCategory ??
        (c.performanceAccountId
          ? ctx.perfCategoryMap.get(c.performanceAccountId)
          : undefined);
      const matchedAcct = matchAccountForContribution(catAccts, {
        contribOwner,
        matchTaxType,
        accountType: c.accountType,
        contribParentCat,
      });

      return {
        category: cat,
        name: c.subType ?? c.accountType,
        method,
        value,
        salaryFraction,
        ...(personPayShare !== undefined ? { personPayShare } : {}),
        periodsPerYear,
        baseAnnual,
        taxTreatment: (c.taxTreatment ??
          "pre_tax") as ContributionSpec["taxTreatment"],
        personId: c.personId,
        ownerName: contribOwner,
        accountName: matchedAcct?.name,
        targetAnnual: c.targetAnnual ? Number(c.targetAnnual) : null,
        allocationPriority: c.allocationPriority ?? 0,
        parentCategory:
          c.parentCategory ??
          (c.performanceAccountId
            ? ctx.perfCategoryMap.get(c.performanceAccountId)
            : undefined),
        ownership: (c.ownership ?? "individual") as "individual" | "joint",
        retirementBehavior: (c.performanceAccountId
          ? ctx.perfRetirementBehaviorMap.get(c.performanceAccountId)
          : undefined) as ContributionSpec["retirementBehavior"],
        contributionScaling: (c.performanceAccountId
          ? ctx.perfContributionScalingMap.get(c.performanceAccountId)
          : undefined) as ContributionSpec["contributionScaling"],
        hsaCoverageType: c.hsaCoverageType ?? null,
        ...(c.cap && c.cap.overBy > 0
          ? { configuredAnnual: c.cap.annual }
          : {}),
        employerShare: safeDivide(
          employerMatchById.get(c.id) ?? 0,
          employerMatchByCategory[cat],
          0,
        ),
      };
    })
    .filter((spec): spec is ContributionSpec => spec !== null);

  // Base year contributions
  const annuals = (summaries: typeof contribByCategory) =>
    Object.fromEntries(
      getAllCategories().map((cat) => [cat, summaries[cat].annual]),
    ) as Record<AccountCategory, number>;
  const baseYearContributions = annuals(contribByCategory);

  // Per-person salary map (totalComp for display / rate consistency)
  const salaryByPerson: Record<number, number> = {};
  for (const js of jobSalaries) {
    salaryByPerson[js.job.personId] =
      (salaryByPerson[js.job.personId] ?? 0) + js.totalComp;
  }

  return {
    contributionSpecs,
    baseYearContributions,
    baseYearEmployerMatch: employerMatchByCategory,
    employerMatchRateByCategory,
    employerMatchByParentCat,
    retirementOnly: {
      baseYearContributions: annuals(retirementOnly.contribByCategory),
      baseYearEmployerMatch: retirementOnly.employerMatchByCategory,
      employerMatchRateByCategory: matchRates(
        retirementOnly.employerMatchByCategory,
      ),
    },
    salaryByPerson,
    combinedSalary: totalCompensation,
    incompleteAccountIds: Array.from(
      new Set([...aggregationIncompleteIds, ...specBuilderIncompleteIds]),
    ),
  };
}
