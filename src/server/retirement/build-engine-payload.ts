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
 *
 * Extracted from `src/server/routers/retirement.ts` in the v0.5.2 file-split
 * refactor (see `.scratch/docs/V052-REFACTOR-PLAN.md` PR 1). Pure relocation —
 * no logic changes.
 */
import { eq, asc, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  toNumber,
  getEffectiveIncome,
  getTotalCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  getLatestSnapshot,
  computeBudgetAnnualTotal,
  requireLimit,
  accountDisplayName,
  aggregateContributionsByCategory,
  applyContribProfileRow,
  loadAndApplyContribProfile,
  applySalaryProfileRow,
  loadEffectiveSalaryProfile,
  resolveCompensation,
  resolveProfile,
  buildProfileContribData,
  getPrimaryPerson,
  pickActiveBudgetProfile,
  resolveLinkedBudgetItemAmounts,
} from "@/server/helpers";
import type { SalaryEntryMap, SalaryProfileEntry } from "@/server/helpers";
import type {
  TaxBuckets,
  AccountBalances,
  AccountCategory,
  ProfileSwitch,
} from "@/lib/calculators/types";
import {
  getAllCategories,
  categoriesWithIrsLimit,
  categoriesWithTaxPreference,
  getLimitGroup,
  getAccountTypeConfig,
  getDefaultAccumulationOrder,
  zeroBalance,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  PARENT_CATEGORY_VALUES,
  isTaxFreeBucket,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { roundToCents, sumBy } from "@/lib/utils/math";
import {
  IRS_LIMIT_GROWTH_RATE,
  FALLBACK_CONTRIBUTION_RATE,
} from "@/lib/constants";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
} from "@/lib/calculators/engine";
import type { db as _db } from "@/lib/db";
import { findActiveJob, filterActiveJobs } from "@/lib/pure/profiles";

type Db = typeof _db;

/** parentCategory values that the projection engine should include in starting balances.
 *  Pages filter engine output by parentCategory (Retirement page → 'Retirement', Brokerage → 'Portfolio'). */
const ENGINE_CATEGORIES = new Set<string>(PARENT_CATEGORY_VALUES);

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
     *  up front (M23, .scratch/docs/review-findings.md). */
    asOfDate?: Date;
  },
) {
  const [
    people,
    allJobs,
    retSettings,
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
    brokerageGoalRows,
    allAppSettings,
    contribProfileRow,
    salaryProfileRow,
  ] = await Promise.all([
    db.select().from(schema.people).orderBy(asc(schema.people.id)),
    db.select().from(schema.jobs),
    db.select().from(schema.retirementSettings),
    db.select().from(schema.retirementScenarios),
    db
      .select()
      .from(schema.returnRateTable)
      .orderBy(asc(schema.returnRateTable.age)),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(eq(schema.contributionAccounts.isActive, true)),
    db
      .select()
      .from(schema.contributionLimits)
      .where(
        eq(
          schema.contributionLimits.taxYear,
          (opts?.asOfDate ?? new Date()).getFullYear(),
        ),
      ),
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
    db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(asc(schema.brokerageGoals.targetYear)),
    db.select().from(schema.appSettings),
    // Batch contribution profile fetch when profileId is known at fetch time (C6).
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
    // Same C6 batching for the independent Salary Profile axis.
    opts?.salaryProfileId
      ? db
          .select()
          .from(schema.salaryProfiles)
          .where(eq(schema.salaryProfiles.id, opts.salaryProfileId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(undefined as undefined),
  ]);
  return {
    people,
    allJobs,
    retSettings,
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
    brokerageGoalRows,
    allAppSettings,
    contribProfileRow,
    salaryProfileRow,
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
    salaryActiveFields?: { personId: number; salary: number }[];
    contributionProfileId?: number;
    salaryProfileId?: number;
    accumulationBudgetProfileId?: number;
    accumulationBudgetColumn?: number;
    accumulationExpenseOverride?: number;
    decumulationBudgetProfileId?: number;
    decumulationBudgetColumn?: number;
    decumulationExpenseOverride?: number;
  },
) {
  const {
    people,
    allJobs,
    retSettings,
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
    brokerageGoalRows,
    allAppSettings,
  } = data;

  // All active contribution accounts feed the engine (both Retirement and Portfolio).
  // Pages filter output by parentCategory on individualAccountBalances.
  // When a contribution profile is selected, apply its overrides to the raw rows.
  // C6: if the caller passed contributionProfileId to fetchRetirementData, the profile
  // row is already batched in data.contribProfileRow (undefined = not fetched; use async
  // fallback for backward-compat). When pre-fetched, the sync path avoids a serial round-trip.
  const contribProfileResult =
    data.contribProfileRow !== undefined
      ? applyContribProfileRow(data.contribProfileRow, allContribsRaw, allJobs)
      : await loadAndApplyContribProfile(
          db,
          opts.contributionProfileId,
          allContribsRaw,
          allJobs,
        );
  const allContribs = contribProfileResult.contribs;
  const patchedJobs = contribProfileResult.jobs;

  const primaryPerson = getPrimaryPerson(people);
  if (!primaryPerson) return null;

  const settings = retSettings.find((s) => s.personId === primaryPerson.id);
  if (!settings) return null;

  // Get filing status from primary person's active job, then find matching tax brackets
  const filingStatus =
    settings.filingStatus ??
    findActiveJob(patchedJobs, primaryPerson.id)?.w4FilingStatus ??
    "MFJ";
  const latestTaxYear =
    allTaxBrackets.length > 0
      ? Math.max(...allTaxBrackets.map((b) => b.taxYear))
      : new Date().getFullYear();
  const matchingBrackets = allTaxBrackets.find(
    (b) =>
      b.taxYear === latestTaxYear &&
      b.filingStatus === filingStatus &&
      !b.w4Checkbox,
  );
  const bracketData = (matchingBrackets?.brackets ?? []) as {
    threshold: number;
    baseWithholding: number;
    rate: number;
  }[];

  // Per-person retirement settings (for per-person age display + editing)
  const perPersonSettings = people.map((p) => {
    const ps = retSettings.find((s) => s.personId === p.id);
    return {
      personId: p.id,
      name: p.name,
      birthYear: new Date(p.dateOfBirth).getFullYear(),
      retirementAge: ps?.retirementAge ?? settings.retirementAge,
      endAge: ps?.endAge ?? settings.endAge,
      withdrawalRate: ps?.withdrawalRate ?? settings.withdrawalRate,
      socialSecurityMonthly:
        ps?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
      ssStartAge: ps?.ssStartAge ?? settings.ssStartAge,
    };
  });

  // Average age and retirement age across all people
  // When a historical snapshot is selected, use its date as the reference point
  const referenceDate = data.snapshotData?.snapshot.snapshotDate
    ? new Date(data.snapshotData.snapshot.snapshotDate)
    : new Date();
  const currentYear = referenceDate.getFullYear();
  const avgAge = Math.round(
    sumBy(perPersonSettings, (p) => currentYear - p.birthYear) /
      perPersonSettings.length,
  );
  const avgRetirementAge = Math.round(
    sumBy(perPersonSettings, (p) => p.retirementAge) / perPersonSettings.length,
  );
  // Household retirement age: when the last person retires (full decumulation)
  const householdRetirementAge =
    perPersonSettings.length > 1
      ? Math.max(...perPersonSettings.map((p) => p.retirementAge))
      : avgRetirementAge;
  const maxEndAge = Math.max(...perPersonSettings.map((p) => p.endAge));

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
        new Array(numColumns).fill(opts.contributionProfileId ?? null),
        new Array(numColumns).fill(opts.salaryProfileId ?? null),
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

  // Age (average-based for multi-person households)
  const age = avgAge;

  // Salary
  // Explicit UI active values take priority, then the Salary Profile, then DB.
  // The Contribution Profile applied above contributes no salary — the two
  // axes are independent pins.
  const uiSalaryActiveMap = new Map(
    (opts.salaryActiveFields ?? []).map(
      (o) => [o.personId, { salary: o.salary }] as const,
    ),
  );
  // C6: prefer the batch-fetched row when fetchRetirementData was given the
  // id; fall back to the async fetch for callers that only pass it here.
  // Job-targeted (Salary Profile pins) — separate from uiSalaryActiveMap
  // (person-targeted, Plan/session tier, always wins per field).
  const salaryProfileActiveMap =
    data.salaryProfileRow !== undefined
      ? applySalaryProfileRow(data.salaryProfileRow)
      : await loadEffectiveSalaryProfile(db, opts.salaryProfileId);
  const asOfDate = referenceDate;
  const activeJobs = filterActiveJobs(patchedJobs);
  // C7: use getSalariesForJobs helper (deduplicates the parallel-fetch pattern).
  // Post-process to apply the Plan/session salary override and compute
  // totalComp. A Salary Profile entry is now a complete, all-or-nothing
  // number (see resolveCompensation's docblock) — there is no more
  // "resolved actual vs full-formula" distinction to adjust for (job_bonus_
  // overrides is gone), so currentYearBonusAdjustment is always empty; kept
  // in the payload shape as a no-op rather than removed, since the engine
  // still reads it defensively.
  const currentYearBonusAdjustmentByPerson = new Map<number, number>();
  const jobSalaries = activeJobs.map((job) => {
    const comp = resolveCompensation(salaryProfileActiveMap, job.id);
    const uiEntry = uiSalaryActiveMap.get(job.personId);
    const salary = applyActiveSalary(
      job.personId,
      comp.salary,
      uiSalaryActiveMap,
    );
    const bonusTerms = applyActiveBonusTerms(uiEntry, comp.terms);
    const totalComp = getTotalCompensation(salary, bonusTerms);
    return {
      job,
      // effectiveIncome respects includeBonusInContributions.
      salary: getEffectiveIncome(job, salary, bonusTerms),
      totalComp,
      totalCompFullFormula: totalComp,
    };
  });
  // combinedSalary = effective income (respects includeBonusInContributions flag)
  // Used for contribution calculations where percent_of_salary uses the payroll basis
  // totalCompensation = always includes bonus (resolved/pinned, not full-formula)
  // — used for display and "as of now" rate calculations.
  const totalCompensation = sumBy(jobSalaries, (js) => js.totalComp);
  // The engine's compounding baseline — full-formula bonus, see
  // currentYearBonusAdjustmentByPerson's docblock above.
  const totalCompensationFullFormula = sumBy(
    jobSalaries,
    (js) => js.totalCompFullFormula,
  );

  // Portfolio by tax bucket + per-account balances (combined for engine)
  const portfolioByTaxType: TaxBuckets = {
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  // Per-parentCategory tax buckets (for per-page display)
  const portfolioByTaxTypeByParentCat: Record<string, TaxBuckets> = {};
  const portfolioByAccount: AccountBalances = Object.fromEntries(
    getAllCategories().map((cat) => [cat, zeroBalance(cat)]),
  ) as AccountBalances;
  // Build owner-name lookup from people
  const personNameById = new Map(people.map((p) => [p.id, p.name]));
  // Track which people own accounts in each waterfall category + per-person balances
  const accountOwnerSets: Record<string, Set<string>> = {};
  const balanceByPersonByCategory: Record<string, Record<string, number>> = {};
  // Per-category account breakdown with display names (for tooltips)
  const accountBreakdownByCategory: Record<
    string,
    {
      name: string;
      amount: number;
      taxType: string;
      ownerName?: string;
      ownerPersonId?: number;
      accountType?: string;
      parentCategory?: string;
    }[]
  > = {};
  if (snapshotData) {
    // Build parent account_type lookup: for sub-type rows (Rollover, Employer Match, etc.),
    // the effective category should inherit from the parent performance account's primary type.
    // Group by performance_account_id and find the primary type (rows without subType).
    const parentTypeByPerfId = new Map<number, string>();
    for (const a of snapshotData.accounts) {
      if (a.performanceAccountId != null && !a.subType) {
        // Primary row (no subType) — its accountType is the parent type
        parentTypeByPerfId.set(a.performanceAccountId, a.accountType);
      }
    }

    for (const a of snapshotData.accounts) {
      // Only include engine-relevant categories (Retirement + Portfolio) in starting balances.
      // Pages filter engine output by parentCategory to show the correct subset.
      if (a.parentCategory && !ENGINE_CATEGORIES.has(a.parentCategory))
        continue;
      const ownerName = a.ownerPersonId
        ? personNameById.get(a.ownerPersonId)
        : undefined;
      const displayName = accountDisplayName(a, ownerName);
      // For sub-type rows, inherit the parent performance account's primary account_type
      const cat =
        a.subType && a.performanceAccountId != null
          ? (parentTypeByPerfId.get(a.performanceAccountId) ?? a.accountType)
          : a.accountType;
      const key = a.taxType as "preTax" | "taxFree" | "hsa" | "afterTax";
      portfolioByTaxType[key] += a.amount;
      // Also accumulate per-parentCategory for per-page display
      const pCat = a.parentCategory ?? "Retirement";
      if (!portfolioByTaxTypeByParentCat[pCat]) {
        portfolioByTaxTypeByParentCat[pCat] = {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 0,
          afterTaxBasis: 0,
        };
      }
      portfolioByTaxTypeByParentCat[pCat][key] += a.amount;
      const catAsBal = cat as AccountCategory;
      const bal = portfolioByAccount[catAsBal];
      if (bal.structure === "roth_traditional") {
        if (isTaxFreeBucket(a.taxType)) addRoth(bal, a.amount);
        else addTraditional(bal, a.amount);
      } else if (bal.structure === "single_bucket") {
        addBalance(bal, a.amount);
      } else {
        addBalance(bal, a.amount);
      }
      // Track owner + per-person balance + account breakdown
      if (ownerName) {
        if (!accountOwnerSets[cat]) accountOwnerSets[cat] = new Set();
        accountOwnerSets[cat].add(ownerName);
        if (!balanceByPersonByCategory[ownerName])
          balanceByPersonByCategory[ownerName] = {};
        balanceByPersonByCategory[ownerName][cat] =
          (balanceByPersonByCategory[ownerName][cat] ?? 0) + a.amount;
      } else {
        // Joint account — attribute to all people equally for ownership fractions
        if (!accountOwnerSets[cat]) accountOwnerSets[cat] = new Set();
        accountOwnerSets[cat].add("Joint");
        for (const pName of Array.from(personNameById.values())) {
          if (!balanceByPersonByCategory[pName])
            balanceByPersonByCategory[pName] = {};
          balanceByPersonByCategory[pName][cat] =
            (balanceByPersonByCategory[pName][cat] ?? 0) +
            a.amount / personNameById.size;
        }
      }
      if (!accountBreakdownByCategory[cat])
        accountBreakdownByCategory[cat] = [];
      const existing = accountBreakdownByCategory[cat].find(
        (e) => e.name === displayName && e.taxType === a.taxType,
      );
      if (existing) {
        existing.amount += a.amount;
      } else {
        accountBreakdownByCategory[cat].push({
          name: displayName,
          amount: a.amount,
          taxType: a.taxType,
          ownerName,
          ownerPersonId: a.ownerPersonId ?? undefined,
          accountType: cat,
          parentCategory: a.parentCategory ?? undefined,
        });
      }
    }
  }
  const accountOwnersByCategory: Record<string, string> = {};
  for (const [cat, names] of Object.entries(accountOwnerSets)) {
    accountOwnersByCategory[cat] = Array.from(names).join(" + ");
  }
  // Per-person ownership fraction by category (based on actual portfolio $)
  const totalByCategory: Record<string, number> = {};
  for (const personBals of Object.values(balanceByPersonByCategory)) {
    for (const [cat, amt] of Object.entries(personBals)) {
      totalByCategory[cat] = (totalByCategory[cat] ?? 0) + amt;
    }
  }
  const portfolioTotal = sumBy(Object.values(totalByCategory), (v) => v);
  const ownershipByPerson: Record<string, Record<string, number>> = {};
  for (const [name, personBals] of Object.entries(balanceByPersonByCategory)) {
    ownershipByPerson[name] = {};
    let personTotal = 0;
    for (const [cat, amt] of Object.entries(personBals)) {
      const catTotal = totalByCategory[cat] ?? 1;
      ownershipByPerson[name][cat] = catTotal > 0 ? amt / catTotal : 0;
      personTotal += amt;
    }
    ownershipByPerson[name]._overall =
      portfolioTotal > 0 ? personTotal / portfolioTotal : 0;
  }
  // Cost basis from performance_accounts (per-account, user-maintained alongside portfolio updates)
  const settingsMap = new Map(
    allAppSettings.map((s: { key: string; value: unknown }) => [
      s.key,
      s.value,
    ]),
  );
  const costBasisVal = sumBy(
    perfAccounts.filter((p) => p.isActive && tracksCostBasis(p.accountType)),
    (p) => toNumber(String(p.costBasis ?? "0")),
  );
  portfolioByTaxType.afterTaxBasis = costBasisVal;
  // Distribute cost basis to per-parentCategory buckets proportionally by afterTax balance
  const totalAfterTax = portfolioByTaxType.afterTax;
  for (const pCat of Object.keys(portfolioByTaxTypeByParentCat)) {
    const catBucket = portfolioByTaxTypeByParentCat[pCat]!;
    catBucket.afterTaxBasis =
      totalAfterTax > 0
        ? roundToCents(costBasisVal * (catBucket.afterTax / totalAfterTax))
        : 0;
  }
  addBasis(portfolioByAccount.brokerage, costBasisVal);
  const rampRaw = settingsMap.get("brokerage_contribution_increase");
  const brokerageContributionRamp =
    rampRaw != null && rampRaw !== "null" && rampRaw !== '"0"'
      ? toNumber(String(rampRaw).replace(/"/g, ""))
      : 0;
  const limitGrowthRaw = settingsMap.get("irs_limit_growth_rate");
  const irsLimitGrowthRate =
    limitGrowthRaw != null
      ? toNumber(String(limitGrowthRaw))
      : IRS_LIMIT_GROWTH_RATE;

  // IRS limits
  const limitsMap: Record<string, number> = {};
  for (const l of allLimits) limitsMap[l.limitType] = toNumber(l.value);

  // Per-person account types for limit aggregation.
  // A jobless row is "active" if it's tied to a currently-known person, OR
  // if personId is null — which (per the ownership/personId invariant
  // enforced in settings/paycheck.ts) only ever means a joint account, not
  // a data error. Without the null case, joint jobless contributions
  // (e.g. a joint brokerage account with no linked job) would silently
  // drop out of activeContribs entirely once their personId is cleared,
  // excluding their contribution amount from every downstream total this
  // function computes.
  const activeContribs = allContribs
    .filter(
      (c) =>
        activeJobs.some((j) => j.id === c.jobId) ||
        (c.jobId === null &&
          (c.personId === null || people.some((p) => p.id === c.personId))),
    )
    .map((c) => ({ ...c, accountType: c.accountType as AccountCategory }));
  const personAccountTypes = new Map<number, Set<string>>();
  for (const c of activeContribs) {
    // Joint accounts have no single owning person — they don't attribute to
    // any individual's per-person IRS limit tracking below.
    if (c.personId == null) continue;
    if (!personAccountTypes.has(c.personId))
      personAccountTypes.set(c.personId, new Set());
    personAccountTypes.get(c.personId)!.add(c.accountType);
  }

  // Aggregate IRS limits per limit group across people. catchupByGroup /
  // superCatchupByGroup hold the flat per-person IRS catchup dollar figure
  // (not summed across people) — groupParticipants records WHO participates
  // in each group so the engine can gate that figure by each participant's
  // own projected age each year (see catchupGroupParticipants below / H10).
  const limitByGroup: Record<string, number> = {};
  const catchupByGroup: Record<string, number> = {};
  const superCatchupByGroup: Record<string, number> = {};
  const groupParticipants = new Map<string, Map<number, number>>(); // group -> personId -> birthYear
  const birthYearByPersonId = new Map(
    perPersonSettings.map((p) => [p.personId, p.birthYear]),
  );
  const groupCounted = new Set<string>();
  for (const p of people) {
    const types = personAccountTypes.get(p.id);
    if (!types) continue;
    const typeArr = Array.from(types);
    for (const cat of categoriesWithIrsLimit()) {
      if (!typeArr.includes(cat)) continue;
      const group = getLimitGroup(cat)!;
      const cfg = getAccountTypeConfig(cat);
      const keys = cfg.irsLimitKeys!;
      // HSA is per-household (counted once), others per-person
      const isHousehold = cfg.isHouseholdLimit;
      if (isHousehold && groupCounted.has(group)) continue;
      // Use coverage-variant limit (e.g. HSA family) when applicable
      let baseKey = keys.base;
      if (keys.coverageVariant) {
        const hsaAcct = activeContribs.find((c) => c.accountType === cat);
        if (hsaAcct?.hsaCoverageType === "family")
          baseKey = keys.coverageVariant;
      }
      limitByGroup[group] =
        (limitByGroup[group] ?? 0) + requireLimit(limitsMap, baseKey);
      if (keys.catchup) catchupByGroup[group] = limitsMap[keys.catchup] ?? 0;
      if (keys.superCatchup)
        superCatchupByGroup[group] = limitsMap[keys.superCatchup] ?? 0;
      if (keys.catchup || keys.superCatchup) {
        const birthYear = birthYearByPersonId.get(p.id);
        if (birthYear != null) {
          if (!groupParticipants.has(group))
            groupParticipants.set(group, new Map());
          groupParticipants.get(group)!.set(p.id, birthYear);
        }
      }
      groupCounted.add(group);
    }
  }
  // Aggregate contributions and employer match by category (shared helper — single pass)
  const { contribByCategory, employerMatchByCategory } =
    aggregateContributionsByCategory(activeContribs, activeJobs, jobSalaries);

  // Build per-person salary map from job salaries — the engine's compounding
  // baseline, so full-formula bonus (see totalCompFullFormula's docblock
  // above), not the resolved/pinned current-year value.
  const salaryByPerson: Record<number, number> = {};
  for (const js of jobSalaries) {
    salaryByPerson[js.job.personId] =
      (salaryByPerson[js.job.personId] ?? 0) + js.totalCompFullFormula;
  }
  const hasMultiplePeople = Object.keys(salaryByPerson).length > 1;

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
    .filter((o) => !hasMultiplePeople && o.personId === primaryPerson.id)
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

  // Pre-resolve contribution profiles for profile-switch overrides
  const profileSwitchProfileIds = Array.from(
    new Set(
      profileSwitchOverrides
        .map((o) => o.contributionProfileId!)
        .filter(Boolean),
    ),
  );
  const switchProfileRows =
    profileSwitchProfileIds.length > 0
      ? await db
          .select()
          .from(schema.contributionProfiles)
          .where(
            inArray(schema.contributionProfiles.id, profileSwitchProfileIds),
          )
      : [];
  const switchProfileMap = new Map(switchProfileRows.map((p) => [p.id, p]));

  // Same pre-resolution for the salary axis of a profile switch.
  const switchSalaryProfileIds = Array.from(
    new Set(
      profileSwitchOverrides.map((o) => o.salaryProfileId!).filter(Boolean),
    ),
  );
  const switchSalaryProfileRows =
    switchSalaryProfileIds.length > 0
      ? await db
          .select()
          .from(schema.salaryProfiles)
          .where(inArray(schema.salaryProfiles.id, switchSalaryProfileIds))
      : [];
  const switchSalaryProfileMap = new Map(
    switchSalaryProfileRows.map((p) => [p.id, p]),
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
  const globalColSetting = settingsMap.get("budget_active_column");
  const globalActiveCol =
    typeof globalColSetting === "number" ? globalColSetting : 0;
  const defaultProfile = pickActiveBudgetProfile(allBudgetProfiles);
  // Accumulation phase: profile + column
  const accProfile = opts.accumulationBudgetProfileId
    ? allBudgetProfiles.find((p) => p.id === opts.accumulationBudgetProfileId)
    : defaultProfile;
  const accMaxCol =
    Math.max(0, (accProfile?.columnLabels as string[] | null)?.length ?? 1) - 1;
  const accCol = Math.min(
    Math.max(0, opts.accumulationBudgetColumn ?? globalActiveCol),
    accMaxCol,
  );
  const accItems = accProfile
    ? allBudgetItems.filter((i) => i.profileId === accProfile.id)
    : [];
  // Decumulation phase: profile + column
  const decProfile = opts.decumulationBudgetProfileId
    ? allBudgetProfiles.find((p) => p.id === opts.decumulationBudgetProfileId)
    : defaultProfile;
  const decMaxCol =
    Math.max(0, (decProfile?.columnLabels as string[] | null)?.length ?? 1) - 1;
  const decCol = Math.min(
    Math.max(0, opts.decumulationBudgetColumn ?? globalActiveCol),
    decMaxCol,
  );
  const decItems = decProfile
    ? allBudgetItems.filter((i) => i.profileId === decProfile.id)
    : [];

  const accMonths = (accProfile?.columnMonths as number[] | null) ?? null;
  const decMonths = (decProfile?.columnMonths as number[] | null) ?? null;
  // Resolved through the same contribution-account chain
  // computeActiveSummary uses (see resolveLinkedBudgetItemAmounts) rather
  // than raw `amounts`, which is intentionally stale for contribution-linked
  // items — reading it directly here silently dropped every linked item's
  // dollar amount from accumulation/decumulation expenses.
  const accNumColumns =
    (accProfile?.columnLabels as string[] | null)?.length ?? 1;
  const decNumColumns =
    (decProfile?.columnLabels as string[] | null)?.length ?? 1;
  const resolvedAccItems = opts.accumulationExpenseOverride
    ? accItems
    : await resolveLinkedBudgetItemAmounts(
        db,
        accItems,
        accNumColumns,
        new Array(accNumColumns).fill(opts.contributionProfileId ?? null),
        new Array(accNumColumns).fill(opts.salaryProfileId ?? null),
      );
  const resolvedDecItems = opts.decumulationExpenseOverride
    ? decItems
    : await resolveLinkedBudgetItemAmounts(
        db,
        decItems,
        decNumColumns,
        new Array(decNumColumns).fill(opts.contributionProfileId ?? null),
        new Array(decNumColumns).fill(opts.salaryProfileId ?? null),
      );
  const accumulationExpenses =
    opts.accumulationExpenseOverride ??
    computeBudgetAnnualTotal(resolvedAccItems, accCol, accMonths);
  const decumulationExpenses =
    opts.decumulationExpenseOverride ??
    computeBudgetAnnualTotal(resolvedDecItems, decCol, decMonths);
  const annualExpensesVal = accumulationExpenses;

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
  const defaultContribData = buildProfileContribData(
    activeContribs.map((c) => ({
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
      performanceAccountId: c.performanceAccountId,
      targetAnnual: c.targetAnnual,
      allocationPriority: c.allocationPriority,
    })),
    activeJobs.map((j) => ({
      id: j.id,
      personId: j.personId,
      payPeriod: j.payPeriod,
    })),
    jobSalaries,
    profileContribCtx,
  );
  const contributionSpecs = defaultContribData.contributionSpecs;

  // Build live data refs for resolveProfile (DB rows before current profile
  // applied). No contributionMethod/contributionValue here — accounts carry
  // no value of their own; resolveProfile adds those from the switched
  // profile's own active fields, excluding accounts it has no value for.
  const liveContribRows = allContribsRaw.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory: c.parentCategory ?? "",
    taxTreatment: c.taxTreatment ?? "pre_tax",
    employerMatchType: c.employerMatchType ?? null,
    employerMatchValue: c.employerMatchValue
      ? String(c.employerMatchValue)
      : null,
    employerMaxMatchPct: c.employerMaxMatchPct
      ? String(c.employerMaxMatchPct)
      : null,
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    subType: c.subType,
    label: c.label ?? null,
  }));
  // Intentionally un-overridden by the Plan/session tier — this is the
  // reference baseline a profile switch's stored salary override gets
  // GROWN from ("Profile salary overrides are in today's dollars; grow to
  // the switch year" below). Applying a Plan override here would
  // double-count it into the profile-switch growth math. A job has no
  // salary/bonus of its own — the globally-ACTIVE Salary Profile
  // (salaryProfileActiveMap, already loaded above) is the only live source.
  const liveJobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: { id: j.id, personId: j.personId },
      salary: getEffectiveIncome(j, comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
      resolvedBonusOverride: null,
    };
  });

  const profileSwitches: ProfileSwitch[] = [];

  /** Each person's own annual raise rate, falling back to the primary
   *  person's when they have no retirement_settings row. retirementSettings
   *  is per-person, so growing person B's future salary by person A's raise
   *  rate (what this used to do) silently produced the wrong number. */
  const primaryRaiseRate = toNumber(settings.salaryAnnualIncrease);
  const raiseRateByPerson = new Map(
    retSettings.map((rs) => [
      rs.personId,
      toNumber(rs.salaryAnnualIncrease) || primaryRaiseRate,
    ]),
  );

  for (const override of profileSwitchOverrides) {
    const contribProfileRaw = override.contributionProfileId
      ? switchProfileMap.get(override.contributionProfileId)
      : undefined;
    const contribProfile = contribProfileRaw ?? null;
    const salaryProfile = override.salaryProfileId
      ? (switchSalaryProfileMap.get(override.salaryProfileId) ?? null)
      : null;
    if (!contribProfile && !salaryProfile) continue;

    // Salary side: the referenced Salary Profile's values are in today's
    // dollars, so grow them to the switch year.
    //
    // Only THIS row's own personId is injected. retirement_salary_overrides
    // has per-(person, year) grain, so pushing every person in the profile
    // from every row double-injects whenever two people's rows for the same
    // year reference profiles with overlapping personIds. A household-wide
    // switch is expressed as one row per person, each contributing its own
    // person's value.
    //
    // Only an entry that targets this person's active job carries a number
    // to grow. Someone the switch profile says nothing about is still
    // following their live salary, which the engine is already projecting
    // forward from; injecting anything for them here would compound a
    // second, redundant salary path.
    // salaryProfile.salaries is jobId-keyed (a Salary Profile targets
    // specific jobs, not people) — find this person's active job to look
    // up their entry. Assumes one active job per person, same as
    // everywhere else in the app.
    const switchSalaryEntriesByJob = (salaryProfile?.salaries ??
      {}) as SalaryEntryMap;
    const ownJob = activeJobs.find((j) => j.personId === override.personId);
    const ownEntry = ownJob
      ? switchSalaryEntriesByJob[String(ownJob.id)]
      : undefined;
    // A profile entry pinning only bonus terms (no `salary`) is not a
    // salary to grow — same presence rule as before. Only the SALARY
    // field's presence decides whether this row injects anything.
    const ownBaseSalary = ownEntry?.salary;
    // Baseline this override replaces (salaryByPerson) is TOTAL comp
    // (totalCompFullFormula, salary + bonus) — growing bare `.salary` here
    // would silently drop the switched profile's bonus from projections.
    // Bonus fields may be absent even when salary is pinned (entries here
    // aren't guaranteed complete the way resolveCompensation's normal
    // callers assume), so missing bonus terms mean "no bonus," not NaN.
    const ownTotalComp =
      ownBaseSalary !== undefined
        ? getTotalCompensation(ownBaseSalary, {
            bonusPercent:
              ownEntry?.bonusPercent != null
                ? String(ownEntry.bonusPercent)
                : null,
            bonusMultiplier:
              ownEntry?.bonusMultiplier != null
                ? String(ownEntry.bonusMultiplier)
                : null,
            monthsInBonusYear: ownEntry?.monthsInBonusYear ?? null,
          })
        : undefined;
    if (salaryProfile && ownBaseSalary !== undefined) {
      const yearsFromNow = override.projectionYear - currentYear;
      const personRaiseRate =
        raiseRateByPerson.get(override.personId) ?? primaryRaiseRate;
      const grownSalary =
        ownTotalComp! * Math.pow(1 + personRaiseRate, yearsFromNow);
      perPersonSalaryOverrides.push({
        personId: override.personId,
        year: override.projectionYear,
        value: grownSalary,
      });
      // Also add to household-level overrides for single-person fallback
      if (!hasMultiplePeople) {
        dbSalaryOverrides.push({
          year: override.projectionYear,
          value: grownSalary,
          notes: `Profile: ${salaryProfile.name}`,
        });
      }
    }

    // Contribution side. A salary-only switch has nothing to build here.
    if (!contribProfile) continue;

    // The switched profile's percent-of-salary contributions must be
    // computed against the SWITCHED job's compensation, not the globally
    // active Salary Profile's (liveJobSalaries) — otherwise a salary-profile
    // switch never reaches contribution math at all. Overlay only the
    // switched-to entry for this person's own job onto the live map; every
    // other job keeps following its live salary, same rule as the salary
    // override above.
    // Normalize possibly-partial bonus fields to "no bonus" defaults — same
    // reasoning as ownTotalComp above, since resolveCompensation assumes a
    // complete entry and would otherwise turn missing fields into NaN.
    const ownEntryNormalized: SalaryProfileEntry | undefined =
      ownBaseSalary !== undefined
        ? {
            salary: ownBaseSalary,
            bonusPercent: ownEntry?.bonusPercent ?? 0,
            bonusMultiplier: ownEntry?.bonusMultiplier ?? 1,
            monthsInBonusYear: ownEntry?.monthsInBonusYear ?? 12,
            // Never carry a current-year pin into projection/contribution
            // math — see SalaryProfileEntry.bonusOverride's docblock.
            bonusOverride: null,
          }
        : undefined;
    const switchJobSalaries = salaryProfile
      ? activeJobs.map((j) => {
          const map =
            j.id === ownJob?.id && ownEntryNormalized !== undefined
              ? new Map(salaryProfileActiveMap).set(j.id, ownEntryNormalized)
              : salaryProfileActiveMap;
          const comp = resolveCompensation(map, j.id);
          return {
            job: { id: j.id, personId: j.personId },
            salary: getEffectiveIncome(j, comp.salary, comp.terms),
            baseSalary: comp.salary,
            totalComp: getTotalCompensation(comp.salary, comp.terms),
            resolvedBonusOverride: null,
          };
        })
      : liveJobSalaries;

    // The switched profile's percent-of-salary contributions are computed
    // against the switched SALARY (when this row also pins one) — that's
    // what the coupled salary+contribution profile used to do, preserved now
    // that the two are separate entities.
    const resolved = resolveProfile(
      contribProfile,
      liveContribRows,
      activeJobs as (typeof schema.jobs.$inferSelect)[],
      switchJobSalaries,
    );

    const data = buildProfileContribData(
      resolved.activeContribs.map((c) => ({
        ...c,
        accountType: c.accountType as AccountCategory,
      })),
      resolved.activeJobs,
      resolved.jobSalaries,
      profileContribCtx,
    );

    // Compute per-profile contribution rate ceiling
    const switchedTotalComp = sumBy(resolved.jobSalaries, (js) => js.totalComp);
    const switchedTotalContrib = sumBy(
      Object.values(data.baseYearContributions),
      (v) => v,
    );
    const switchedContribRate =
      switchedTotalComp > 0 ? switchedTotalContrib / switchedTotalComp : 0;

    // Contribution rate ceiling for the switched profile:
    // - Both comp AND contribs > 0: compute the real ratio
    // - Comp > 0 but contribs = 0: the profile is INTENTIONALLY zero (e.g. a
    //   "Coast FIRE" profile — user is saying "stop contributing"). Use 0
    //   so the engine's rate path produces zero contributions. Before: this
    //   silently fell back to 0.25 which defeated the profile's intent.
    // - No comp (missing data): keep the fallback to avoid surprising behavior
    //   on broken profiles.
    const rateForSwitch =
      switchedContribRate > 0
        ? switchedContribRate
        : switchedTotalComp > 0
          ? 0
          : FALLBACK_CONTRIBUTION_RATE;

    profileSwitches.push({
      year: override.projectionYear,
      contributionSpecs: data.contributionSpecs,
      employerMatchRateByCategory: data.employerMatchRateByCategory,
      baseYearContributions: data.baseYearContributions,
      baseYearEmployerMatch: data.baseYearEmployerMatch,
      employerMatchByParentCat: data.employerMatchByParentCat,
      contributionRate: rateForSwitch,
    });
  }

  // Sort profile switches by year
  profileSwitches.sort((a, b) => a.year - b.year);

  // Derive accumulation defaults from real paycheck/contribution data
  const totalRealContrib = sumBy(
    Object.values(contribByCategory),
    (c) => c.annual,
  );
  // Rate based on total compensation (always includes bonus)
  const displayContribRate =
    totalCompensation > 0 ? totalRealContrib / totalCompensation : 0;

  // Account splits derived from actual contribution amounts
  const noContribData = totalRealContrib <= 0;
  const realAccountSplits = Object.fromEntries(
    getAllCategories().map((cat) => [
      cat,
      noContribData ? 0 : contribByCategory[cat].annual / totalRealContrib,
    ]),
  ) as Record<AccountCategory, number>;

  const derivedAccumulationDefaults = {
    contributionRate:
      displayContribRate > 0 ? displayContribRate : FALLBACK_CONTRIBUTION_RATE,
    routingMode: "waterfall" as const,
    accountOrder: getDefaultAccumulationOrder(),
    accountSplits: realAccountSplits,
    taxSplits: Object.fromEntries(
      categoriesWithTaxPreference().map((cat) => [
        cat,
        contribByCategory[cat].rothFraction,
      ]),
    ) as Partial<Record<AccountCategory, number>>,
  };

  // Distribution tax rates (shared between engine and MC)
  // When bracket data is available, estimate effective rates from brackets instead of using
  // flat DB values (which may be stale or overly conservative, e.g. flat 22% vs actual ~12-15%)
  const dbTraditionalRate = selectedScenario
    ? toNumber(selectedScenario.distributionTaxRateTraditional)
    : 0;
  const dbBrokerageRate = selectedScenario
    ? toNumber(selectedScenario.distributionTaxRateBrokerage)
    : 0;
  const taxMult = toNumber(settings.taxMultiplier);

  let effectiveTraditionalRate = dbTraditionalRate;
  let effectiveBrokerageRate = dbBrokerageRate;

  if (bracketData.length > 0) {
    // Estimate effective income tax rate at retirement income level.
    // Use decumulation budget when set (it's the actual retirement spending level);
    // fall back to accumulation budget otherwise.
    const retirementIncome =
      decumulationExpenses !== accumulationExpenses
        ? decumulationExpenses
        : annualExpensesVal;
    const estimatedRate = estimateEffectiveTaxRate(
      retirementIncome,
      bracketData,
      taxMult,
    );
    // Only override if we get a meaningful estimate (bracket data is valid)
    if (estimatedRate > 0) {
      effectiveTraditionalRate = estimatedRate;
    }
    // LTCG: if retirement income fits within 12% marginal bracket, 0% LTCG rate applies (MFJ ~$94K)
    const ltcgThreshold = incomeCapForMarginalRate(0.12, bracketData);
    effectiveBrokerageRate =
      retirementIncome < ltcgThreshold ? 0 : dbBrokerageRate;
  }

  const distributionTaxRates = {
    traditionalFallbackRate: effectiveTraditionalRate,
    roth: selectedScenario
      ? toNumber(selectedScenario.distributionTaxRateRoth)
      : 0,
    hsa: selectedScenario
      ? toNumber(selectedScenario.distributionTaxRateHsa)
      : 0,
    brokerage: effectiveBrokerageRate,
    taxBrackets: bracketData.length > 0 ? bracketData : undefined,
    taxMultiplier: taxMult,
    grossUpForTaxes: settings.grossUpForTaxes,
    rothBracketTarget: toNumber(settings.rothBracketTarget ?? "0.12"),
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget:
      settings.rothConversionTarget != null
        ? toNumber(settings.rothConversionTarget)
        : undefined,
  };

  // Base engine input (without accumulationOverrides, decumulationOverrides, decumulationDefaults)
  const baseEngineInput = {
    accumulationDefaults: derivedAccumulationDefaults,
    currentAge: age,
    retirementAge: hasMultiplePeople
      ? householdRetirementAge
      : avgRetirementAge,
    retirementAgeByPerson: hasMultiplePeople
      ? Object.fromEntries(
          perPersonSettings.map((ps) => [ps.personId, ps.retirementAge]),
        )
      : undefined,
    projectionEndAge: maxEndAge,
    currentSalary: totalCompensationFullFormula,
    salaryGrowthRate: toNumber(settings.salaryAnnualIncrease),
    salaryCap: settings.salaryCap ? toNumber(settings.salaryCap) : null,
    salaryOverrides: dbSalaryOverrides,
    salaryByPerson: hasMultiplePeople ? salaryByPerson : undefined,
    perPersonSalaryOverrides: hasMultiplePeople
      ? perPersonSalaryOverrides
      : undefined,
    currentYearBonusAdjustment:
      currentYearBonusAdjustmentByPerson.size > 0
        ? Object.fromEntries(currentYearBonusAdjustmentByPerson)
        : undefined,
    budgetOverrides: dbBudgetOverrides,
    baseLimits: Object.fromEntries(
      getAllCategories().map((cat) => {
        const group = getLimitGroup(cat);
        return [cat, group ? (limitByGroup[group] ?? 0) : 0];
      }),
    ) as Record<AccountCategory, number>,
    limitGrowthRate: irsLimitGrowthRate,
    catchupLimits: {
      ...Object.fromEntries(
        Object.entries(catchupByGroup).map(([group, val]) => [group, val]),
      ),
      ...Object.fromEntries(
        Object.entries(superCatchupByGroup).map(([group, val]) => [
          `${group}_super`,
          val,
        ]),
      ),
    },
    catchupGroupParticipants: Object.fromEntries(
      Array.from(groupParticipants.entries()).map(([group, byPerson]) => [
        group,
        Array.from(byPerson.entries()).map(([personId, birthYear]) => ({
          personId,
          birthYear,
        })),
      ]),
    ),
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
    individualAccounts: Object.entries(accountBreakdownByCategory).flatMap(
      ([cat, accts]) =>
        accts.map((a) => ({
          name: a.name,
          category: cat as AccountCategory,
          taxType: a.taxType,
          accountType: a.accountType,
          startingBalance: a.amount,
          ownerName: a.ownerName,
          ownerPersonId: a.ownerPersonId,
          parentCategory: a.parentCategory,
        })),
    ),
    annualExpenses: annualExpensesVal,
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
    socialSecurityAnnual: toNumber(settings.socialSecurityMonthly) * 12,
    ssStartAge: settings.ssStartAge,
    socialSecurityEntries:
      perPersonSettings.length > 1
        ? perPersonSettings.map((ps) => ({
            personId: ps.personId,
            personName: ps.name,
            annualAmount: toNumber(ps.socialSecurityMonthly) * 12,
            startAge: ps.ssStartAge,
            birthYear: ps.birthYear,
          }))
        : undefined,
    birthYear: new Date(primaryPerson.dateOfBirth).getFullYear(),
    filingStatus,
    enableIrmaaAwareness: settings.enableIrmaaAwareness,
    enableAcaAwareness: settings.enableAcaAwareness,
    householdSize: settings.householdSize,
    perPersonBirthYears: perPersonSettings.map((p) => p.birthYear),
    asOfDate,
  };

  return {
    // Computed intermediates needed by callers
    primaryPerson,
    settings,
    filingStatus,
    people,
    activeJobs,
    activeContribs,
    jobSalaries,
    allContribs,
    age,
    avgRetirementAge,
    maxEndAge,
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
    displayContribRate,
    noContribData,
    totalRealContrib,
    contributionSpecs,
    derivedAccumulationDefaults,
    distributionTaxRates,
    annualExpensesVal,
    accumulationExpenses,
    decumulationExpenses,
    accProfile,
    accCol,
    decProfile,
    decCol,
    limitByGroup,
    perfCategoryMap,
    perfRetirementBehaviorMap,
    perfAccountMap,
    dbSalaryOverrides,
    dbBudgetOverrides,
    // The base engine input (callers add overrides + decumulationDefaults)
    baseEngineInput,
  };
}
