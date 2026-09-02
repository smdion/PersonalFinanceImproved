/**
 * Contribution computation, aggregation, and profile resolution helpers.
 */
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ScenarioOverrides } from "@/lib/db/schema";
import { roundToCents, safeDivide } from "@/lib/utils/math";
import { isTaxFree } from "@/lib/config/account-types";
import type {
  ContributionAccountInput,
  ContributionSpec,
  AccountCategory,
} from "@/lib/calculators/types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import {
  buildCategoryRecord,
  categoriesWithTaxPreference,
  getAllCategories,
  getDisplayGroup,
  getParentCategory,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import type {
  TaxTreatment,
  ContributionMethod,
  MatchTaxTreatment,
} from "@/lib/config/enum-values";
import { toNumber, getPeriodsPerYear } from "./transforms";
import type { Db } from "./transforms";
import {
  filterActiveJobs,
  resolveContribFieldDisplayState,
  type ContribResolutionStatus,
} from "@/lib/pure/profiles";
import {
  getEffectiveIncome,
  getTotalCompensation,
  resolveCompensation,
  loadEffectiveSalaryProfile,
  mergeSalaryProfileJobFields,
} from "./salary";
import type { SalaryProfileActiveMap } from "./salary";

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
 */
export async function applyContributionAccountEdit(
  db: Db,
  contributionAccountId: number,
  monthlyAmount: number,
  contributionProfileId: number,
): Promise<void> {
  const [profile] = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
  if (!profile) return; // stale FK — nothing to update

  const activeFields = (profile.contributionActiveFields ??
    {}) as ScenarioOverrides;
  const accountFields = (activeFields.contributionAccounts?.[
    String(contributionAccountId)
  ] ?? {}) as Record<string, unknown>;

  // No account-level method to fall back to — a not-yet-valued account
  // defaults to fixed_monthly, the exact unit this edit is already in.
  const method =
    (accountFields.contributionMethod as string) ?? "fixed_monthly";

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
  const { periodsPerYear, incomplete } =
    resolveJoblessPeriodsPerYear(activeJobs);

  // No active job anywhere to resolve a pay schedule from. This is a
  // budget-linked (jobId === null) account whose method needs periodsPerYear
  // — nothing sane to write, and this path isn't a user-facing save action
  // that can reject with an error (see the plan's jobless-account
  // treatment), so leave the value as-is rather than writing a fabricated
  // number.
  if (incomplete && method === "fixed_per_period") return;

  const newValue = roundToCents(
    computeContributionValueFromMonthly(method, monthlyAmount, periodsPerYear),
  );

  const currentValue = accountFields.contributionValue;
  if (
    currentValue != null &&
    Math.abs(newValue - Number(currentValue)) < 0.005
  ) {
    return;
  }

  const nextActiveFields: ScenarioOverrides = {
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

  await db
    .update(schema.contributionProfiles)
    .set({ contributionActiveFields: nextActiveFields })
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
}

/**
 * Compute annual employer match from DB contribution row fields.
 * When maxMatchPct is 0 or unset, treat as no cap (unlimited match).
 */
export function computeEmployerMatch(
  matchType: string | null,
  matchValue: number,
  maxMatchPct: number,
  empContribAnnual: number,
  empContribMethod: string,
  empContribValue: number,
  salary: number,
): number {
  if (!matchType || matchType === "none") return 0;

  if (matchType === "percent_of_contribution") {
    if (salary <= 0) return 0;
    const matchRate = matchValue / 100;
    const empPct =
      empContribMethod === "percent_of_salary"
        ? empContribValue / 100
        : empContribAnnual / salary;
    const cappedPct = maxMatchPct > 0 ? Math.min(empPct, maxMatchPct) : empPct;
    return salary * cappedPct * matchRate;
  }
  if (matchType === "dollar_match") {
    return matchValue;
  }
  if (matchType === "fixed_annual") {
    return matchValue;
  }
  return 0;
}

/**
 * Minimal row shape `computeGroupedEmployerMatch` needs — any call site
 * adapts its own richer row type down to this before calling.
 */
export type GroupableMatchRow = {
  id: number;
  jobId: number | null;
  personId: number | null;
  accountType: string;
  parentCategory: string;
  /** This row's own annual contribution, already computed by the caller
   *  (via computeAnnualContribution) against `salary` below. */
  annual: number;
  /** The salary this row's contribution is measured against. Every row in
   *  the same group is expected to resolve to the same salary (they're the
   *  same physical account's tax-treatment splits, on the same job) — a
   *  mismatch is treated as a data-resolution bug, not silently averaged. */
  salary: number;
  employerMatchType: string | null;
  employerMatchValue: number;
  /** Fraction (e.g. 0.06 for 6%), not a whole-number percent — matches how
   *  computeEmployerMatch already reads it. */
  employerMaxMatchPct: number;
  employerMatchTaxTreatment: MatchTaxTreatment;
};

export type GroupedMatchResult = {
  matchAnnual: number;
  employerMatchTaxTreatment: MatchTaxTreatment;
};

/**
 * Compute employer match per row, correctly combining Roth/Traditional
 * splits of the same physical account before applying the match cap.
 *
 * `computeEmployerMatch` caps a single row against ONLY that row's own
 * contribution — correct for an account with no tax-treatment split, wrong
 * the moment one physical account is split into a Roth row + a Traditional
 * row (same job/person + accountType), since a real employer match cap
 * applies to the account's combined contribution, not each split
 * separately. This groups rows by resolved job (falling back to person —
 * matches every caller's existing jobless-account convention) +
 * accountType + parentCategory, resolves the single row that's allowed to
 * carry real match config for that group, applies the cap once against the
 * group's combined annual contribution, then redistributes the resulting
 * total back onto each row proportionally by its own contribution share
 * (same distribution math previously only used for display).
 *
 * parentCategory is part of the grouping key so match dollars can never
 * silently cross between Retirement/Portfolio buckets — if a data entry
 * mistake gives two real splits of the same account different
 * parentCategory values, they're treated as separate (unfixed, per-row
 * capped) groups rather than combined.
 *
 * At most one row per group may have a real (`!== "none"`) match type —
 * enforced at the DB layer (see migration adding a partial unique index),
 * but this throws defensively if it somehow arrives here anyway, rather
 * than silently falling back to the broken per-row computation (that
 * fallback would itself be a second computation path, and would invent a
 * number for genuinely ambiguous config instead of surfacing the problem).
 */
export function computeGroupedEmployerMatch(
  rows: GroupableMatchRow[],
): Map<number, GroupedMatchResult> {
  const groups = new Map<string, GroupableMatchRow[]>();
  for (const r of rows) {
    const jobKey = r.jobId != null ? `job:${r.jobId}` : `person:${r.personId}`;
    const key = `${jobKey}:${r.accountType}:${r.parentCategory}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result = new Map<number, GroupedMatchResult>();
  groups.forEach((members) => {
    const configRows = members.filter(
      (m) => m.employerMatchType && m.employerMatchType !== "none",
    );

    if (configRows.length > 1) {
      throw new Error(
        `Multiple contribution_accounts rows (ids: ${configRows
          .map((r) => r.id)
          .join(", ")}) independently carry employer match config for the ` +
          `same account (job/person + accountType + parentCategory). At ` +
          `most one Roth/Traditional split of a physical account may hold ` +
          `match config — fix the account data before contributions can ` +
          `be computed correctly.`,
      );
    }

    if (configRows.length === 0) {
      for (const m of members) {
        result.set(m.id, {
          matchAnnual: 0,
          employerMatchTaxTreatment: m.employerMatchTaxTreatment,
        });
      }
      return;
    }

    const winner = configRows[0]!;
    const combinedAnnual = members.reduce((sum, m) => sum + m.annual, 0);

    for (const m of members) {
      if (Math.abs(m.salary - winner.salary) > 0.01) {
        throw new Error(
          `Contribution rows ${winner.id} and ${m.id} grouped as the same ` +
            `account (job/person + accountType + parentCategory) resolved ` +
            `to different salaries (${winner.salary} vs ${m.salary}) — the ` +
            `grouping key assumes siblings share one job's salary.`,
        );
      }
    }

    // Delegate the actual per-type match math to computeEmployerMatch
    // itself — passing the GROUP's combined annual contribution and a
    // method that isn't "percent_of_salary" (forcing computeEmployerMatch's
    // percent_of_contribution branch to derive its rate from
    // combinedAnnual/salary rather than a single row's own method/value).
    // This is computed once per group, not once per row — for dollar_match/
    // fixed_annual that's what prevents two independently-configured
    // sibling rows from each returning the full flat amount and doubling
    // it (prevented structurally here, and at the DB layer by the same
    // constraint that limits a group to at most one match-config row).
    const totalMatch = computeEmployerMatch(
      winner.employerMatchType,
      winner.employerMatchValue,
      winner.employerMaxMatchPct,
      combinedAnnual,
      "combined", // not "percent_of_salary" — see comment above
      0,
      winner.salary,
    );

    for (const m of members) {
      const share =
        combinedAnnual > 0 ? m.annual / combinedAnnual : 1 / members.length;
      result.set(m.id, {
        matchAnnual: totalMatch * share,
        // Match tax character is a plan property, not a per-split-row one
        // — every row in the group gets the winning row's value, never its
        // own (a Roth/Trad split shift must never reclassify match dollars).
        employerMatchTaxTreatment: winner.employerMatchTaxTreatment,
      });
    }
  });

  return result;
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
  jobContribs: ContribRowWithActiveFields[],
  personalContribs: ContribRowWithActiveFields[],
  salary: number,
  periodsPerYear: number,
): ContributionAccountInput[] {
  const allContribs = [...jobContribs, ...personalContribs];

  const annualById = new Map<number, number>();
  for (const c of allContribs) {
    const contribValue = Number(c.contributionValue);
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
      annual: annualById.get(c.id)!,
      salary,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: c.employerMatchTaxTreatment,
    })),
  );

  return allContribs.map((c) => {
    const contribValue = Number(c.contributionValue);
    const annual = annualById.get(c.id)!;
    const perPeriod =
      c.contributionMethod === "fixed_per_period"
        ? contribValue
        : annual / periodsPerYear;

    const match = matchByRow.get(c.id)!;

    // Group from config displayGroup
    const group = getDisplayGroup(c.accountType as AccountCategory);

    return {
      name: c.subType || c.label || c.accountType,
      annualContribution: roundToCents(annual),
      perPeriodContribution: roundToCents(perPeriod),
      rateOfGross:
        c.contributionMethod === "percent_of_salary"
          ? contribValue / 100
          : null,
      taxTreatment: c.taxTreatment,
      isPayrollDeducted: c.isPayrollDeducted ?? c.jobId !== null,
      group,
      employerMatch: roundToCents(match.matchAnnual),
      employerMatchTaxTreatment: match.employerMatchTaxTreatment,
    };
  });
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
type ContribRow = {
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
};

type PersonRef = { id: number; name: string };
type JobRef = { id: number; personId: number; payPeriod: string | undefined };
type JobSalaryRef = { job: { id: number; personId: number }; salary: number };

/**
 * Aggregate contributions and employer match by waterfall category in a single pass.
 * Replaces the duplicate loops in the retirement router that separately compute
 * `employerMatchByCategory` and `contribByCategory`.
 *
 * Returns both the per-category employee contribution summary and the per-category
 * employer match totals. Used by the retirement engine and available to any consumer.
 */
export function aggregateContributionsByCategory(
  activeContribs: ContribRow[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): {
  contribByCategory: Record<AccountCategory, ContribCategorySummary>;
  employerMatchByCategory: Record<AccountCategory, number>;
  /** Employer match broken down by category → parentCategory → amount. */
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  /** Ids of `fixed_per_period` accounts with no resolvable job/pay period —
   *  excluded from the totals above (annual treated as 0) rather than
   *  defaulted to a guessed pay period. See resolveContribPeriods. */
  incompleteAccountIds: number[];
} {
  const contribByCategory = buildCategoryRecord((): ContribCategorySummary => ({
    annual: 0,
    rothFraction: 0,
    rothAnnual: 0,
    tradAnnual: 0,
  }));
  const employerMatchByCategory = buildCategoryRecord(() => 0);
  const employerMatchByParentCat = new Map<
    AccountCategory,
    Map<string, number>
  >();

  const incompleteAccountIds: number[] = [];
  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  for (const c of activeContribs) {
    const cv = Number(c.contributionValue);
    // Direct job link, or fall back to person's first active job when jobId is null
    const js = c.jobId
      ? jobSalaries.find((x) => x.job.id === c.jobId)
      : jobSalaries.find((x) => x.job.personId === c.personId);
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
      : computeAnnualContribution(c.contributionMethod, cv, salary, periods);
    salaryById.set(c.id, salary);
    annualById.set(c.id, annual);

    contribByCategory[c.accountType].annual += annual;
    if (isTaxFree(c.taxTreatment)) {
      contribByCategory[c.accountType].rothAnnual += annual;
    } else {
      contribByCategory[c.accountType].tradAnnual += annual;
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
  for (const cat of categoriesWithTaxPreference()) {
    const total =
      contribByCategory[cat].rothAnnual + contribByCategory[cat].tradAnnual;
    contribByCategory[cat].rothFraction = safeDivide(
      contribByCategory[cat].rothAnnual,
      total,
      1,
    );
  }

  return {
    contribByCategory,
    employerMatchByCategory,
    employerMatchByParentCat,
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
  activeContribs: ContribRow[],
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
  for (const c of filtered) {
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const js = c.jobId
      ? jobSalaries.find((x) => x.job.id === c.jobId)
      : jobSalaries.find((x) => x.job.personId === c.personId);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
      c.contributionMethod,
      job,
    );
    const cv = Number(c.contributionValue);
    salaryById.set(c.id, salary);
    incompleteById.set(c.id, incomplete);
    annualById.set(
      c.id,
      incomplete
        ? 0
        : computeAnnualContribution(c.contributionMethod, cv, salary, periods),
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
    const cv = Number(c.contributionValue);
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
      matchAnnual: matchByRow.get(c.id)!.matchAnnual,
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
      salary: getEffectiveIncome(j, comp.salary, comp.terms),
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
    /** Payroll contribution basis — bonus-inclusive per the job's flag. */
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
      // An entry can legitimately exist for isActive/displayNameActive/match
      // fields alone — contributionValue is the specific thing with no
      // fallback, so that's what determines whether this account resolves
      // to anything at all.
      if (!activeFields || activeFields.contributionValue === undefined)
        return null;
      return { ...c, ...activeFields } as C & {
        contributionValue: string | number;
        contributionMethod: string;
        isActive?: boolean;
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => c.isActive !== false);

  // Jobs carry no Contribution-Profile-owned fields any more — the deleted
  // `jobs` active-fields bucket used to let a profile patch employer name /
  // bonus pay date / bonus-contribution flags; all of that either moved to
  // the Salary Profile entry (bonus date + flags) or lost its
  // profile-override path entirely (employerName — see RULES.md). Pay
  // schedule and includeBonusInContributions now always come straight from
  // the resolved Salary Profile entry, same axis as salary itself.
  const patchedJobs = mergeSalaryProfileJobFields(
    liveJobs,
    salaryProfileActiveMap,
  );

  const activeJobs = patchedJobs.map((j) => ({
    id: j.id,
    personId: j.personId,
    payPeriod: j.payPeriod,
  }));

  const patchedJobById = new Map(patchedJobs.map((j) => [j.id, j]));
  const jobSalaries = liveJobSalaries.map((js) => {
    const patchedJob = patchedJobById.get(js.job.id);
    const includeBonus = patchedJob?.includeBonusInContributions ?? false;
    return { ...js, salary: includeBonus ? js.totalComp : js.baseSalary };
  });
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
      if (!activeFields || activeFields.contributionValue === undefined) {
        return isOverlay ? (row as ContribRowWithActiveFields) : null;
      }
      return { ...row, ...activeFields } as ContribRowWithActiveFields;
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
 * retirement.ts's own scenario-comparison resolver (M26,
 * .scratch/docs/review-findings.md) — retirement.ts applies salary overrides
 * with different layering semantics (no existing-override priority), so it
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
 * in the `fetchRetirementData` parallel batch (C6 perf improvement).
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
 * Extracted from `buildProfileContribData`'s inline `.map()` (R35) — the
 * cascade had no name, no doc, and no isolated test coverage in a file that
 * was the site of the v0.7.6 employer-match grouping bug. Behavior is
 * byte-identical to the pre-extraction inline chain; `tests/server/
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
  performanceAccountId?: number | null;
  targetAnnual?: string | number | null;
  allocationPriority?: number | null;
  ownership?: string | null;
};

/**
 * Build engine contribution data (specs, employer match, base-year amounts)
 * from a resolved contribution profile.
 *
 * This is the same logic that buildEnginePayload() uses inline for the default
 * profile, extracted so it can be called for each profile-switch year.
 */
export function buildProfileContribData(
  activeContribs: ContribInputRow[],
  activeJobs: { id: number; personId: number; payPeriod: string | undefined }[],
  jobSalaries: {
    job: { id: number; personId: number };
    salary: number;
    totalComp: number;
  }[],
  ctx: ProfileContribContext,
): ProfileContribData {
  // salary = effective income (respects includeBonusInContributions flag)
  // totalComp = always includes bonus — used for rate calculations
  const totalCompensation = jobSalaries.reduce(
    (sum, js) => sum + js.totalComp,
    0,
  );

  // Aggregate contributions and employer match by category
  const contribRows: ContribRow[] = activeContribs.map((c) => ({
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    accountType: c.accountType,
    subType: c.subType,
    label: c.label ?? null,
    parentCategory: c.parentCategory ?? "",
    contributionMethod: c.contributionMethod ?? "percent_of_salary",
    contributionValue: String(c.contributionValue ?? "0"),
    taxTreatment: c.taxTreatment ?? "pre_tax",
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue
      ? String(c.employerMatchValue)
      : null,
    employerMaxMatchPct: c.employerMaxMatchPct
      ? String(c.employerMaxMatchPct)
      : null,
  }));

  const {
    contribByCategory,
    employerMatchByCategory,
    employerMatchByParentCat,
    incompleteAccountIds: aggregationIncompleteIds,
  } = aggregateContributionsByCategory(
    contribRows,
    activeJobs,
    jobSalaries.map((js) => ({
      job: { id: js.job.id, personId: js.job.personId },
      salary: js.salary,
    })),
  );

  // Employer match rates (fraction of total compensation)
  const employerMatchRateByCategory = Object.fromEntries(
    getAllCategories().map((cat) => [
      cat,
      totalCompensation > 0
        ? employerMatchByCategory[cat] / totalCompensation
        : 0,
    ]),
  ) as Record<AccountCategory, number>;

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
      const cv = toNumber(String(c.contributionValue ?? "0"));
      const method = (c.contributionMethod ??
        "percent_of_salary") as ContributionSpec["method"];
      let value: number;
      let baseAnnual: number;
      let periodsPerYear: number | undefined;

      let salaryFraction = 1;
      if (method === "percent_of_salary") {
        value = cv / 100;
        const js = jobSalaries.find((x) => x.job.id === c.jobId);
        const jobSalary = js ? js.salary : 0;
        baseAnnual = jobSalary * value;
        salaryFraction = safeDivide(jobSalary, totalCompensation, 1);
      } else if (method === "fixed_per_period") {
        value = cv;
        const job = activeJobs.find((j) => j.id === c.jobId);
        const resolved = resolveContribPeriods(method, job);
        if (resolved.incomplete) {
          specBuilderIncompleteIds.push(c.id);
          return null;
        }
        periodsPerYear = resolved.periodsPerYear;
        baseAnnual = cv * periodsPerYear;
      } else {
        // fixed_monthly
        value = cv;
        baseAnnual = cv * 12;
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
      };
    })
    .filter((spec): spec is ContributionSpec => spec !== null);

  // Base year contributions
  const baseYearContributions = Object.fromEntries(
    getAllCategories().map((cat) => [cat, contribByCategory[cat].annual]),
  ) as Record<AccountCategory, number>;

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
    salaryByPerson,
    combinedSalary: totalCompensation,
    incompleteAccountIds: Array.from(
      new Set([...aggregationIncompleteIds, ...specBuilderIncompleteIds]),
    ),
  };
}
