/**
 * Retirement-scoped engine payload builder.
 *
 * `fetchRetirementData` loads every DB table the projection / Monte Carlo engine
 * needs. `buildEnginePayload` turns that raw data into `baseEngineInput` plus all
 * the computed intermediate values retirement routers expose to the UI.
 *
 * This module is **retirement-scoped** — it reads retirement settings, computes
 * per-person retirement ages, filing status, IRMAA/ACA, and the engine's starting
 * balances. Callers (projection router endpoints) consume the result and add
 * their own accumulation/decumulation overrides and decumulation defaults.
 */
import { calendarYear } from "@/lib/utils/date";
import { loadExpenseEndings } from "./payload/expense-endings";
import {
  householdTimeline,
  planEndAge,
  planRetirementAge,
} from "@/lib/pure/household/household-timeline";
import { emptyTaxBucketMap } from "@/lib/config/tax-treatment-buckets";
import { loadSimulationPreset } from "@/server/services/simulation/simulation-preset";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import {
  retirementFilingStatus,
  storedProfileFilingStatus,
} from "@/lib/pure/tax/filing-status";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import { eq, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  contributionPay,
  getTotalCompensation,
  getLatestSnapshot,
  applySalaryProfileRow,
  resolveCompensation,
} from "@/server/helpers";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { applyContribProfileRow } from "@/server/services/contributions/profile";
import { loadAndApplyContribProfile } from "@/server/services/contributions/profile";
import { buildProfileContribData } from "@/lib/pure/contributions/profile-contrib-data";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import {
  resolveRetirementProfileIdFrom,
  retirementProfileIsFallback,
  pickProfileSettingsRow,
} from "@/server/helpers/retirement-profile";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAllCategories,
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  getDefaultAccumulationOrder,
  isRetirementMoney,
} from "@/lib/config/account-types";
import type { SimpleTaxModeParts } from "@/lib/pure/tax/simple-tax-mode";
import { resolveRmdExcessTarget } from "@/lib/pure/retirement/rmd-excess-target";
import {
  findMissingCostBasis,
  missingCostBasisWarning,
} from "@/lib/pure/accounts/basis-consistency";
import { roundToCents, sumBy, safeDivide } from "@/lib/utils/math";
import {
  DEFAULT_SIMULATION,
  IRS_LIMIT_GROWTH_RATE,
  IRS_LIMIT_GROWTH_RATE_MAX,
  FALLBACK_CONTRIBUTION_RATE,
} from "@/lib/constants";
import { log } from "@/lib/logger";
import { buildSocialSecurityEntries } from "./social-security-entries";
import { buildDistributionTaxRates } from "@/lib/pure/tax/distribution-tax-rates";
import { accountGroupLimits } from "@/lib/pure/contributions/contribution-caps";
import {
  capEffectiveContribs,
  type CapPassHousehold,
} from "@/lib/pure/contributions/cap-pass";
import { resolvePhaseExpenses } from "./payload/budget-expenses";
import {
  buildProfileSwitches,
  capAgeSteps,
  loadSwitchProfiles,
  profileSwitchFrom,
} from "./payload/profile-switches";
import { retirementContributions } from "./payload/retirement-contributions";
import { buildIndividualAccounts } from "./payload/individual-accounts";
import { resolveTaxParams, type TaxSection } from "@/lib/config/tax-params";
import { projectionJobs, workingYears } from "@/lib/pure/household/profiles";
import { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_IRS_LIMIT_GROWTH_RATE,
} from "@/lib/constants/settings-keys";
import type { Db } from "@/lib/db";

/**
 * Fetch all DB tables needed by the contribution engine / Monte Carlo projection.
 * Returns the raw query results — callers can destructure what they need.
 */

export async function fetchRetirementData(
  db: Db,
  opts?: {
    snapshotId?: number;
    contributionProfileId?: number;
    salaryProfileId?: number;
    /** Reference date for the IRS-limits-by-tax-year lookup. Defaults to
     *  today. NOTE: for snapshotId-based historical calls, the snapshot's
     *  own date isn't known until this same Promise.all resolves (it's one
     *  of the parallel fetches), so it can't retroactively affect this
     *  query — this only helps callers that already know their target date
     *  up front. */
    asOfDate?: Date;
  },
) {
  const [
    people,
    allJobs,
    retSettings,
    retProfiles,
    retProfilePeople,
    retScenarios,
    returnRates,
    allContribsRaw,
    allLimits,
    snapshotData,
    salaryOverrideRows,
    budgetOverrideRows,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    allTaxBrackets,
    allLtcgBrackets,
    allIrmaaBrackets,
    allFplByHousehold,
    allTaxParams,
    brokerageGoalRows,
    allAppSettings,
    contribProfileRow,
    salaryProfileRow,
    jobLinkRows,
    accountBasisRows,
    defaultPreset,
    classBucketRows,
  ] = await Promise.all([
    getAllPeople(db),
    db.select().from(schema.jobs),
    db.select().from(schema.retirementSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
    db.select().from(schema.retirementProfilePeople),
    db.select().from(schema.retirementScenarios),
    db
      .select()
      .from(schema.returnRateTable)
      .orderBy(asc(schema.returnRateTable.age)),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(eq(schema.contributionAccounts.isActive, true)),
    // Unfiltered: resolveTaxParams picks the year. Was previously
    // filtered to asOfDate.getFullYear() here, which — combined with
    // tax_brackets being taken at MAX(tax_year) — was the split-vintage
    // gap. The resolver now anchors every slice on one year.
    db.select().from(schema.contributionLimits),
    getLatestSnapshot(db, opts?.snapshotId),
    db
      .select()
      .from(schema.retirementSalaryOverrides)
      .orderBy(asc(schema.retirementSalaryOverrides.projectionYear)),
    db
      .select()
      .from(schema.retirementBudgetOverrides)
      .orderBy(asc(schema.retirementBudgetOverrides.projectionYear)),
    db
      .select()
      .from(schema.budgetProfiles)
      .orderBy(asc(schema.budgetProfiles.id)),
    db.select().from(schema.budgetItems),
    db.select().from(schema.performanceAccounts),
    db.select().from(schema.taxBrackets),
    db.select().from(schema.ltcgBrackets),
    db.select().from(schema.irmaaBrackets),
    db.select().from(schema.fplByHousehold),
    db.select().from(schema.taxParams),
    db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(asc(schema.brokerageGoals.targetYear)),
    db.select().from(schema.appSettings),
    // Batch contribution profile fetch when profileId is known at fetch time.
    // Returns the row (or null = not found) when profileId is provided; undefined when
    // profileId is absent. buildEnginePayload checks for undefined to decide whether to
    // fall back to the async fetch (backward compat for callers that don't pass profileId here).
    opts?.contributionProfileId
      ? db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, opts.contributionProfileId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(undefined as undefined),
    // Same batching for the independent Salary Profile axis.
    opts?.salaryProfileId
      ? db
          .select()
          .from(schema.salaryProfiles)
          .where(eq(schema.salaryProfiles.id, opts.salaryProfileId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(undefined as undefined),
    // Withdrawal-ordering eligibility:
    // which job funds which performance account. Deliberately unfiltered —
    // no isActive filter — a separated employer's contribution-account link
    // is exactly the one likely to be inactive, and it's exactly the
    // evidence Rule of 55 needs to see. Same query tax-buckets.ts's
    // computeBreakdown procedure uses; kept identical rather than reusing
    // allContribsRaw, which IS isActive-filtered and would silently drop
    // dormant former-employer plans.
    db
      .select({
        performanceAccountId: schema.contributionAccounts.performanceAccountId,
        jobId: schema.contributionAccounts.jobId,
      })
      .from(schema.contributionAccounts),
    db.select().from(schema.accountBasis),
    // The Default preset's glide path and which classes are stocks — VPW
    // sizes its percentage by the stock share (lib/pure/simulation/stock-share.ts). A
    // Simulation run replaces this with its own preset's.
    loadSimulationPreset(db, DEFAULT_SIMULATION.preset),
    db.select().from(schema.assetClassBuckets),
  ]);
  return {
    people,
    allJobs,
    retSettings,
    retProfiles,
    retProfilePeople,
    retScenarios,
    returnRates,
    allContribsRaw,
    allLimits,
    snapshotData,
    salaryOverrideRows,
    budgetOverrideRows,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    allTaxBrackets,
    allLtcgBrackets,
    allIrmaaBrackets,
    allFplByHousehold,
    allTaxParams,
    brokerageGoalRows,
    allAppSettings,
    contribProfileRow,
    salaryProfileRow,
    jobLinkRows,
    accountBasisRows,
    defaultPreset,
    classBucketRows,
  };
}

/**
 * Build the shared engine payload from raw DB data.
 *
 * Returns all computed intermediate values plus a "base" engine input object
 * (without accumulationOverrides, decumulationOverrides, or decumulationDefaults —
 * those differ between callers).
 */
export async function buildEnginePayload(
  db: Db,
  data: Awaited<ReturnType<typeof fetchRetirementData>>,
  opts: {
    contributionProfileId?: number;
    salaryProfileId?: number;
    accumulationBudgetProfileId?: number;
    accumulationBudgetColumn?: number;
    accumulationExpenseOverride?: number;
    decumulationBudgetProfileId?: number;
    decumulationBudgetColumn?: number;
    decumulationExpenseOverride?: number;
    /** View a non-active retirement profile without making it the
     *  household's globally-active one — same "view without activating"
     *  contract contributionProfileId/salaryProfileId already have here.
     *  Retirement Profiles phase 4 (the assumptions band). Ignored (falls
     *  back to the active-profile resolution) if it doesn't name a real
     *  profile — a stale id from a deleted profile must never silently
     *  compute against nothing. */
    retirementProfileId?: number;
    /** What-if: everyone retires this many years later (negative: sooner).
     *  Applied before the timeline, so every window built from it moves
     *  too; the saved settings are untouched. */
    retirementAgeDelta?: number;
  },
) {
  const {
    people,
    allJobs,
    retSettings,
    retProfiles,
    retProfilePeople,
    retScenarios,
    returnRates,
    allContribsRaw,
    allLimits,
    snapshotData,
    salaryOverrideRows,
    budgetOverrideRows,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    allTaxBrackets,
    allLtcgBrackets,
    allIrmaaBrackets,
    allFplByHousehold,
    allTaxParams,
    brokerageGoalRows,
    allAppSettings,
    jobLinkRows,
    accountBasisRows,
    defaultPreset,
    classBucketRows,
  } = data;

  // All active contribution accounts feed the engine (both Retirement and Portfolio).
  // Pages filter output by parentCategory on individualAccountBalances.
  // When a contribution profile is selected, apply its overrides to the raw rows.
  // If the caller passed contributionProfileId to fetchRetirementData, the profile
  // row is already batched in data.contribProfileRow (undefined = not fetched; use async
  // fallback for backward-compat). When pre-fetched, the sync path avoids a serial round-trip.
  // Salary Profile resolved up front — both the Contribution Profile
  // application below (jobs now carry their pay-schedule/W-4 fields via the
  // Salary Profile, not raw `jobs` columns) and the salary math further
  // down need it.
  const salaryProfileActiveMap =
    data.salaryProfileRow !== undefined
      ? applySalaryProfileRow(data.salaryProfileRow)
      : await loadEffectiveSalaryProfile(db, opts.salaryProfileId);

  const contribProfileResult =
    data.contribProfileRow !== undefined
      ? applyContribProfileRow(
          data.contribProfileRow,
          allContribsRaw,
          allJobs,
          salaryProfileActiveMap,
        )
      : await loadAndApplyContribProfile(
          db,
          opts.contributionProfileId,
          allContribsRaw,
          allJobs,
          salaryProfileActiveMap,
        );
  const allContribs = contribProfileResult.contribs;
  const patchedJobs = contribProfileResult.jobs;

  const primaryPerson = getPrimaryPerson(people);
  if (!primaryPerson) return null;

  // Household assumptions now come from the ACTIVE PROFILE's row, not from
  // whichever person happens to be primary. Same values today (step A's
  // backfill pointed every existing row at "Current Plan"), but it's what
  // makes profiles swappable — and it removes the trap where a household
  // field edited against a non-primary person wrote successfully and was
  // then never read.
  const activeProfileId =
    opts.retirementProfileId != null &&
    retProfiles.some((p) => p.id === opts.retirementProfileId)
      ? opts.retirementProfileId
      : resolveRetirementProfileIdFrom(allAppSettings, retProfiles);
  // pickProfileSettingsRow prefers the PRIMARY person's row within the
  // profile — see its docblock. During the expand phase every person's row
  // shares the profile id, and those rows can legitimately disagree on
  // household columns, so an arbitrary match moves real numbers.
  const settings = pickProfileSettingsRow(
    retSettings,
    activeProfileId,
    primaryPerson.id,
  );
  if (!settings) return null;

  // This year's return, and retirement years' (the profile's, or "Auto" =
  // this year's) — lib/pure/tax/filing-status.ts. Nothing known: the cautious
  // fallback, and the household is asked (a recommendation).
  const profileStatus = storedProfileFilingStatus(settings.filingStatus);
  const thisYearFiling = await thisYearFilingStatus(db, {
    appSettings: allAppSettings,
    profileStatus,
    people,
    salaryProfileActiveMap,
  });
  const filingStatus = retirementFilingStatus(
    profileStatus,
    thisYearFiling.status,
  );

  // Every per-year tax slice (withholding brackets, contribution
  // limits + standard/senior deductions, LTCG brackets, IRMAA brackets,
  // FPL) is resolved through ONE call, anchored on ONE year.
  //
  // requestedYear: the active retirement profile's pin (`tax_params_year`,
  // null ⇒ newest enacted). Historical portfolio snapshots price tax off
  // current data too, not the snapshot's year.
  // `onMissing: "nearest"` — a projection uses this as a base year then
  // grows it forward, so an unseeded pin year falls back to the newest
  // earlier year rather than throwing.
  const activeProfile = retProfiles.find((p) => p.id === activeProfileId);
  const requestedTaxYear = activeProfile?.taxParamsYear ?? undefined;
  const resolvedTax = resolveTaxParams(
    {
      vintage: allTaxParams,
      contributionLimits: allLimits,
      withholdingBrackets: allTaxBrackets,
      ltcgBrackets: allLtcgBrackets,
      irmaaBrackets: allIrmaaBrackets,
      fpl: allFplByHousehold,
    },
    requestedTaxYear,
    // Each table from its own newest complete year (a new year's limits
    // can land before its withholding/IRMAA/FPL tables) — the engine grows
    // each from that year.
    { onMissing: "nearest", sectionFallback: true },
  );
  const latestTaxYear = resolvedTax.resolvedYear;
  // No complete year of a table at all means an emptied table — the
  // tax-data file is applied on every start and after any restore, and
  // shipped rows can't be deleted. Nothing stands in for a missing table:
  // a projection without one would quietly price that tax at a guess.
  const sectionNames: Record<TaxSection, string> = {
    withholding: "withholding tables (Tax Brackets)",
    ltcg: "capital-gains brackets (LTCG Brackets)",
    irmaa: "Medicare brackets (IRMAA Tables)",
    fpl: "poverty levels (ACA/FPL)",
  };
  const missingSections = resolvedTax.missing ?? [];
  const ltcgBracketData = resolvedTax.ltcgByStatus;
  const irmaaBracketData = resolvedTax.irmaaByStatus;
  const fplByHouseholdData = resolvedTax.fplByHousehold;
  if (
    missingSections.length > 0 ||
    !ltcgBracketData ||
    !irmaaBracketData ||
    !fplByHouseholdData
  )
    throw new Error(
      `Tax data is missing: no complete year of ${
        missingSections.map((s) => sectionNames[s]).join(", ") || "a tax table"
      } (Settings → Reference Data).`,
    );

  // A complete year has every status's table: never a guessed empty one.
  const withholding = resolvedTax.withholdingBrackets?.[filingStatus]?.false;
  if (!withholding) throw new Error(`No ${filingStatus} withholding table.`);
  const bracketData = withholding as {
    threshold: number;
    baseWithholding: number;
    rate: number;
  }[];

  // Per-person retirement settings (for per-person age display + editing)
  // Per-person assumptions come from the active profile's own child rows.
  //
  // The `?? settings.X` fallbacks that used to be here are GONE, deliberately.
  // They existed because retirement_settings was per-person and a person might
  // have no row; step A's backfill materialised a row for every person in
  // every profile (the completeness invariant), populated from exactly what
  // those fallbacks resolved to — so removing them changes nothing today and
  // stops "person has no row" from silently inheriting stale household values.
  // If a row really is missing, fall back to the profile's own household
  // values rather than returning null, so a page renders instead of blanking.
  const profilePeople = retProfilePeople.filter(
    (r) => r.profileId === activeProfileId,
  );
  // Primary person's raise rate — the fallback every other person inherits
  // when they have no `retirement_settings` row in the active profile at
  // all (not when their row holds an explicit 0 — 0% is a real, meaningful
  // rate, e.g. someone at a salary cap or modeling a freeze; treating it as
  // "unset" silently overwrote it with the primary's rate, defeating the
  // per-person raise-rate control). Computed here so BOTH
  // `perPersonSettings` (below, for the per-person UI control) and
  // `raiseRateByPerson` (further down, for salary-override growth) resolve
  // the effective rate the same way — one decision, one code path.
  const primaryRaiseRate = toNumber(settings.salaryAnnualIncrease);
  const perPersonSettings = people.map((p) => {
    const pp = profilePeople.find((r) => r.personId === p.id);
    // Only this profile's row: another profile's values never stand in.
    // With no profile at all (null), every row has a null profile id.
    const ps =
      pp ??
      retSettings.find(
        (s) => s.personId === p.id && s.profileId === activeProfileId,
      );
    // salary_annual_increase DOES exist as a column on retirement_profile_people
    // (migration 0032 backfilled it, profile duplication clones it) — but
    // nothing reads or writes it there; `pp` above is never used for this
    // field. retirement_settings stays the live source, genuinely per
    // (profile, person). Scope to the active profile so a household with
    // 2+ profiles doesn't pick an arbitrary one's rate (same fix the
    // raiseRateByPerson docblock records).
    const rsRowForRaise = retSettings.find(
      (s) => s.personId === p.id && s.profileId === activeProfileId,
    );
    const parsedRaiseRate = rsRowForRaise
      ? toNumber(rsRowForRaise.salaryAnnualIncrease)
      : NaN;
    const effectiveRaiseRate = Number.isFinite(parsedRaiseRate)
      ? parsedRaiseRate
      : primaryRaiseRate;
    return {
      personId: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
      retirementAge:
        (ps?.retirementAge ?? settings.retirementAge) +
        (opts.retirementAgeDelta ?? 0),
      endAge: ps?.endAge ?? settings.endAge,
      // Effective pre-retirement raise rate for THIS person. A person with
      // no retirement_settings row in the active profile at all shows the
      // primary's rate here; a person with a row (including an explicit 0)
      // shows their own — the per-person control edits this effective
      // value directly.
      salaryAnnualIncrease: String(effectiveRaiseRate),
      // Still read from THIS person's own retirement_settings row, not from
      // the profile's. The field is dead (the client's PerPersonSettings type
      // doesn't carry it and nothing writes it back), but rows can disagree
      // on it, so sourcing it differently would move a value in the response
      // for no benefit. Removing it is its own change, not a ride-along in a
      // behaviour-neutral migration.
      withdrawalRate:
        retSettings.find(
          (s) => s.personId === p.id && s.profileId === activeProfileId,
        )?.withdrawalRate ?? settings.withdrawalRate,
      socialSecurityMonthly:
        ps?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
      // PIA (benefit at FRA) — opt-in, no household-level fallback (decision
      // #5 in SOCIAL-SECURITY-OPTIMIZATION-PLAN.md: unlike every other field
      // here, an unset PIA on this person's row does NOT fall back to
      // `settings`, since a household-wide PIA makes no sense — PIA is
      // inherently per-person, computed from an individual's own earnings
      // record. null means "not opted in," not "use the household default."
      // Read from `pp` specifically (the retirement_profile_people row),
      // not the wider `ps` union — `ps`'s fallback (a bare
      // retirement_settings row) has no PIA column at all; there's no
      // household-grain equivalent to fall back to.
      socialSecurityPia: pp?.socialSecurityPia ?? null,
      ssStartAge: ps?.ssStartAge ?? settings.ssStartAge,
      ruleOf55Override: ps?.ruleOf55Override ?? settings.ruleOf55Override,
    };
  });

  // When a historical snapshot is selected, use its date as the reference point
  const referenceDate = data.snapshotData?.snapshot.snapshotDate
    ? new Date(data.snapshotData.snapshot.snapshotDate)
    : new Date();
  const currentYear = referenceDate.getFullYear();

  // Budget profile summaries (for budget override "from profile" UI) — each
  // linked item's dollar amount resolved through the same contribution-
  // account chain computeActiveSummary uses (see resolveLinkedBudgetItemAmounts),
  // not the raw `amounts` column, which is intentionally left stale for
  // linked items and would silently undercount them here.
  const budgetProfileSummaries = await Promise.all(
    allBudgetProfiles.map(async (p) => {
      const items = allBudgetItems.filter((i) => i.profileId === p.id);
      const labels = p.columnLabels as string[];
      const months = (p.columnMonths as number[] | null) ?? null;
      const numColumns = labels.length;
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        db,
        items,
        numColumns,
        {
          contribProfileId: opts.contributionProfileId ?? null,
          salaryProfileId: opts.salaryProfileId ?? null,
        },
      );
      const totals = labels.map((_: string, colIdx: number) =>
        sumBy(resolvedItems, (item) => item.amounts[colIdx] ?? 0),
      );
      const weightedAnnualTotal = months
        ? roundToCents(
            sumBy(
              totals.map((t, i) => t * (months[i] ?? 0)),
              (v) => v,
            ),
          )
        : null;
      return {
        id: p.id,
        name: p.name,
        isActive: p.isActive,
        columnLabels: labels,
        columnMonths: months,
        columnTotals: totals,
        weightedAnnualTotal,
      };
    }),
  );

  // Salary comes from the Salary Profile (salaryProfileActiveMap, resolved
  // above); the Contribution Profile contributes no salary — the two are
  // independent.
  const asOfDate = referenceDate;
  // Each person's current job, or the next one they start; its dates bound
  // the years it's worked (workingYearsByPerson, below).
  const activeJobs = projectionJobs(patchedJobs, asOfDate);
  // Every date in the plan, from each person's own age and dates.
  const timeline = householdTimeline({
    people: perPersonSettings,
    primaryPersonId: primaryPerson.id,
    earnerIds: activeJobs.map((j) => j.personId),
    baseYear: currentYear,
  });
  const age = timeline.currentAge;
  const planDates = { ...timeline, asOfDate };
  const workingYearsByPerson = Object.fromEntries(
    activeJobs.flatMap((j) => {
      const w = workingYears(j, asOfDate);
      return w ? [[j.personId, w] as const] : [];
    }),
  );
  // Uses getSalariesForJobs helper (deduplicates the parallel-fetch pattern).
  // Post-process to compute totalComp. A Salary Profile entry is now a complete, all-or-nothing
  // number (see resolveCompensation's docblock) — there is no more
  // "resolved actual vs full-formula" distinction to adjust for (job_bonus_
  // overrides is gone), so currentYearBonusAdjustment is always empty; kept
  // in the payload shape as a no-op rather than removed, since the engine
  // still reads it defensively.
  const currentYearBonusAdjustmentByPerson = new Map<number, number>();
  const jobSalaries = activeJobs.map((job) => {
    const comp = resolveCompensation(salaryProfileActiveMap, job.id);
    const salary = comp.salary;
    const bonusTerms = comp.terms;
    const totalComp = getTotalCompensation(salary, bonusTerms);
    return {
      job,
      // Base salary + the bonus (each account takes from it only when set
      // to, fromBonus; the formula bonus — the projection grows it forward).
      ...contributionPay(salary, bonusTerms),
      // This year's — the pinned bonus when there is one — for this year's
      // contribution lines (display specs), never for growth.
      bonusGrossThisYear: contributionPay(
        salary,
        bonusTerms,
        comp.bonusOverride,
      ).bonusGross,
      totalComp,
      totalCompFullFormula: totalComp,
    };
  });
  // combinedSalary = base salaries — the payroll basis percent-of-pay
  // contributions and the match are figured on (bonus checks: contributionPay)
  // totalCompensation = always includes bonus (resolved/pinned, not full-formula)
  // — used for display and "as of now" rate calculations.
  const totalCompensation = sumBy(jobSalaries, (js) => js.totalComp);
  // The engine's compounding baseline — full-formula bonus, see
  // currentYearBonusAdjustmentByPerson's docblock above.
  const totalCompensationFullFormula = sumBy(
    jobSalaries,
    (js) => js.totalCompFullFormula,
  );

  // Portfolio by tax bucket + per-account balances (combined for engine).
  // Shared with the Tax Buckets analysis tool — see src/lib/pure/accounts/tax-buckets.ts.
  const taxBucketBreakdown = computeTaxBucketBreakdown(
    snapshotData,
    people,
    perfAccounts,
  );
  const {
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
  } = taxBucketBreakdown;

  // Where reinvested RMD money goes (Retirement settings): the chosen
  // Retirement brokerage, else every Retirement brokerage — never a
  // Portfolio account. With no Retirement brokerage, a projection-only one
  // holds that money and contribution overflow.
  const rmdTarget = resolveRmdExcessTarget({
    targetPerformanceAccountId:
      settings.rmdExcessTargetPerformanceAccountId ?? null,
    reinvest: settings.rmdExcessHandling !== "spend",
    entries: Object.entries(accountBreakdownByCategory).flatMap(
      ([category, accts]) => accts.map((a) => ({ ...a, category })),
    ),
    perfAccounts,
  });
  // Brokerages holding money with no cost basis: the projection taxes every
  // dollar drawn from them as a gain — say so (0 also means "not entered").
  const basisWarnings = [
    ...new Set(
      findMissingCostBasis(
        Object.entries(accountBreakdownByCategory).flatMap(
          ([category, accts]) =>
            accts
              .filter((a) => a.costBasis != null)
              .map((a) => ({
                category,
                name: a.name,
                balance: a.amount,
                costBasis: a.costBasis!,
              })),
        ),
      ).map((a) => missingCostBasisWarning(a.name)),
    ),
  ];
  const viewingFallbackProfile =
    activeProfileId !== opts.retirementProfileId &&
    retirementProfileIsFallback(allAppSettings, retProfiles);
  const inputWarnings = [
    ...(viewingFallbackProfile
      ? [
          `No active retirement profile is set, so this uses ${retProfiles.find((p) => p.id === activeProfileId)?.name}. Choose one in the Retirement profiles.`,
        ]
      : []),
    ...(rmdTarget.warning ? [rmdTarget.warning] : []),
    ...basisWarnings,
  ];
  const personNameById = new Map(people.map((p) => [p.id, p.name]));

  const birthYearByPersonId = new Map(
    perPersonSettings.map((p) => [p.personId, p.birthYear]),
  );
  // Rule of 55 forecasting override -- see
  // IndividualAccountInput.ruleOf55ForceIneligible's docblock for the full
  // contract. Only ever set true (never false) below, so a household not
  // using this feature gets a byte-identical engine input.
  const ruleOf55OverrideByPerson = new Map(
    perPersonSettings.map((p) => [p.personId, p.ruleOf55Override]),
  );
  // When each person's still-active job ends (Rule of 55): their own
  // planned retirement year.
  const retirementYearByPersonId = new Map(
    perPersonSettings.flatMap((ps) => {
      const birthYear = birthYearByPersonId.get(ps.personId);
      return birthYear != null
        ? [[ps.personId, birthYear + ps.retirementAge] as const]
        : [];
    }),
  );
  const individualAccounts = buildIndividualAccounts({
    allJobs,
    jobLinkRows,
    accountBasisRows,
    perfAccounts,
    people,
    asOfDate,
    taxBucketBreakdown,
    birthYearByPersonId,
    retirementYearByPersonId,
    ruleOf55OverrideByPerson,
    rmdTarget,
  });
  const settingsMap = new Map(
    allAppSettings.map((s: { key: string; value: unknown }) => [
      s.key,
      s.value,
    ]),
  );
  const rampRaw = settingsMap.get("brokerage_contribution_increase");
  const brokerageContributionRamp =
    rampRaw != null && rampRaw !== "null" && rampRaw !== '"0"'
      ? toNumber(String(rampRaw).replace(/"/g, ""))
      : 0;
  // Settable in Settings → Reference Data → Return Rates; falls back to the
  // constant when unset. This is the single read point, so bound it here
  // rather than special-casing the generic appSettings.upsert: a NaN/garbage
  // value (empty string, bad manual edit) or an out-of-range one (an admin
  // writing `5` via the data browser) would otherwise compound through
  // Math.pow(1 + rate, year) and silently wreck every projection.
  const limitGrowthRaw = settingsMap.get(SK_IRS_LIMIT_GROWTH_RATE);
  const limitGrowthParsed = toNumber(String(limitGrowthRaw));
  let irsLimitGrowthRate = IRS_LIMIT_GROWTH_RATE;
  if (limitGrowthRaw != null && Number.isFinite(limitGrowthParsed)) {
    irsLimitGrowthRate = Math.min(
      Math.max(limitGrowthParsed, 0),
      IRS_LIMIT_GROWTH_RATE_MAX,
    );
    if (irsLimitGrowthRate !== limitGrowthParsed) {
      // A stored value outside [0, MAX] is used clamped — record it so the
      // stored-vs-used divergence is findable rather than silent.
      log("warn", "irs_limit_growth_rate_clamped", {
        stored: limitGrowthParsed,
        used: irsLimitGrowthRate,
      });
    }
  }

  // IRS limits — the `contribution_limits` rows for the resolved tax year
  // (resolveTaxParams already filtered + coerced to numbers). Same
  // map shape as the old `for (const l of allLimits)` loop.
  const limitsMap: Record<string, number> = resolvedTax.limits;

  // Per-person account types for limit aggregation.
  // A jobless row is "active" if it's tied to a currently-known person, OR
  // if personId is null — which (per the ownership/personId invariant
  // enforced in settings/paycheck.ts) only ever means a joint account, not
  // a data error. Without the null case, joint jobless contributions
  // (e.g. a joint brokerage account with no linked job) would silently
  // drop out of activeContribs entirely once their personId is cleared,
  // excluding their contribution amount from every downstream total this
  // function computes.
  // The IRS-limit cap pass runs on every set of effective rows — these and
  // each profile switch's — so every figure reads the capped value.
  const irsLimitPeople = people.map((p) => ({
    id: p.id,
    birthYear: birthYearByPersonId.get(p.id) ?? null,
  }));
  // This year's caps follow this year's return (the household setting),
  // as the paycheck's do; the projection's brackets keep the profile's.
  const capFilingStatus = thisYearFiling.status ?? "";
  const capHousehold: CapPassHousehold = {
    people: irsLimitPeople,
    limits: limitsMap,
    filingStatus: capFilingStatus,
    taxYear: currentYear,
  };
  const activeContribs = capEffectiveContribs(
    allContribs
      .filter(
        (c) =>
          activeJobs.some((j) => j.id === c.jobId) ||
          (c.jobId === null &&
            (c.personId === null || people.some((p) => p.id === c.personId))),
      )
      .map((c) => ({ ...c, accountType: c.accountType as AccountCategory })),
    { ...capHousehold, activeJobs, jobSalaries },
  );
  // Who holds which limited account, and each limit group's household
  // limit from it (every shared limit counted once) — the totals the pages
  // show, and what the engine sizes limits from without specs.
  const irsLimitAccounts = activeContribs
    .filter((c) => getAccountTypeConfig(c.accountType).hasIrsLimit)
    .map((c) => ({
      personId: c.personId,
      accountType: c.accountType,
      hsaCoverageType: c.hsaCoverageType ?? null,
    }));
  const irsGroupLimits = Object.fromEntries(
    accountGroupLimits(irsLimitAccounts, {
      taxYear: currentYear,
      filingStatus: capFilingStatus,
      limits: limitsMap,
      people: irsLimitPeople.map((p) => ({ ...p, wages: null })),
    }),
  );
  // Aggregate contributions and employer match by category (shared helper — single pass)
  const {
    contribByCategory,
    employerMatchByCategory,
    retirementOnly: retirementContrib,
  } = aggregateContributionsByCategory(activeContribs, activeJobs, jobSalaries);

  // Build per-person salary map from job salaries — the engine's compounding
  // baseline, so full-formula bonus (see totalCompFullFormula's docblock
  // above), not the resolved/pinned current-year value.
  const salaryByPerson: Record<number, number> = {};
  for (const js of jobSalaries) {
    salaryByPerson[js.job.personId] =
      (salaryByPerson[js.job.personId] ?? 0) + js.totalCompFullFormula;
  }
  const hasMultiplePeople = Object.keys(salaryByPerson).length > 1;
  // With one earner, salary runs at the household level on that person's
  // terms — who may not be the primary person.
  const earnerIds = Object.keys(salaryByPerson).map(Number);
  const soleEarnerId =
    earnerIds.length === 1 ? earnerIds[0]! : primaryPerson.id;

  // Separate salary overrides: profile-switch overrides vs plain salary
  // overrides. A row is a profile switch if it references EITHER axis — the
  // Contribution Profile and the Salary Profile are independent pins, so a
  // row may carry one, the other, or both.
  const plainSalaryOverrides = salaryOverrideRows.filter(
    (o) => !o.contributionProfileId && !o.salaryProfileId,
  );
  const profileSwitchOverrides = salaryOverrideRows.filter(
    (o) => !!o.contributionProfileId || !!o.salaryProfileId,
  );

  // Salary overrides from DB — household-level fallback (only when single person)
  const dbSalaryOverrides = plainSalaryOverrides
    .filter((o) => !hasMultiplePeople && o.personId === soleEarnerId)
    .map((o) => ({
      year: o.projectionYear,
      value: toNumber(o.overrideSalary),
      notes: o.notes ?? undefined,
    }));

  // Per-person salary overrides (all people) — excludes profile-switch rows
  const perPersonSalaryOverrides = plainSalaryOverrides.map((o) => ({
    personId: o.personId,
    year: o.projectionYear,
    value: toNumber(o.overrideSalary),
  }));

  const { switchProfileMap, switchSalaryProfileMap } = await loadSwitchProfiles(
    db,
    profileSwitchOverrides,
  );

  // Budget overrides from DB (stored as monthly, engine expects monthly too)
  const dbBudgetOverrides = budgetOverrideRows
    .filter((o) => o.personId === primaryPerson.id)
    .map((o) => ({
      year: o.projectionYear,
      value: toNumber(o.overrideMonthlyBudget),
      notes: o.notes ?? undefined,
    }));

  // Return rates — include the floor rate (highest age ≤ current age) so the
  // engine always has a rate for the starting year, plus all future rates.
  const floorRate = returnRates
    .filter((r) => r.age <= age)
    .sort((a, b) => b.age - a.age)[0];
  const relevantReturnRates = returnRates
    .filter((r) => r.age >= age || (floorRate && r.age === floorRate.age))
    .map((r) => ({ label: `Age ${r.age}`, rate: toNumber(r.rateOfReturn) }));

  // Expenses — phase-based budget columns
  const selectedScenario = retScenarios.find((s) => s.isSelected);
  const globalColSetting = settingsMap.get(SK_BUDGET_ACTIVE_COLUMN);
  const globalActiveCol =
    typeof globalColSetting === "number" ? globalColSetting : 0;
  const {
    accProfile,
    accCol,
    decProfile,
    decCol,
    accumulationExpenses,
    accumulationContributionLines,
    decumulationExpenses,
  } = await resolvePhaseExpenses(db, {
    allBudgetProfiles,
    allBudgetItems,
    globalActiveCol,
    opts,
  });
  const annualExpensesVal = accumulationExpenses;
  const expenseEndings = await loadExpenseEndings(db, {
    items: allBudgetItems,
    accumulation: {
      profileId: accProfile?.id,
      column: accCol,
      months: (accProfile?.columnMonths as number[] | null) ?? null,
      annual: accumulationExpenses,
      typed: !!opts.accumulationExpenseOverride,
    },
    decumulation: {
      profileId: decProfile?.id,
      column: decCol,
      months: (decProfile?.columnMonths as number[] | null) ?? null,
      annual: decumulationExpenses,
      typed: !!opts.decumulationExpenseOverride,
    },
    asOfDate,
  });

  // Build parentCategory lookup for contribution accounts (via linked performance account)
  const perfCategoryMap = new Map(
    perfAccounts.map((p) => [p.id, p.parentCategory]),
  );

  // Performance account lookup for contribution display names (keyed by id)
  const perfAccountMap = new Map(perfAccounts.map((p) => [p.id, p]));

  // Shared context for spec building (used by both default profile and profile switches)
  const perfRetirementBehaviorMap = new Map(
    perfAccounts.map((p) => [
      p.id,
      p.retirementBehavior ?? "stops_at_owner_retirement",
    ]),
  );
  const perfContributionScalingMap = new Map(
    perfAccounts.map((p) => [
      p.id,
      p.contributionScaling ?? "scales_with_salary",
    ]),
  );
  const profileContribCtx = {
    perfCategoryMap,
    perfRetirementBehaviorMap,
    perfContributionScalingMap,
    personNameById,
    accountBreakdownByCategory,
  };

  // Build per-account contribution specs via shared helper (single source of truth)
  const toContribDataRow = (c: (typeof activeContribs)[number]) => ({
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    accountType: c.accountType as AccountCategory,
    subType: c.subType,
    label: c.label ?? null,
    parentCategory: c.parentCategory ?? null,
    contributionMethod: c.contributionMethod,
    contributionValue: c.contributionValue,
    taxTreatment: c.taxTreatment,
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue,
    employerMaxMatchPct: c.employerMaxMatchPct,
    isPayrollDeducted: c.isPayrollDeducted,
    fromBonus: c.fromBonus,
    performanceAccountId: c.performanceAccountId,
    targetAnnual: c.targetAnnual,
    allocationPriority: c.allocationPriority,
    hsaCoverageType: c.hsaCoverageType,
    capPassed: c.capPassed,
    cappedValue: c.cappedValue,
    cap: c.cap,
  });
  const contribDataJobs = activeJobs.map((j) => ({
    id: j.id,
    personId: j.personId,
    payPeriod: j.payPeriod,
  }));
  const defaultContribData = buildProfileContribData(
    activeContribs.map(toContribDataRow),
    contribDataJobs,
    jobSalaries,
    profileContribCtx,
  );
  const contributionSpecs = defaultContribData.contributionSpecs;

  const lastAccumulationYear = timeline.retirementYear - 1;
  const { profileSwitches, perPersonSalaryAdds, householdSalaryAdds } =
    buildProfileSwitches({
      profileSwitchOverrides,
      switchProfileMap,
      switchSalaryProfileMap,
      allContribsRaw,
      activeJobs,
      salaryProfileActiveMap,
      perPersonSettings,
      primaryRaiseRate,
      currentYear,
      hasMultiplePeople,
      profileContribCtx,
      capHousehold,
      lastAccumulationYear,
    });
  // The active profile, capped at each later year's ages until the first
  // Contribution Profile switch: a year whose ages cap it differently
  // (catch-up room from 50, the larger one at 60–63, the smaller again
  // from 64) switches to it capped then.
  const firstContribSwitchYear = Math.min(
    ...profileSwitchOverrides
      .filter(
        (o) =>
          o.contributionProfileId &&
          switchProfileMap.has(o.contributionProfileId),
      )
      .map((o) => o.projectionYear),
  );
  const activeAgeSteps = capAgeSteps(
    activeContribs,
    { ...capHousehold, activeJobs, jobSalaries },
    currentYear,
    Math.min(firstContribSwitchYear - 1, lastAccumulationYear),
  )
    .slice(1)
    .map((step) =>
      profileSwitchFrom(
        step.year,
        step.capped.map(toContribDataRow),
        { activeJobs: contribDataJobs, jobSalaries },
        profileContribCtx,
      ),
    );
  profileSwitches.push(...activeAgeSteps);
  profileSwitches.sort((a, b) => a.year - b.year);
  // A switch row that pins a salary adds to the salary overrides, after
  // the plain rows — the order the engine has always received them in.
  perPersonSalaryOverrides.push(...perPersonSalaryAdds);
  dbSalaryOverrides.push(...householdSalaryAdds);

  // Derive accumulation defaults from real paycheck/contribution data
  const totalRealContrib = sumBy(
    Object.values(contribByCategory),
    (c) => c.annual,
  );
  // Retirement contribution rate on total compensation (bonus included),
  // retirement contributions only: the engine's rate ceiling leaves Portfolio
  // savings alone, so the rate it caps against must not count them either.
  const displayContribRate = safeDivide(
    retirementContributions(contributionSpecs),
    totalCompensation,
    0,
  );

  // Account splits derived from actual contribution amounts
  const noContribData = totalRealContrib <= 0;
  const splitsOf = (summaries: typeof contribByCategory) => {
    const total = sumBy(Object.values(summaries), (c) => c.annual);
    return {
      accountSplits: Object.fromEntries(
        getAllCategories().map((cat) => [
          cat,
          total > 0 ? summaries[cat].annual / total : 0,
        ]),
      ) as Record<AccountCategory, number>,
      taxSplits: Object.fromEntries(
        categoriesWithTaxPreference().map((cat) => [
          cat,
          summaries[cat].rothFraction,
        ]),
      ) as Partial<Record<AccountCategory, number>>,
    };
  };
  const realSplits = splitsOf(contribByCategory);
  const realAccountSplits = realSplits.accountSplits;

  // Same rule as a profile switch's rate: a household that contributes but
  // not to retirement money has a 0% retirement rate (the fallback would
  // invent 25% of salary wherever the rate path runs — Simple tax mode with
  // only Portfolio specs); only missing data falls back.
  const derivedAccumulationDefaults = {
    contributionRate:
      displayContribRate > 0
        ? displayContribRate
        : contributionSpecs.length > 0 && totalCompensation > 0
          ? 0
          : FALLBACK_CONTRIBUTION_RATE,
    routingMode: "waterfall" as const,
    accountOrder: getDefaultAccumulationOrder(),
    accountSplits: realAccountSplits,
    taxSplits: realSplits.taxSplits,
  };

  // Simple tax mode's retirement-only inputs (lib/pure/tax/simple-tax-mode.ts).
  const simpleTaxMode: SimpleTaxModeParts = {
    retirementBuckets: Object.entries(portfolioByTaxTypeByParentCat)
      .filter(([parent]) => isRetirementMoney(parent))
      .reduce(
        (t, [, b]) => ({
          preTax: t.preTax + b.preTax,
          taxFree: t.taxFree + b.taxFree,
          hsa: t.hsa + b.hsa,
          afterTax: t.afterTax + b.afterTax,
          afterTaxBasis: t.afterTaxBasis + b.afterTaxBasis,
        }),
        { ...emptyTaxBucketMap(), afterTaxBasis: 0 },
      ),
    defaults: {
      ...defaultContribData.retirementOnly,
      ...splitsOf(retirementContrib.contribByCategory),
    },
  };

  const distributionTaxRates = buildDistributionTaxRates({
    settings,
    filingStatus,
    limitsMap,
    bracketData,
    ltcgBracketData,
    irmaaBracketData,
    fplByHousehold: fplByHouseholdData,
    latestTaxYear,
    sectionYears: resolvedTax.sectionYears,
    taxParamsVersion: resolvedTax.version,
    accumulationExpenses,
    decumulationExpenses,
    annualExpensesVal,
  });

  // Base engine input (without accumulationOverrides, decumulationOverrides, decumulationDefaults)
  const baseEngineInput = {
    accumulationDefaults: derivedAccumulationDefaults,
    currentAge: age,
    retirementYear: timeline.retirementYear,
    retirementYearByPerson: hasMultiplePeople
      ? timeline.retirementYearByPerson
      : undefined,
    projectionEndYear: timeline.projectionEndYear,
    payrollTax:
      limitsMap.fica_ss_rate !== undefined &&
      limitsMap.fica_medicare_rate !== undefined &&
      limitsMap.ss_wage_base !== undefined
        ? {
            socialSecurityRate: limitsMap.fica_ss_rate,
            medicareRate: limitsMap.fica_medicare_rate,
            socialSecurityWageBase: limitsMap.ss_wage_base,
          }
        : undefined,
    budgetContributionLines: accumulationContributionLines,
    currentSalary: totalCompensationFullFormula,
    salaryGrowthRate: toNumber(
      (soleEarnerId !== primaryPerson.id
        ? perPersonSettings.find((p) => p.personId === soleEarnerId)
        : undefined
      )?.salaryAnnualIncrease ?? settings.salaryAnnualIncrease,
    ),
    salaryGrowthRateByPerson: hasMultiplePeople
      ? Object.fromEntries(
          perPersonSettings.map((p) => [
            p.personId,
            toNumber(p.salaryAnnualIncrease),
          ]),
        )
      : undefined,
    salaryCap: settings.salaryCap ? toNumber(settings.salaryCap) : null,
    salaryOverrides: dbSalaryOverrides,
    salaryByPerson: hasMultiplePeople ? salaryByPerson : undefined,
    workingYearsByPerson:
      Object.keys(workingYearsByPerson).length > 0
        ? workingYearsByPerson
        : undefined,
    perPersonSalaryOverrides: hasMultiplePeople
      ? perPersonSalaryOverrides
      : undefined,
    currentYearBonusAdjustment:
      currentYearBonusAdjustmentByPerson.size > 0
        ? Object.fromEntries(currentYearBonusAdjustmentByPerson)
        : undefined,
    budgetOverrides: dbBudgetOverrides,
    irsLimitCaps: {
      limits: limitsMap,
      people: irsLimitPeople,
      filingStatus,
      accounts: irsLimitAccounts,
    },
    limitGrowthRate: irsLimitGrowthRate,
    employerMatchRateByCategory: defaultContribData.employerMatchRateByCategory,
    contributionSpecs,
    baseYearContributions: defaultContribData.baseYearContributions,
    baseYearEmployerMatch: defaultContribData.baseYearEmployerMatch,
    employerMatchByParentCat: defaultContribData.employerMatchByParentCat,
    profileSwitches: profileSwitches.length > 0 ? profileSwitches : undefined,
    brokerageContributionRamp,
    brokerageGoals: brokerageGoalRows.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: toNumber(g.targetAmount),
      targetYear: g.targetYear,
      priority: g.priority,
    })),
    startingBalances: portfolioByTaxType,
    startingAccountBalances: portfolioByAccount,
    individualAccounts,
    ...(inputWarnings.length > 0 ? { inputWarnings } : {}),
    annualExpenses: annualExpensesVal,
    expenseEndings,
    // Always pass when user explicitly set a decumulation override, or when
    // the computed decumulation budget differs from accumulation budget.
    decumulationAnnualExpenses:
      opts.decumulationExpenseOverride != null ||
      decumulationExpenses !== accumulationExpenses
        ? decumulationExpenses
        : undefined,
    inflationRate: toNumber(settings.annualInflation),
    postRetirementInflationRate: settings.postRetirementInflation
      ? toNumber(settings.postRetirementInflation)
      : undefined,
    returnRates: relevantReturnRates,
    // Single-person household: source BOTH the amount (via
    // personAnnualAmount, above) and the start age from
    // `perPersonSettings[0]` (retirement_profile_people, falling back to
    // `settings` when that row has no override — same resolution
    // perPersonSettings itself already does), not from the `settings`
    // scalar directly. The two MUST come from the same row: computing the
    // claiming-age adjustment from one row's ssStartAge while emitting a
    // different row's ssStartAge as the actual payment-start age would pay
    // a benefit adjusted for one claiming age starting at a different one.
    // `retirementProfilePeople.upsertHouseholdFields` is the only writer of
    // "SS Start Age" (writes ONLY retirement_profile_people, never
    // retirement_settings), so `retirement_settings.ss_start_age` can be
    // stale for a household that's edited it — sourcing both fields from
    // `perPersonSettings[0]` here fixes that for both the PIA and non-PIA
    // amount, and the same staleness for socialSecurityMonthly too (a
    // single-person "Monthly Benefit" edit writes only to
    // retirement_profile_people and could otherwise silently not move the
    // projection).
    socialSecurityAnnual:
      perPersonSettings.length === 1
        ? buildSocialSecurityEntries([perPersonSettings[0]!], filingStatus)[0]!
            .annualAmount
        : toNumber(settings.socialSecurityMonthly) * 12,
    ssStartAge:
      perPersonSettings.length === 1
        ? perPersonSettings[0]!.ssStartAge
        : settings.ssStartAge,
    // `socialSecurityEntries` is NOT just a Social Security income input —
    // `rmdStartAgeByPerson` (engine/projection-year-handlers/context.ts) is
    // built EXCLUSIVELY from it, and that map gates per-person RMD
    // tracking, which OVERRIDES the household RMD calculation
    // (decumulation-year.ts) once populated. `lib/pure/accounts/account-balances.types.ts`'s own
    // docblock states the assumption this table's per-person UI relies on:
    // "socialSecurityEntries/rmdStartAgeByPerson are only populated for
    // multi-person households." Populating a length-1 entries array for a
    // single-person household's PIA would silently flip on the per-person
    // RMD path for single-person households too — it measurably changes
    // RMD amounts (and net worth) for any single-person household with an
    // individualAccount whose ownerPersonId is null (joint/unassigned
    // pre-tax money silently drops out of the per-person RMD base), and
    // even for a fully-owned single-person household it isn't
    // byte-identical (per-person balance tracking drifts from the
    // household balance bucket over a multi-year projection). So: PIA for
    // a single person routes through the scalar socialSecurityAnnual above
    // instead, which the engine has always treated as SS-only, no RMD
    // side effect. Entries stay reserved for households that were ALREADY
    // multi-person before this feature existed — their RMD behavior is
    // completely unchanged by this diff (see the length > 1 condition
    // below, unaffected by PIA either way).
    // Per-person entries — PIA claiming-age adjustment + MFJ spousal
    // benefit + "worker has filed" gating all live in the one shared
    // `buildSocialSecurityEntries` helper (also used by the strategy
    // optimizer's SS-start-age lever, so the two can't drift). No
    // start-age shift here — this is the household's real plan.
    socialSecurityEntries:
      perPersonSettings.length > 1
        ? buildSocialSecurityEntries(perPersonSettings, filingStatus)
        : undefined,
    birthYear: calendarYear(primaryPerson.dateOfBirth),
    filingStatus,
    enableIrmaaAwareness: settings.enableIrmaaAwareness,
    irmaaOnTopOfBudget: settings.irmaaOnTopOfBudget,
    gapYearStopSaving: settings.gapYearStopSaving,
    gapYearDraws: settings.gapYearDraws,
    primaryPersonId: primaryPerson.id,
    enableAcaAwareness: settings.enableAcaAwareness,
    householdSize: settings.householdSize,
    perPersonBirthYears: perPersonSettings.map((p) => p.birthYear),
    stockShareByAge:
      stockShareByAge(
        defaultPreset.glidePath,
        classifyAssetClasses(classBucketRows),
        age,
        planEndAge(planDates),
      ) ?? undefined,
    asOfDate,
  };

  return {
    // Computed intermediates needed by callers
    primaryPerson,
    /** The active profile's later age steps (also in profileSwitches). */
    activeAgeSteps,
    settings,
    filingStatus,
    people,
    activeJobs,
    activeContribs,
    jobSalaries,
    allContribs,
    age,
    // The plan's ages (the primary person's): rows carry these, so a page
    // finding the retirement year by age reads the same year the engine does.
    planRetirementAge: planRetirementAge(planDates),
    planEndAge: planEndAge(planDates),
    totalCompensation,
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    personNameById,
    contribByCategory,
    employerMatchByCategory,
    employerMatchByParentCat: defaultContribData.employerMatchByParentCat,
    employerMatchRateByCategory: defaultContribData.employerMatchRateByCategory,
    salaryByPerson,
    hasMultiplePeople,
    salaryOverrideRows,
    budgetOverrideRows,
    perPersonSettings,
    budgetProfileSummaries,
    selectedScenario,
    bracketData,
    rothConversionPresets: [0, ...bracketData.map((b) => b.rate)]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b),
    relevantReturnRates,
    /** No return rate covers the current age: projections can't run. */
    notConfigured: floorRate ? null : ("no_return_rate" as const),
    displayContribRate,
    noContribData,
    totalRealContrib,
    contributionSpecs,
    derivedAccumulationDefaults,
    simpleTaxMode,
    distributionTaxRates,
    annualExpensesVal,
    accumulationExpenses,
    decumulationExpenses,
    accProfile,
    accCol,
    decProfile,
    decCol,
    irsGroupLimits,
    perfCategoryMap,
    perfRetirementBehaviorMap,
    perfAccountMap,
    dbSalaryOverrides,
    dbBudgetOverrides,
    // The base engine input (callers add overrides + decumulationDefaults)
    baseEngineInput,
  };
}
