/**
 * Contribution computation, aggregation, and profile resolution helpers.
 */
import type { RothIraRoute } from "@/lib/config/enum-values";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { EntityFieldMap } from "@/lib/db/schema";
import { roundToCents, safeDivide } from "@/lib/utils/math";
import {
  getDisplayGroup,
  getParentCategory,
  getDefaultTaxTreatment,
  isPayrollFicaExemptCategory,
} from "@/lib/config/account-types";
import type { ContributionAccountInput } from "@/lib/pure/paycheck/paycheck.types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  type TaxTreatment,
  type ContributionMethod,
} from "@/lib/config/enum-values";
import {
  computeValue,
  type CapPassed,
} from "@/lib/pure/contributions/contribution-caps";
import {
  computeAnnualContribution,
  fractionFromPercent,
} from "@/lib/pure/contributions/contribution-amount";
import type { ContribSaveChecker } from "./contribution-caps";
import { toNumber } from "@/lib/utils/numbers";
import { filterActiveJobs } from "@/lib/pure/household/profiles";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/paycheck";
import { payrollFicaExemptCap } from "@/lib/pure/contributions/irs-limits";
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
} from "@/lib/pure/contributions/employer-match";
import type { Db, DbOrTx } from "@/lib/db";
import {
  resolveJoblessPeriodsPerYear,
  annualContributionWithBonus,
} from "@/lib/pure/contributions/contribution-rows";

/**
 * Inverse of computeAnnualContribution for the flat-dollar methods a
 * budget-linked contribution account can use (linking is restricted to
 * jobId === null, so percent_of_salary — which needs a salary — never
 * applies here; reject it loudly rather than silently writing $0).
 */
function computeContributionValueFromMonthly(
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
 * local selection → active profile precedence the
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
        : safeDivide(annual, periodsPerYear, 0);

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
          ? fractionFromPercent(contribValue)
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
      fullMatchShareOfPay: match.fullMatchShareOfPay,
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
// Contribution profile resolution
// ---------------------------------------------------------------------------

/**
 * Row shape returned by loadLiveContribData for aggregation. No
 * contributionMethod/contributionValue here — those are never carried by
 * the account row itself (see applyContribActiveFields); resolveProfile
 * adds them from a specific profile's active fields, and only for accounts
 * that have an entry there.
 */
/** A live contribution account row: the full row (so every consumer — the
 *  cap's HSA coverage, payroll vs. manual, ownership, the match's tax
 *  treatment — reads the real fact), with its type narrowed and its parent
 *  category resolved. */
type LiveContribRow = Omit<
  typeof schema.contributionAccounts.$inferSelect,
  "accountType" | "parentCategory"
> & {
  accountType: AccountCategory;
  parentCategory: string;
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
  const activeJobsRaw = filterActiveJobs(allJobs, new Date());
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
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory:
      c.parentCategory ?? getParentCategory(c.accountType as AccountCategory),
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
