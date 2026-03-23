/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, and profile-switching scenarios. */
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateRelocation } from "@/lib/calculators/relocation";
import {
  num,
  getCurrentSalary,
  getEffectiveIncome,
  getTotalCompensation,
  getPeriodsPerYear,
  getLatestSnapshot,
  getAnnualExpensesFromBudget,
  computeBudgetAnnualTotal,
  requireLimit,
  computeAnnualContribution,
  computeEmployerMatch,
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
} from "@/lib/config/account-types";
import { getAge } from "@/lib/utils/date";
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
  const filingStatus = settings.filingStatus ?? primaryActiveJobs[0]?.w4FilingStatus ?? "MFJ";
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
        if (a.taxType === "taxFree") addRoth(bal, a.amount);
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
  // Cost basis from app_settings (default 0 = conservative, treats all as gain)
  const settingsMap = new Map(
    allAppSettings.map((s: { key: string; value: unknown }) => [
      s.key,
      s.value,
    ]),
  );
  const costBasisRaw = settingsMap.get("brokerage_cost_basis");
  const costBasisVal =
    costBasisRaw != null && costBasisRaw !== "null"
      ? num(String(costBasisRaw))
      : 0;
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
      ? num(String(rampRaw).replace(/"/g, ""))
      : 0;
  const limitGrowthRaw = settingsMap.get("irs_limit_growth_rate");
  const irsLimitGrowthRate =
    limitGrowthRaw != null
      ? num(String(limitGrowthRaw))
      : IRS_LIMIT_GROWTH_RATE;

  // IRS limits
  const limitsMap: Record<string, number> = {};
  for (const l of allLimits) limitsMap[l.limitType] = num(l.value);

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
      value: num(o.overrideSalary),
      notes: o.notes ?? undefined,
    }));

  // Per-person salary overrides (all people) — excludes profile-switch rows
  const perPersonSalaryOverrides = plainSalaryOverrides.map((o) => ({
    personId: o.personId,
    year: o.projectionYear,
    value: num(o.overrideSalary),
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
  const switchProfileMap = new Map(
    switchProfileRows.map((p) => [p.id, p]),
  );

  // Budget overrides from DB (stored as monthly, engine expects monthly too)
  const dbBudgetOverrides = budgetOverrideRows
    .filter((o) => o.personId === primaryPerson.id)
    .map((o) => ({
      year: o.projectionYear,
      value: num(o.overrideMonthlyBudget),
      notes: o.notes ?? undefined,
    }));

  // Return rates — include the floor rate (highest age ≤ current age) so the
  // engine always has a rate for the starting year, plus all future rates.
  const floorRate = returnRates
    .filter((r) => r.age <= age)
    .sort((a, b) => b.age - a.age)[0];
  const relevantReturnRates = returnRates
    .filter((r) => r.age >= age || (floorRate && r.age === floorRate.age))
    .map((r) => ({ label: `Age ${r.age}`, rate: num(r.rateOfReturn) }));

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
  const profileContribCtx = {
    perfCategoryMap,
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
    activeJobs.map((j) => ({ id: j.id, personId: j.personId, payPeriod: j.payPeriod })),
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
      const dbSalary = await getCurrentSalary(db, j.id, j.annualSalary, asOfDate);
      return {
        job: { id: j.id, personId: j.personId },
        salary: getEffectiveIncome(j, dbSalary),
        totalComp: getTotalCompensation(j, dbSalary),
      };
    }),
  );

  const profileSwitches: ProfileSwitch[] = [];

  const raiseRate = num(settings.salaryAnnualIncrease);

  for (const override of profileSwitchOverrides) {
    const profile = switchProfileMap.get(override.contributionProfileId!);
    if (!profile || profile.isDefault) continue;

    // Extract salary overrides from profile → existing salary override mechanism
    // Profile salary overrides are in today's dollars; grow to the switch year
    const salaryOvr = profile.salaryOverrides as Record<string, number> | null;
    if (salaryOvr && Object.keys(salaryOvr).length > 0) {
      const yearsFromNow = override.projectionYear - currentYear;
      for (const [personIdStr, baseSalary] of Object.entries(salaryOvr)) {
        const grownSalary =
          baseSalary * Math.pow(1 + raiseRate, yearsFromNow);
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

    profileSwitches.push({
      year: override.projectionYear,
      contributionSpecs: data.contributionSpecs,
      employerMatchRateByCategory: data.employerMatchRateByCategory,
      baseYearContributions: data.baseYearContributions,
      baseYearEmployerMatch: data.baseYearEmployerMatch,
      employerMatchByParentCat: data.employerMatchByParentCat,
      contributionRate:
        switchedContribRate > 0 ? switchedContribRate : 0.25,
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
    ? num(selectedScenario.distributionTaxRateTraditional)
    : 0;
  const dbBrokerageRate = selectedScenario
    ? num(selectedScenario.distributionTaxRateBrokerage)
    : 0;
  const taxMult = num(settings.taxMultiplier);

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
    roth: selectedScenario ? num(selectedScenario.distributionTaxRateRoth) : 0,
    hsa: selectedScenario ? num(selectedScenario.distributionTaxRateHsa) : 0,
    brokerage: effectiveBrokerageRate,
    taxBrackets: bracketData.length > 0 ? bracketData : undefined,
    taxMultiplier: taxMult,
    grossUpForTaxes: settings.grossUpForTaxes,
    rothBracketTarget: num(settings.rothBracketTarget ?? "0.12"),
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget:
      settings.rothConversionTarget != null
        ? num(settings.rothConversionTarget)
        : undefined,
  };

  // Base engine input (without accumulationOverrides, decumulationOverrides, decumulationDefaults)
  const baseEngineInput = {
    accumulationDefaults: derivedAccumulationDefaults,
    currentAge: age,
    retirementAge: avgRetirementAge,
    projectionEndAge: maxEndAge,
    currentSalary: totalCompensation,
    salaryGrowthRate: num(settings.salaryAnnualIncrease),
    salaryCap: settings.salaryCap ? num(settings.salaryCap) : null,
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
      targetAmount: num(g.targetAmount),
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
    inflationRate: num(settings.annualInflation),
    postRetirementInflationRate: settings.postRetirementInflation
      ? num(settings.postRetirementInflation)
      : undefined,
    returnRates: relevantReturnRates,
    socialSecurityAnnual: num(settings.socialSecurityMonthly) * 12,
    ssStartAge: settings.ssStartAge,
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
    perfAccountMap,
    dbSalaryOverrides,
    dbBudgetOverrides,
    // The base engine input (callers add overrides + decumulationDefaults)
    baseEngineInput,
  };
}

export const retirementRouter = createTRPCRouter({
  computeRelocationAnalysis: protectedProcedure
    .input(
      z.object({
        /** Profile ID + column index for current budget scenario. */
        currentProfileId: z.number().int(),
        currentBudgetColumn: z.number().int().min(0),
        /** Manual monthly expense override for current budget (overrides profile). */
        currentExpenseOverride: z.number().min(0).nullable().default(null),
        /** Profile ID + column index for relocation budget scenario. */
        relocationProfileId: z.number().int(),
        relocationBudgetColumn: z.number().int().min(0),
        /** Manual monthly expense override for relocation budget (overrides profile). */
        relocationExpenseOverride: z.number().min(0).nullable().default(null),
        /** Year-specific monthly expense overrides for the relocation scenario. */
        yearAdjustments: z
          .array(
            z.object({
              year: z.number().int(),
              monthlyExpenses: z.number(),
              profileId: z.number().int().optional(),
              budgetColumn: z.number().int().min(0).optional(),
              notes: z.string().optional(),
            }),
          )
          .default([]),
        /** Year-specific contribution rate overrides (% of salary, sticky forward). */
        contributionOverrides: z
          .array(
            z.object({
              year: z.number().int(),
              rate: z.number().min(0).max(1),
              notes: z.string().optional(),
            }),
          )
          .default([]),
        /** Large purchases tied to the relocation (home, car, furniture, etc.). */
        largePurchases: z
          .array(
            z.object({
              name: z.string(),
              purchasePrice: z.number().min(0),
              downPaymentPercent: z.number().min(0).max(1).optional(),
              loanRate: z.number().min(0).optional(),
              loanTermYears: z.number().int().min(0).optional(),
              ongoingMonthlyCost: z.number().min(0).optional(),
              saleProceeds: z.number().min(0).optional(),
              purchaseYear: z.number().int(),
            }),
          )
          .default([]),
        /** Contribution profile for current scenario (null = live DB). */
        currentContributionProfileId: z.number().int().nullable().default(null),
        /** Contribution profile for relocation scenario (null = live DB). */
        relocationContributionProfileId: z
          .number()
          .int()
          .nullable()
          .default(null),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [
        people,
        allJobs,
        retSettings,
        retScenarios,
        returnRates,
        allContribsRaw,
        snapshotData,
        allBudgetProfiles,
        allBudgetItems,
        perfAccounts,
      ] = await Promise.all([
        ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
        ctx.db.select().from(schema.jobs),
        ctx.db.select().from(schema.retirementSettings),
        ctx.db.select().from(schema.retirementScenarios),
        ctx.db
          .select()
          .from(schema.returnRateTable)
          .orderBy(asc(schema.returnRateTable.age)),
        ctx.db
          .select()
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.isActive, true)),
        getLatestSnapshot(ctx.db),
        ctx.db
          .select()
          .from(schema.budgetProfiles)
          .orderBy(asc(schema.budgetProfiles.id)),
        ctx.db.select().from(schema.budgetItems),
        ctx.db.select().from(schema.performanceAccounts),
      ]);
      // Filter to Retirement-only contributions for the relocation tool
      const perfCatMap = new Map(
        perfAccounts.map((p) => [p.id, p.parentCategory]),
      );
      const allContribs = allContribsRaw.filter(
        (c) =>
          c.performanceAccountId != null &&
          perfCatMap.get(c.performanceAccountId) === "401k/IRA",
      );

      const primaryPerson = people.find((p) => p.isPrimaryUser) ?? people[0];
      if (!primaryPerson) return { result: null, budgetInfo: null };

      const settings = retSettings.find((s) => s.personId === primaryPerson.id);
      if (!settings) return { result: null, budgetInfo: null };

      if (allBudgetProfiles.length === 0)
        return { result: null, budgetInfo: null };

      // Build per-profile column totals
      const profileSummaries = allBudgetProfiles.map((p) => {
        const items = allBudgetItems.filter((i) => i.profileId === p.id);
        const labels = p.columnLabels as string[];
        const months = (p.columnMonths as number[] | null) ?? null;
        const totals = labels.map((_: string, colIdx: number) =>
          items.reduce(
            (sum: number, item) =>
              sum + ((item.amounts as number[])[colIdx] ?? 0),
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

      // Look up current and relocation monthly expenses
      const currentProfile = profileSummaries.find(
        (p) => p.id === input.currentProfileId,
      );
      const relocProfile = profileSummaries.find(
        (p) => p.id === input.relocationProfileId,
      );
      if (!currentProfile || !relocProfile)
        return { result: null, budgetInfo: null };

      // Resolve monthly expenses: override > weighted (if columnMonths) > column total
      const resolveMonthly = (
        profile: typeof currentProfile,
        col: number,
        override: number | null,
      ): number => {
        if (override !== null) return override;
        if (profile.columnMonths) {
          // Weighted: sum(columnTotal[i] * months[i]) / 12
          const months = profile.columnMonths as number[];
          return (
            profile.columnTotals.reduce(
              (sum: number, t: number, i: number) => sum + t * (months[i] ?? 0),
              0,
            ) / 12
          );
        }
        return profile.columnTotals[col] ?? 0;
      };
      const currentMonthly = resolveMonthly(
        currentProfile,
        input.currentBudgetColumn,
        input.currentExpenseOverride,
      );
      const relocationMonthly = resolveMonthly(
        relocProfile,
        input.relocationBudgetColumn,
        input.relocationExpenseOverride,
      );

      // Resolve year adjustments: when a profileId is set, look up the monthly amount from that profile+column
      const resolvedYearAdjustments = input.yearAdjustments.map((adj) => {
        if (adj.profileId != null && adj.budgetColumn != null) {
          const adjProfile = profileSummaries.find(
            (p) => p.id === adj.profileId,
          );
          if (adjProfile) {
            return {
              ...adj,
              monthlyExpenses: resolveMonthly(
                adjProfile,
                adj.budgetColumn,
                null,
              ),
            };
          }
        }
        return adj;
      });

      // Age
      // Age as of today (calendar-accurate via getAge)
      const age = getAge(new Date(primaryPerson.dateOfBirth), new Date());

      // Portfolio — only retirement-category accounts from latest balance snapshot
      let portfolioTotal = 0;
      if (snapshotData) {
        for (const a of snapshotData.accounts) {
          if (a.parentCategory && a.parentCategory !== "Retirement") continue;
          portfolioTotal += a.amount;
        }
      }

      // Salary
      const asOfDate = new Date();
      const activeJobs = allJobs.filter((j) => !j.endDate);
      const jobSalaries = await Promise.all(
        activeJobs.map(async (j) => {
          const dbSalary = await getCurrentSalary(
            ctx.db,
            j.id,
            j.annualSalary,
            asOfDate,
          );
          return { job: j, salary: getEffectiveIncome(j, dbSalary) };
        }),
      );
      const liveCombinedSalary = jobSalaries.reduce(
        (s, js) => s + js.salary,
        0,
      );

      // Contributions (live data)
      const activeContribs = allContribs.filter(
        (c) =>
          activeJobs.some((j) => j.id === c.jobId) ||
          (c.jobId === null && people.some((p) => p.id === c.personId)),
      );

      // Helper to compute totals from a set of contrib rows + job salaries
      const computeContribTotals = (
        contribs: typeof activeContribs,
        salaries: typeof jobSalaries,
      ) => {
        let totalContribs = 0;
        let totalEmployerMatch = 0;
        for (const c of contribs) {
          const cv = num(c.contributionValue);
          const js = salaries.find((x) => x.job.id === c.jobId);
          const job = activeJobs.find((j) => j.id === c.jobId);
          const salary = js?.salary ?? 0;
          const periods = getPeriodsPerYear(job?.payPeriod ?? "biweekly");
          const annual = computeAnnualContribution(
            c.contributionMethod,
            cv,
            salary,
            periods,
          );
          totalContribs += annual;
          totalEmployerMatch += computeEmployerMatch(
            c.employerMatchType,
            num(c.employerMatchValue),
            num(c.employerMaxMatchPct),
            annual,
            c.contributionMethod,
            cv,
            salary,
          );
        }
        return { totalContribs, totalEmployerMatch };
      };

      // Resolve contribution profiles for each scenario
      const resolveContribProfile = async (profileId: number | null) => {
        if (!profileId) {
          const totals = computeContribTotals(activeContribs, jobSalaries);
          return {
            combinedSalary: liveCombinedSalary,
            annualContributions: totals.totalContribs,
            employerMatch: totals.totalEmployerMatch,
          };
        }

        const profiles = await ctx.db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, profileId));
        const profile = profiles[0];
        if (!profile || profile.isDefault) {
          const totals = computeContribTotals(activeContribs, jobSalaries);
          return {
            combinedSalary: liveCombinedSalary,
            annualContributions: totals.totalContribs,
            employerMatch: totals.totalEmployerMatch,
          };
        }

        // Apply salary overrides
        const salaryOverrides = profile.salaryOverrides as Record<
          string,
          number
        >;
        const resolvedSalaries = jobSalaries.map((js) => {
          const override = salaryOverrides[String(js.job.personId)];
          return override !== undefined ? { ...js, salary: override } : js;
        });
        const resolvedCombinedSalary = resolvedSalaries.reduce(
          (s, js) => s + js.salary,
          0,
        );

        // Apply contribution overrides
        const contribOverridesRoot = profile.contributionOverrides as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        const contribOverrides =
          contribOverridesRoot.contributionAccounts ?? {};

        const resolvedContribs = activeContribs
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
            return !(overrides && overrides.isActive === false);
          });

        const totals = computeContribTotals(resolvedContribs, resolvedSalaries);
        return {
          combinedSalary: resolvedCombinedSalary,
          annualContributions: totals.totalContribs,
          employerMatch: totals.totalEmployerMatch,
        };
      };

      const currentContribData = await resolveContribProfile(
        input.currentContributionProfileId,
      );
      const relocContribData = await resolveContribProfile(
        input.relocationContributionProfileId,
      );

      // Average return rate from age-indexed table (include floor rate)
      const relocFloor = returnRates
        .filter((r) => r.age <= age)
        .sort((a, b) => b.age - a.age)[0];
      const relevantRates = returnRates
        .filter(
          (r) =>
            (r.age >= age && r.age <= settings.retirementAge) ||
            (relocFloor && r.age === relocFloor.age),
        )
        .map((r) => num(r.rateOfReturn));
      const avgReturnRate =
        relevantRates.length > 0
          ? relevantRates.reduce((s, r) => s + r, 0) / relevantRates.length
          : 0.07;

      const selectedScenario = retScenarios.find((s) => s.isSelected);
      const salaryGrowthRate = num(settings.salaryAnnualIncrease);

      const result = calculateRelocation({
        currentMonthlyExpenses: currentMonthly,
        relocationMonthlyExpenses: relocationMonthly,
        yearAdjustments: resolvedYearAdjustments,
        contributionOverrides: input.contributionOverrides,
        largePurchases: input.largePurchases,
        currentAge: age,
        retirementAge: settings.retirementAge,
        currentPortfolio: portfolioTotal,
        currentAnnualContributions: currentContribData.annualContributions,
        currentEmployerContributions: currentContribData.employerMatch,
        currentCombinedSalary: currentContribData.combinedSalary,
        relocationAnnualContributions: relocContribData.annualContributions,
        relocationEmployerContributions: relocContribData.employerMatch,
        relocationCombinedSalary: relocContribData.combinedSalary,
        currentSalaryGrowthRate: salaryGrowthRate,
        relocationSalaryGrowthRate: salaryGrowthRate,
        withdrawalRate: selectedScenario
          ? num(selectedScenario.withdrawalRate)
          : num(settings.withdrawalRate),
        inflationRate: num(settings.annualInflation),
        nominalReturnRate: avgReturnRate,
        socialSecurityAnnual: num(settings.socialSecurityMonthly) * 12,
        asOfDate,
      });

      return {
        result,
        budgetInfo: {
          profiles: profileSummaries,
          currentProfileId: input.currentProfileId,
          currentColumnIndex: input.currentBudgetColumn,
          relocationProfileId: input.relocationProfileId,
          relocationColumnIndex: input.relocationBudgetColumn,
        },
        currentContribProfile: {
          annualContributions: roundToCents(
            currentContribData.annualContributions,
          ),
          employerMatch: roundToCents(currentContribData.employerMatch),
          combinedSalary: roundToCents(currentContribData.combinedSalary),
        },
        relocationContribProfile: {
          annualContributions: roundToCents(
            relocContribData.annualContributions,
          ),
          employerMatch: roundToCents(relocContribData.employerMatch),
          combinedSalary: roundToCents(relocContribData.combinedSalary),
        },
      };
    }),

  // getProjection and getMonteCarloProjection moved to projection.ts
});
