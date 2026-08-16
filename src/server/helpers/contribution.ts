/**
 * Contribution computation, aggregation, and profile resolution helpers.
 */
import { eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
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
} from "@/lib/config/account-types";
import { toNumber, getPeriodsPerYear } from "./transforms";
import type { Db } from "./transforms";
import { getCurrentSalary } from "./salary";

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
 * active job's pay period, or 26 (biweekly) if there are none. Shared by
 * computeActiveSummary's forward computation and
 * applyContributionAccountEdit's inverse so the two can't drift apart.
 */
export function resolveJoblessPeriodsPerYear(
  activeJobs: { payPeriod: string }[],
): number {
  return activeJobs.length > 0
    ? getPeriodsPerYear(activeJobs[0]!.payPeriod)
    : 26;
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
 * account is already at that value (avoids float/rounding drift on
 * fixed_annual / fixed_per_period round-trips).
 */
export async function applyContributionAccountEdit(
  db: Db,
  contributionAccountId: number,
  monthlyAmount: number,
): Promise<void> {
  const [account] = await db
    .select()
    .from(schema.contributionAccounts)
    .where(eq(schema.contributionAccounts.id, contributionAccountId));
  if (!account) return; // stale FK — nothing to update

  const activeJobs = await db
    .select()
    .from(schema.jobs)
    .where(isNull(schema.jobs.endDate));
  const periodsPerYear = resolveJoblessPeriodsPerYear(activeJobs);

  const newValue = roundToCents(
    computeContributionValueFromMonthly(
      account.contributionMethod,
      monthlyAmount,
      periodsPerYear,
    ),
  );

  if (Math.abs(newValue - toNumber(account.contributionValue)) < 0.005) {
    return;
  }

  await db
    .update(schema.contributionAccounts)
    .set({ contributionValue: String(newValue) })
    .where(eq(schema.contributionAccounts.id, contributionAccountId));
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
 * Build ContributionAccountInput[] from DB rows for a given job + person.
 * Handles percent_of_salary (stored as whole number, e.g. 14 = 14%),
 * fixed_per_period, and fixed_annual methods.
 * Employer match percentages are also stored as whole numbers.
 */
export function buildContribAccounts(
  jobContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  personalContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  salary: number,
  periodsPerYear: number,
): ContributionAccountInput[] {
  return [...jobContribs, ...personalContribs].map((c) => {
    const contribValue = toNumber(c.contributionValue);
    const annual = computeAnnualContribution(
      c.contributionMethod,
      contribValue,
      salary,
      periodsPerYear,
    );
    const perPeriod =
      c.contributionMethod === "fixed_per_period"
        ? contribValue
        : annual / periodsPerYear;

    const matchAnnual = computeEmployerMatch(
      c.employerMatchType,
      toNumber(c.employerMatchValue),
      toNumber(c.employerMaxMatchPct),
      annual,
      c.contributionMethod,
      contribValue,
      salary,
    );

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
      employerMatch: roundToCents(matchAnnual),
      employerMatchTaxTreatment: c.employerMatchTaxTreatment,
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
  contributionValue: string;
  taxTreatment: string;
  employerMatchType: string | null;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
};

type PersonRef = { id: number; name: string };
type JobRef = { id: number; personId: number; payPeriod: string };
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

  for (const c of activeContribs) {
    const cat = c.accountType;
    const cv = toNumber(c.contributionValue);
    // Direct job link, or fall back to person's first active job when jobId is null
    const js = c.jobId
      ? jobSalaries.find((x) => x.job.id === c.jobId)
      : jobSalaries.find((x) => x.job.personId === c.personId);
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const salary = js?.salary ?? 0;
    const periods = getPeriodsPerYear(job?.payPeriod ?? "biweekly");
    const annual = computeAnnualContribution(
      c.contributionMethod,
      cv,
      salary,
      periods,
    );

    contribByCategory[cat].annual += annual;
    if (isTaxFree(c.taxTreatment)) {
      contribByCategory[cat].rothAnnual += annual;
    } else {
      contribByCategory[cat].tradAnnual += annual;
    }

    const matchAmount = computeEmployerMatch(
      c.employerMatchType,
      toNumber(c.employerMatchValue),
      toNumber(c.employerMaxMatchPct),
      annual,
      c.contributionMethod,
      cv,
      salary,
    );
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
    contribByCategory[cat].rothFraction =
      total > 0 ? contribByCategory[cat].rothAnnual / total : 1;
  }

  return {
    contribByCategory,
    employerMatchByCategory,
    employerMatchByParentCat,
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
  const rawSpecs = activeContribs
    .filter((c) => toNumber(c.contributionValue) > 0)
    .map((c) => {
      const ownerPerson = people.find((p) => p.id === c.personId);
      const job = c.jobId
        ? activeJobs.find((j) => j.id === c.jobId)
        : activeJobs.find((j) => j.personId === c.personId);
      const js = c.jobId
        ? jobSalaries.find((x) => x.job.id === c.jobId)
        : jobSalaries.find((x) => x.job.personId === c.personId);
      const salary = js?.salary ?? 0;
      const periods = getPeriodsPerYear(job?.payPeriod ?? "biweekly");
      const cv = toNumber(c.contributionValue);
      const method = c.contributionMethod ?? "percent_of_salary";
      const value = method === "percent_of_salary" ? cv / 100 : cv;
      const annual = computeAnnualContribution(
        c.contributionMethod,
        cv,
        salary,
        periods,
      );
      const matchAnnual = computeEmployerMatch(
        c.employerMatchType,
        toNumber(c.employerMatchValue),
        toNumber(c.employerMaxMatchPct),
        annual,
        c.contributionMethod,
        cv,
        salary,
      );
      return {
        id: c.id,
        category: c.accountType,
        name: c.subType ?? c.accountType,
        method,
        value,
        baseAnnual: annual,
        taxTreatment: c.taxTreatment,
        ownerName: ownerPerson?.name ?? null,
        personId: c.personId,
        matchAnnual,
      };
    });

  // Redistribute match proportionally within each (person, category) group.
  // e.g., if one person has Pre-Tax 401k (16%) + Roth 401k (5%), the total
  // 401k match is split proportionally by annual contribution amount.
  const groups = new Map<string, typeof rawSpecs>();
  for (const s of rawSpecs) {
    const key = `${s.personId}:${s.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  groups.forEach((specs) => {
    const totalMatch = specs.reduce((sum, sp) => sum + sp.matchAnnual, 0);
    if (totalMatch <= 0 || specs.length <= 1) return;
    const totalContrib = specs.reduce((sum, sp) => sum + sp.baseAnnual, 0);
    for (const sp of specs) {
      sp.matchAnnual =
        totalContrib > 0
          ? totalMatch * (sp.baseAnnual / totalContrib)
          : totalMatch / specs.length;
    }
  });

  return rawSpecs;
}

// ---------------------------------------------------------------------------
// Contribution profile resolution
// ---------------------------------------------------------------------------

/** Row shape returned by loadLiveContribData for aggregation. */
export type LiveContribRow = {
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string;
  contributionMethod: string;
  contributionValue: string;
  taxTreatment: string;
  employerMatchType: string | null;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  id: number;
};

/**
 * Load all live contribution data needed for profile resolution.
 * Intentionally live/un-overridden — this is the baseline every named
 * Contribution Profile's overrides get layered ON TOP OF (see
 * resolveProfile's callers), so it can't itself reflect a Plan override
 * without corrupting that layering. See applySalaryOverride's docblock
 * (./salary.ts) for the live-vs-override-aware rule.
 */
export async function loadLiveContribData(db: Db, asOfDate: Date = new Date()) {
  const [allJobs, allContribs, allPeople, allPerfAccounts] = await Promise.all([
    db.select().from(schema.jobs),
    db.select().from(schema.contributionAccounts),
    db.select().from(schema.people),
    db.select().from(schema.performanceAccounts),
  ]);
  const activeJobs = allJobs.filter((j) => !j.endDate);
  const activeContribs = allContribs.filter((c) => c.isActive);
  const perfAccountMap = new Map(allPerfAccounts.map((pa) => [pa.id, pa]));

  // Get current salaries (with salary_changes applied)
  // Import salary helpers for bonus-aware compensation
  const { getEffectiveIncome, getTotalCompensation, getBonusOverridesForJobs } =
    await import("./salary");
  const bonusOverrides = await getBonusOverridesForJobs(
    db,
    activeJobs.map((j) => j.id),
  );
  const asOfYear = asOfDate.getFullYear();
  const jobSalaries = await Promise.all(
    activeJobs.map(async (j) => {
      const baseSalary = await getCurrentSalary(
        db,
        j.id,
        j.annualSalary,
        asOfDate,
      );
      const resolvedOverride =
        bonusOverrides.get(`${j.id}:${asOfYear}`) ?? null;
      return {
        job: { id: j.id },
        salary: getEffectiveIncome(j, baseSalary, resolvedOverride),
        totalComp: getTotalCompensation(j, baseSalary, resolvedOverride),
        personId: j.personId,
        resolvedBonusOverride: resolvedOverride,
      };
    }),
  );

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
    contributionMethod: c.contributionMethod,
    contributionValue: c.contributionValue,
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
      totalComp: js.totalComp,
      resolvedBonusOverride: js.resolvedBonusOverride,
    })),
    rawContribRows: allContribs, // All accounts (active + inactive/stubbed) for profile editor
    peopleMap,
    perfAccountMap,
  };
}

/** Resolve a profile against live data, returning effective contribs + salaries. */
export function resolveProfile(
  profile: typeof schema.contributionProfiles.$inferSelect,
  liveContribs: LiveContribRow[],
  liveJobs: (typeof schema.jobs.$inferSelect)[],
  liveJobSalaries: {
    job: { id: number; personId: number };
    salary: number;
    totalComp: number;
    resolvedBonusOverride: number | null;
  }[],
) {
  const salaryOverrides = profile.salaryOverrides as Record<string, number>;
  const contribOverridesRoot = profile.contributionOverrides as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const contribOverrides = contribOverridesRoot.contributionAccounts ?? {};
  const jobOverrides = contribOverridesRoot.jobs ?? {};

  // Apply salary overrides — when a profile overrides salary, both salary and
  // totalComp are set to the override value (bonus is excluded from overrides)
  const jobSalaries = liveJobSalaries.map((js) => {
    const job = liveJobs.find((j) => j.id === js.job.id);
    if (!job) return js;
    const override = salaryOverrides[String(job.personId)];
    return override !== undefined
      ? {
          job: js.job,
          salary: override,
          totalComp: override,
          resolvedBonusOverride: null,
        }
      : js;
  });

  // Apply contribution account overrides
  const activeContribs = liveContribs
    .map((c) => {
      const overrides = contribOverrides[String(c.id)];
      if (!overrides) return c;
      const validOverrides = Object.fromEntries(
        Object.entries(overrides).filter(([field]) => field in c),
      );
      return { ...c, ...validOverrides };
    })
    .filter((c) => {
      const overrides = contribOverrides[String(c.id)];
      // If override explicitly sets isActive to false, filter it out
      if (overrides && overrides.isActive === false) return false;
      return true;
    });

  // Apply job overrides (bonus fields)
  const patchedJobs = liveJobs.map((j) => {
    const overrides = jobOverrides[String(j.id)];
    if (!overrides) return j;
    const validOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([field]) => field in j),
    );
    return { ...j, ...validOverrides };
  });

  const activeJobs = patchedJobs.map((j) => ({
    id: j.id,
    personId: j.personId,
    payPeriod: j.payPeriod,
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
 * Apply contribution profile overrides to raw DB contribution account rows.
 * Merges all override fields onto the row generically — both DB columns and
 * profile-only fields (e.g. displayNameOverride). The Zod .strict() schema
 * on the write path prevents invalid fields from entering.
 * Rows marked isActive=false in the override are filtered out.
 *
 * contribOverrides shape: { "accountId": { field: value, ... } }
 */
export type ContribRowWithOverrides =
  typeof schema.contributionAccounts.$inferSelect & {
    displayNameOverride?: string;
  };

export function applyContribOverrides(
  rows: (typeof schema.contributionAccounts.$inferSelect)[],
  contribOverrides: Record<string, Record<string, unknown>>,
): ContribRowWithOverrides[] {
  return rows
    .map((row): ContribRowWithOverrides => {
      const overrides = contribOverrides[String(row.id)];
      if (!overrides) return row;
      // Merge all override fields — both DB columns and profile-only fields
      return { ...row, ...overrides } as ContribRowWithOverrides;
    })
    .filter((row) => row.isActive !== false);
}

/**
 * Apply contribution profile job overrides to raw DB job rows.
 * Used to override bonus fields (bonusPercent, bonusMultiplier, etc.) per profile.
 *
 * jobOverrides shape: { "jobId": { field: value, ... } }
 */
export function applyJobOverrides(
  jobs: (typeof schema.jobs.$inferSelect)[],
  jobOverrides: Record<string, Record<string, unknown>>,
): (typeof schema.jobs.$inferSelect)[] {
  return jobs.map((job) => {
    const overrides = jobOverrides[String(job.id)];
    if (!overrides) return job;
    const validOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([field]) => field in job),
    );
    return { ...job, ...validOverrides };
  });
}

/**
 * Load a contribution profile by ID and apply its overrides to raw DB rows.
 * Merges profile salary overrides into the provided map (lower priority than existing entries).
 * Returns modified contribs, jobs, and salary map — or originals if profile is null/default.
 */
/**
 * Fetch a contribution profile by ID, returning null when unset, not found,
 * or the default profile (callers treat all three as "no profile
 * resolution needed"). Was duplicated between this file's
 * loadAndApplyContribProfile and retirement.ts's own scenario-comparison
 * resolver (M26, .scratch/docs/review-findings.md) — retirement.ts applies
 * salary overrides with different layering semantics (no existing-override
 * priority), so it keeps its own override-application logic and only
 * shares this fetch+isDefault check.
 */
export async function fetchNonDefaultContributionProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.contributionProfiles.$inferSelect | null> {
  if (!profileId) return null;
  const profiles = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, profileId));
  const profile = profiles[0];
  return profile && !profile.isDefault ? profile : null;
}

export async function loadAndApplyContribProfile(
  db: Db,
  profileId: number | undefined | null,
  allContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  allJobs: (typeof schema.jobs.$inferSelect)[],
  salaryOverrideMap: Map<number, number>,
): Promise<{
  contribs: ContribRowWithOverrides[];
  jobs: (typeof schema.jobs.$inferSelect)[];
  salaryMap: Map<number, number>;
}> {
  const profile = await fetchNonDefaultContributionProfile(db, profileId);
  if (!profile) {
    return {
      contribs: allContribs,
      jobs: allJobs,
      salaryMap: salaryOverrideMap,
    };
  }

  const overridesRoot = profile.contributionOverrides as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const contribs = applyContribOverrides(
    allContribs,
    overridesRoot.contributionAccounts ?? {},
  );
  const jobs = applyJobOverrides(allJobs, overridesRoot.jobs ?? {});

  // Merge salary overrides (profile has lower priority than explicit UI overrides)
  const salaryMap = new Map(salaryOverrideMap);
  const profileSalaryOverrides = profile.salaryOverrides as Record<
    string,
    number
  >;
  for (const [personId, salary] of Object.entries(profileSalaryOverrides)) {
    if (!salaryMap.has(Number(personId))) {
      salaryMap.set(Number(personId), salary);
    }
  }

  return { contribs, jobs, salaryMap };
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
  salaryOverrideMap: Map<number, number>,
): {
  contribs: ContribRowWithOverrides[];
  jobs: (typeof schema.jobs.$inferSelect)[];
  salaryMap: Map<number, number>;
} {
  if (!profile || profile.isDefault) {
    return {
      contribs: allContribs,
      jobs: allJobs,
      salaryMap: salaryOverrideMap,
    };
  }
  const overridesRoot = profile.contributionOverrides as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const contribs = applyContribOverrides(
    allContribs,
    overridesRoot.contributionAccounts ?? {},
  );
  const jobs = applyJobOverrides(allJobs, overridesRoot.jobs ?? {});
  const salaryMap = new Map(salaryOverrideMap);
  const profileSalaryOverrides = profile.salaryOverrides as Record<
    string,
    number
  >;
  for (const [personId, salary] of Object.entries(profileSalaryOverrides)) {
    if (!salaryMap.has(Number(personId))) {
      salaryMap.set(Number(personId), salary);
    }
  }
  return { contribs, jobs, salaryMap };
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

/** Result of building engine contribution data from a resolved profile. */
export type ProfileContribData = {
  contributionSpecs: ContributionSpec[];
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchRateByCategory: Record<AccountCategory, number>;
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  salaryByPerson: Record<number, number>;
  combinedSalary: number;
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
  activeJobs: { id: number; personId: number; payPeriod: string }[],
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

  // Build per-account contribution specs
  const contributionSpecs: ContributionSpec[] = activeContribs
    .filter((c) => {
      const cv = toNumber(String(c.contributionValue ?? "0"));
      return cv > 0;
    })
    .map((c) => {
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
        salaryFraction =
          totalCompensation > 0 ? jobSalary / totalCompensation : 1;
      } else if (method === "fixed_per_period") {
        value = cv;
        const job = activeJobs.find((j) => j.id === c.jobId);
        periodsPerYear = getPeriodsPerYear(job?.payPeriod ?? "biweekly");
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
      const exactOwner = (a: { ownerName?: string }) =>
        a.ownerName === contribOwner;
      const ownerMatch = (a: { ownerName?: string }) =>
        a.ownerName === contribOwner || a.ownerName === undefined;
      const contribParentCat =
        c.parentCategory ??
        (c.performanceAccountId
          ? ctx.perfCategoryMap.get(c.performanceAccountId)
          : undefined);
      const parentCatMatch = (a: { parentCategory?: string }) => {
        if (a.parentCategory && contribParentCat)
          return a.parentCategory === contribParentCat;
        return true;
      };
      const matchedAcct =
        catAccts.find(
          (a) =>
            exactOwner(a) &&
            a.taxType === matchTaxType &&
            a.accountType === c.accountType &&
            parentCatMatch(a),
        ) ??
        catAccts.find(
          (a) =>
            a.ownerName === undefined &&
            a.taxType === matchTaxType &&
            a.accountType === c.accountType &&
            parentCatMatch(a),
        ) ??
        catAccts.find(
          (a) =>
            exactOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
        ) ??
        catAccts.find(
          (a) =>
            a.ownerName === undefined &&
            a.taxType === matchTaxType &&
            parentCatMatch(a),
        ) ??
        catAccts.find((a) => exactOwner(a) && parentCatMatch(a)) ??
        catAccts.find((a) => ownerMatch(a));

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
    });

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
  };
}
