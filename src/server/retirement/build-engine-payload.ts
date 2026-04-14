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
  getCurrentSalary,
  getEffectiveIncome,
  getTotalCompensation,
  getLatestSnapshot,
  getAnnualExpensesFromBudget,
  computeBudgetAnnualTotal,
  requireLimit,
  accountDisplayName,
  aggregateContributionsByCategory,
  loadAndApplyContribProfile,
  resolveProfile,
  buildProfileContribData,
} from "@/server/helpers";
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
import { roundToCents } from "@/lib/utils/math";
import { IRS_LIMIT_GROWTH_RATE } from "@/lib/constants";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
} from "@/lib/calculators/engine";
import type { db as _db } from "@/lib/db";

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
  opts?: { snapshotId?: number },
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
    budgetExpenses,
    salaryOverrideRows,
    budgetOverrideRows,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    allTaxBrackets,
    brokerageGoalRows,
    allAppSettings,
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
      .where(eq(schema.contributionLimits.taxYear, new Date().getFullYear())),
    getLatestSnapshot(db, opts?.snapshotId),
    getAnnualExpensesFromBudget(db),
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
    budgetExpenses,
    salaryOverrideRows,
    budgetOverrideRows,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    allTaxBrackets,
    brokerageGoalRows,
    allAppSettings,
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
    salaryOverrides?: { personId: number; salary: number }[];
    contributionProfileId?: number;
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
  const contribProfileResult = await loadAndApplyContribProfile(
    db,
    opts.contributionProfileId,
    allContribsRaw,
    allJobs,
    new Map<number, number>(), // empty — salary merging happens below with UI overrides
  );
  const allContribs = contribProfileResult.contribs;
  const patchedJobs = contribProfileResult.jobs;
  const contribProfileSalaryOverrides: Map<number, number> | null =
    contribProfileResult.salaryMap.size > 0
      ? contribProfileResult.salaryMap
      : null;

  const primaryPerson = people.find((p) => p.isPrimaryUser) ?? people[0];
  if (!primaryPerson) return null;

  const settings = retSettings.find((s) => s.personId === primaryPerson.id);
  if (!settings) return null;

  // Get filing status from primary person's active job, then find matching tax brackets
  const primaryActiveJobs = patchedJobs.filter(
    (j) => !j.endDate && j.personId === primaryPerson.id,
  );
  const filingStatus =
    settings.filingStatus ?? primaryActiveJobs[0]?.w4FilingStatus ?? "MFJ";
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
    perPersonSettings.reduce((s, p) => s + (currentYear - p.birthYear), 0) /
      perPersonSettings.length,
  );
  const avgRetirementAge = Math.round(
    perPersonSettings.reduce((s, p) => s + p.retirementAge, 0) /
      perPersonSettings.length,
  );
  // Household retirement age: when the last person retires (full decumulation)
  const householdRetirementAge =
    perPersonSettings.length > 1
      ? Math.max(...perPersonSettings.map((p) => p.retirementAge))
      : avgRetirementAge;
  const maxEndAge = Math.max(...perPersonSettings.map((p) => p.endAge));

  // Budget profile summaries (for budget override "from profile" UI)
  const budgetProfileSummaries = allBudgetProfiles.map((p) => {
    const items = allBudgetItems.filter((i) => i.profileId === p.id);
    const labels = p.columnLabels as string[];
    const months = (p.columnMonths as number[] | null) ?? null;
    const totals = labels.map((_: string, colIdx: number) =>
      items.reduce(
        (sum: number, item) => sum + ((item.amounts as number[])[colIdx] ?? 0),
        0,
      ),
    );
    const weightedAnnualTotal = months
      ? roundToCents(
          totals.reduce((sum, t, i) => sum + t * (months[i] ?? 0), 0),
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
  });

  // Age (average-based for multi-person households)
  const age = avgAge;

  // Salary
  // Explicit UI overrides take priority, then contribution profile salary overrides, then DB
  const salaryOverrideMap = new Map(
    (opts.salaryOverrides ?? []).map((o) => [o.personId, o.salary] as const),
  );
  // Merge profile salary overrides (lower priority than explicit UI overrides)
  if (contribProfileSalaryOverrides) {
    contribProfileSalaryOverrides.forEach((salary, personId) => {
      if (!salaryOverrideMap.has(personId)) {
        salaryOverrideMap.set(personId, salary);
      }
    });
  }
  const asOfDate = referenceDate;
  const activeJobs = patchedJobs.filter((j) => !j.endDate);
  const jobSalaries = await Promise.all(
    activeJobs.map(async (j) => {
      const dbSalary = await getCurrentSalary(
        db,
        j.id,
        j.annualSalary,
        asOfDate,
      );
      const overrideSalary = salaryOverrideMap.get(j.personId);
      return {
        job: j,
        salary: overrideSalary ?? getEffectiveIncome(j, dbSalary),
        totalComp: overrideSalary ?? getTotalCompensation(j, dbSalary),
      };
    }),
  );
  // combinedSalary = effective income (respects includeBonusInContributions flag)
  // Used for contribution calculations where percent_of_salary uses the payroll basis
  // totalCompensation = always includes bonus — used for display and rate calculations
  const totalCompensation = jobSalaries.reduce((s, js) => s + js.totalComp, 0);

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
  const portfolioTotal = Object.values(totalByCategory).reduce(
    (s, v) => s + v,
    0,
  );
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
  const costBasisVal = perfAccounts
    .filter((p) => p.isActive && tracksCostBasis(p.accountType))
    .reduce((sum, p) => sum + toNumber(String(p.costBasis ?? "0")), 0);
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

  // Per-person account types for limit aggregation
  const activeContribs = allContribs
    .filter(
      (c) =>
        activeJobs.some((j) => j.id === c.jobId) ||
        (c.jobId === null && people.some((p) => p.id === c.personId)),
    )
    .map((c) => ({ ...c, accountType: c.accountType as AccountCategory }));
  const personAccountTypes = new Map<number, Set<string>>();
  for (const c of activeContribs) {
    if (!personAccountTypes.has(c.personId))
      personAccountTypes.set(c.personId, new Set());
    personAccountTypes.get(c.personId)!.add(c.accountType);
  }

  // Aggregate IRS limits per limit group across people
  const limitByGroup: Record<string, number> = {};
  const catchupByGroup: Record<string, number> = {};
  const superCatchupByGroup: Record<string, number> = {};
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
      if (keys.catchup)
        catchupByGroup[group] =
          (catchupByGroup[group] ?? 0) + (limitsMap[keys.catchup] ?? 0);
      if (keys.superCatchup)
        superCatchupByGroup[group] =
          (superCatchupByGroup[group] ?? 0) +
          (limitsMap[keys.superCatchup] ?? 0);
      groupCounted.add(group);
    }
  }
  // Aggregate contributions and employer match by category (shared helper — single pass)
  const {
    contribByCategory,
    employerMatchByCategory,
    employerMatchByParentCat: _employerMatchByParentCat,
  } = aggregateContributionsByCategory(activeContribs, activeJobs, jobSalaries);

  // Build per-person salary map from job salaries
  const salaryByPerson: Record<number, number> = {};
  for (const js of jobSalaries) {
    salaryByPerson[js.job.personId] =
      (salaryByPerson[js.job.personId] ?? 0) + js.totalComp;
  }
  const hasMultiplePeople = Object.keys(salaryByPerson).length > 1;

  // Separate salary overrides: profile-switch overrides vs plain salary overrides
  const plainSalaryOverrides = salaryOverrideRows.filter(
    (o) => !o.contributionProfileId,
  );
  const profileSwitchOverrides = salaryOverrideRows.filter(
    (o) => !!o.contributionProfileId,
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
  const defaultProfile = allBudgetProfiles.find((p) => p.isActive);
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
  const accumulationExpenses =
    opts.accumulationExpenseOverride ??
    computeBudgetAnnualTotal(accItems, accCol, accMonths);
  const decumulationExpenses =
    opts.decumulationExpenseOverride ??
    computeBudgetAnnualTotal(decItems, decCol, decMonths);
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

  // Build live data refs for resolveProfile (DB rows before current profile applied)
  const liveContribRows = allContribsRaw.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory: c.parentCategory ?? "",
    contributionMethod: c.contributionMethod ?? "percent_of_salary",
    contributionValue: String(c.contributionValue ?? "0"),
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
  const liveJobSalaries = await Promise.all(
    activeJobs.map(async (j) => {
      const dbSalary = await getCurrentSalary(
        db,
        j.id,
        j.annualSalary,
        asOfDate,
      );
      return {
        job: { id: j.id, personId: j.personId },
        salary: getEffectiveIncome(j, dbSalary),
        totalComp: getTotalCompensation(j, dbSalary),
      };
    }),
  );

  const profileSwitches: ProfileSwitch[] = [];

  const raiseRate = toNumber(settings.salaryAnnualIncrease);

  for (const override of profileSwitchOverrides) {
    const profile = switchProfileMap.get(override.contributionProfileId!);
    if (!profile || profile.isDefault) continue;

    // Extract salary overrides from profile → existing salary override mechanism
    // Profile salary overrides are in today's dollars; grow to the switch year
    const salaryOvr = profile.salaryOverrides as Record<string, number> | null;
    if (salaryOvr && Object.keys(salaryOvr).length > 0) {
      const yearsFromNow = override.projectionYear - currentYear;
      for (const [personIdStr, baseSalary] of Object.entries(salaryOvr)) {
        const grownSalary = baseSalary * Math.pow(1 + raiseRate, yearsFromNow);
        perPersonSalaryOverrides.push({
          personId: Number(personIdStr),
          year: override.projectionYear,
          value: grownSalary,
        });
      }
      // Also add to household-level overrides for single-person fallback
      if (!hasMultiplePeople) {
        const totalGrown =
          Object.values(salaryOvr).reduce((s, v) => s + v, 0) *
          Math.pow(1 + raiseRate, override.projectionYear - currentYear);
        dbSalaryOverrides.push({
          year: override.projectionYear,
          value: totalGrown,
          notes: `Profile: ${profile.name}`,
        });
      }
    }

    // Build contribution data — salary handled above via existing override mechanism
    const resolved = resolveProfile(
      profile,
      liveContribRows,
      activeJobs as (typeof schema.jobs.$inferSelect)[],
      liveJobSalaries,
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
    const switchedTotalComp = resolved.jobSalaries.reduce(
      (s, js) => s + js.totalComp,
      0,
    );
    const switchedTotalContrib = Object.values(
      data.baseYearContributions,
    ).reduce((s, v) => s + v, 0);
    const switchedContribRate =
      switchedTotalComp > 0 ? switchedTotalContrib / switchedTotalComp : 0;

    // Contribution rate ceiling for the switched profile:
    // - Both comp AND contribs > 0: compute the real ratio
    // - Comp > 0 but contribs = 0: the profile is INTENTIONALLY zero (e.g. a
    //   "Coast FIRE" profile — user is saying "stop contributing"). Use 0
    //   so the engine's rate path produces zero contributions. Before: this
    //   silently fell back to 0.25 which defeated the profile's intent.
    // - No comp (missing data): keep the 0.25 safety fallback to avoid
    //   surprising behavior on broken profiles.
    const rateForSwitch =
      switchedContribRate > 0
        ? switchedContribRate
        : switchedTotalComp > 0
          ? 0
          : 0.25;

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
  const totalRealContrib = Object.values(contribByCategory).reduce(
    (s, c) => s + c.annual,
    0,
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
    contributionRate: displayContribRate > 0 ? displayContribRate : 0.25,
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
    currentSalary: totalCompensation,
    salaryGrowthRate: toNumber(settings.salaryAnnualIncrease),
    salaryCap: settings.salaryCap ? toNumber(settings.salaryCap) : null,
    salaryOverrides: dbSalaryOverrides,
    salaryByPerson: hasMultiplePeople ? salaryByPerson : undefined,
    perPersonSalaryOverrides: hasMultiplePeople
      ? perPersonSalaryOverrides
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
