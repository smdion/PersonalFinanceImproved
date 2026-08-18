/**
 * Contribution computation, aggregation, and profile resolution helpers.
 */
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ScenarioOverrides } from "@/lib/db/schema";
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
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import type {
  TaxTreatment,
  ContributionMethod,
} from "@/lib/config/enum-values";
import { toNumber, getPeriodsPerYear } from "./transforms";
import type { Db } from "./transforms";
import { filterActiveJobs } from "@/lib/pure/profiles";
import {
  getEffectiveIncome,
  getTotalCompensation,
  resolveCompensation,
  loadEffectiveSalaryProfile,
} from "./salary";

/**
 * Bonus-AMOUNT fields a Contribution Profile is no longer allowed to mark
 * active — they moved to the Salary Profile entry (same tier as salary).
 *
 * The active-field filter is field-name-driven and these names all still
 * exist on `jobs`, so a stale key left behind in an old
 * contribution_active_fields blob would otherwise keep being applied and
 * keep changing someone's compensation from the wrong profile. The
 * migration strips them and jobActiveFieldsSchema rejects new ones; this is
 * the runtime backstop that makes a missed row inert rather than silently
 * wrong.
 */
const MOVED_TO_SALARY_PROFILE = new Set([
  "bonusPercent",
  "bonusMultiplier",
  "monthsInBonusYear",
]);

/** Job active fields that are real columns AND still owned by this axis. */
function pickJobActiveFields(
  activeFields: Record<string, unknown>,
  job: object,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(activeFields).filter(
      ([field]) => field in job && !MOVED_TO_SALARY_PROFILE.has(field),
    ),
  );
}

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

  const activeJobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(isNull(schema.jobs.endDate), eq(schema.jobs.isSpeculative, false)),
    );
  const periodsPerYear = resolveJoblessPeriodsPerYear(activeJobs);

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
 * Build ContributionAccountInput[] from DB rows for a given job + person.
 * Handles percent_of_salary (stored as whole number, e.g. 14 = 14%),
 * fixed_per_period, and fixed_annual methods.
 * Employer match percentages are also stored as whole numbers.
 */
export function buildContribAccounts(
  jobContribs: ContribRowWithActiveFields[],
  personalContribs: ContribRowWithActiveFields[],
  salary: number,
  periodsPerYear: number,
): ContributionAccountInput[] {
  return [...jobContribs, ...personalContribs].map((c) => {
    const contribValue = Number(c.contributionValue);
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
  contributionValue: string | number;
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
    const cv = Number(c.contributionValue);
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
    .filter((c) => Number(c.contributionValue) > 0)
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
      const cv = Number(c.contributionValue);
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
  const activeJobs = filterActiveJobs(allJobs);
  const activeContribs = allContribs.filter((c) => c.isActive);
  const perfAccountMap = new Map(allPerfAccounts.map((pa) => [pa.id, pa]));

  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);

  const jobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: { id: j.id },
      salary: getEffectiveIncome(j, comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
      personId: j.personId,
      resolvedBonusOverride: null,
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
      resolvedBonusOverride: js.resolvedBonusOverride,
    })),
    rawContribRows: allContribs, // All accounts (active + inactive/stubbed) for profile editor
    peopleMap,
    perfAccountMap,
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
  J extends {
    id: number;
    personId: number;
    payPeriod: string;
    includeBonusInContributions: boolean;
  },
  S extends {
    job: { id: number; personId: number };
    /** Payroll contribution basis — bonus-inclusive per the job's flag. */
    salary: number;
    /** Un-blended current salary, BEFORE any bonus. The base every bonus
     *  formula multiplies; `salary` above may already include a bonus, so
     *  computing off it would compound. */
    baseSalary: number;
    totalComp: number;
    resolvedBonusOverride: number | null;
  },
>(
  profile: Pick<
    typeof schema.contributionProfiles.$inferSelect,
    "contributionActiveFields"
  >,
  liveContribs: C[],
  liveJobs: J[],
  liveJobSalaries: S[],
) {
  const contribActiveFieldsRoot = profile.contributionActiveFields as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const accountActiveFields =
    contribActiveFieldsRoot.contributionAccounts ?? {};
  const jobActiveFields = contribActiveFieldsRoot.jobs ?? {};

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

  // Apply job active fields (employer name, bonus pay date,
  // bonus-contribution flags). Bonus AMOUNT terms are excluded — see
  // MOVED_TO_SALARY_PROFILE.
  const patchedJobs = liveJobs.map((j) => {
    const activeFields = jobActiveFields[String(j.id)];
    if (!activeFields) return j;
    return { ...j, ...pickJobActiveFields(activeFields, j) };
  });

  const activeJobs = patchedJobs.map((j) => ({
    id: j.id,
    personId: j.personId,
    payPeriod: j.payPeriod,
  }));

  // Must derive from patchedJobs, not liveJobs — includeBonusInContributions
  // is a job active field this profile can override, and getEffectiveIncome
  // reads it (via `salary` here). Deriving from the unpatched job (the old
  // `jobSalaries = liveJobSalaries` alias) meant toggling the flag on a
  // Contribution Profile silently no-op'd: the flag was read before the
  // patch that was supposed to change it.
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

/**
 * Apply a contribution profile's job active fields to raw DB job rows.
 *
 * Sets the job fields a Contribution Profile still owns: employerName,
 * the bonus PAY DATE (bonusMonth / bonusDayOfMonth), and the two flags that
 * decide how contributions are computed from a bonus (include401kInBonus,
 * includeBonusInContributions).
 *
 * It no longer sets how BIG the bonus is. bonusPercent / bonusMultiplier /
 * monthsInBonusYear moved to the Salary Profile entry — same tier as
 * salary — so a Contribution Profile can no longer change anyone's
 * compensation.
 *
 * jobActiveFields shape: { "jobId": { field: value, ... } }
 */
export function applyJobActiveFields(
  jobs: (typeof schema.jobs.$inferSelect)[],
  jobActiveFields: Record<string, Record<string, unknown>>,
): (typeof schema.jobs.$inferSelect)[] {
  return jobs.map((job) => {
    const activeFields = jobActiveFields[String(job.id)];
    if (!activeFields) return job;
    return { ...job, ...pickJobActiveFields(activeFields, job) };
  });
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
 * rows. Returns modified contribs + jobs — or the originals if no profile
 * is selected / the row is gone.
 *
 * Purely contribution-account and job-field active fields. Salary is NOT
 * part of a Contribution Profile — call loadAndApplySalaryProfile
 * (./salary.ts) for that axis, independently.
 */
export async function loadAndApplyContribProfile(
  db: Db,
  profileId: number | undefined | null,
  allContribs: (typeof schema.contributionAccounts.$inferSelect)[],
  allJobs: (typeof schema.jobs.$inferSelect)[],
): Promise<{
  contribs: ContribRowWithActiveFields[];
  jobs: (typeof schema.jobs.$inferSelect)[];
}> {
  const profile = await fetchContributionProfile(db, profileId);
  return applyContribProfileRow(profile, allContribs, allJobs);
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
): {
  contribs: ContribRowWithActiveFields[];
  jobs: (typeof schema.jobs.$inferSelect)[];
} {
  if (!profile) {
    // No profile at all — nothing resolves (same "no fallback" rule as a
    // profile with empty active fields; there is no longer a live account
    // value to fall back to).
    return {
      contribs: applyContribActiveFields(allContribs, {}),
      jobs: allJobs,
    };
  }
  const activeFieldsRoot = profile.contributionActiveFields as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const contribs = applyContribActiveFields(
    allContribs,
    activeFieldsRoot.contributionAccounts ?? {},
  );
  const jobs = applyJobActiveFields(allJobs, activeFieldsRoot.jobs ?? {});
  return { contribs, jobs };
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
