/**
 * Retirement-scoped engine payload: turns `fetchRetirementData` (load.ts) into `baseEngineInput`
 * plus the computed values the retirement routers expose. Callers add their own
 * accumulation/decumulation overrides and decumulation defaults.
 */
import { storedInteger } from "@/lib/utils/stored-integer";
import { calendarYear } from "@/lib/utils/date";
import { loadExpenseEndings } from "./expense-endings";
import {
  householdTimeline,
  planEndAge,
  planRetirementAge,
} from "@/lib/pure/household/household-timeline";
import { emptyTaxBucketMap } from "@/lib/config/tax-treatment-buckets";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import {
  retirementFilingStatus,
  storedProfileFilingStatus,
} from "@/lib/pure/tax/filing-status";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import {
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import { buildProfileContribData } from "@/lib/pure/contributions/profile-contrib-data";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { toNumber } from "@/lib/utils/numbers";
import {
  resolveRetirementProfileIdFrom,
  pickProfileSettingsRow,
} from "@/lib/pure/household/retirement-profile";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAllCategories,
  categoriesWithTaxPreference,
  getDefaultAccumulationOrder,
  isRetirementMoney,
} from "@/lib/config/account-types";
import type { SimpleTaxModeParts } from "@/lib/pure/tax/simple-tax-mode";
import { sumBy, safeDivide } from "@/lib/utils/math";
import {
  IRS_LIMIT_GROWTH_RATE,
  IRS_LIMIT_GROWTH_RATE_MAX,
  FALLBACK_CONTRIBUTION_RATE,
} from "@/lib/constants";
import { log } from "@/lib/logger";
import { buildSocialSecurityEntries } from "@/lib/pure/retirement/social-security-entries";
import { buildDistributionTaxRates } from "@/lib/pure/tax/distribution-tax-rates";
import { resolvePhaseExpenses } from "./budget-expenses";
import {
  buildProfileSwitches,
  capAgeSteps,
  loadSwitchProfiles,
  profileSwitchFrom,
} from "./profile-switches";
import { retirementContributions } from "@/lib/pure/contributions/retirement-contributions";
import { applyProfiles, type RetirementData } from "./load";
import { perPersonSettingsFor, type ActiveProfileRows } from "./settings-for";
import { budgetSummaries } from "./display";
import { resolveTaxYear } from "@/lib/pure/tax/resolve-tax-year";
import { startingAccounts } from "./accounts";
import { capContributions } from "@/lib/pure/contributions/cap-contributions";
import { projectionJobs, workingYears } from "@/lib/pure/household/profiles";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_IRS_LIMIT_GROWTH_RATE,
} from "@/lib/constants/settings-keys";
import type { Db } from "@/lib/db";

/**
 * Build the shared engine payload from raw DB data: computed values plus a base engine input
 * without the per-caller accumulation/decumulation overrides and decumulation defaults.
 */
export async function buildEnginePayload(
  db: Db,
  data: RetirementData,
  opts: {
    asOf: Date;
    contributionProfileId?: number;
    salaryProfileId?: number;
    accumulationBudgetProfileId?: number;
    accumulationBudgetColumn?: number;
    accumulationExpenseOverride?: number;
    decumulationBudgetProfileId?: number;
    decumulationBudgetColumn?: number;
    decumulationExpenseOverride?: number;
    /** View a non-active retirement profile without making it active, like
     *  contributionProfileId/salaryProfileId. An id that names no profile is
     *  ignored (the active-profile resolution applies). */
    retirementProfileId?: number;
    /** What-if: everyone retires this many years later (negative: sooner).
     *  Applied before the timeline, so every window built from it moves
     *  too; the saved settings are untouched. */
    retirementAgeDelta?: number;
  },
) {
  const {
    people,
    retSettings,
    retProfiles,
    retProfilePeople,
    retScenarios,
    returnRates,
    allContribsRaw,
    allLimits,
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
    defaultPreset,
    classBucketRows,
  } = data;

  const { salaryProfileActiveMap, allContribs, patchedJobs, profileOpts } =
    await applyProfiles(db, data, opts);

  const primaryPerson = getPrimaryPerson(people);
  if (!primaryPerson) return null;

  // Household assumptions come from the active profile's row, not from
  // whichever person is primary, so profiles are swappable.
  const activeProfileId =
    opts.retirementProfileId != null &&
    retProfiles.some((p) => p.id === opts.retirementProfileId)
      ? opts.retirementProfileId
      : resolveRetirementProfileIdFrom(allAppSettings, retProfiles);
  // pickProfileSettingsRow prefers the PRIMARY person's row in the profile:
  // every person's row shares the profile id and their household columns can
  // disagree, so an arbitrary match moves real numbers.
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
    asOf: opts.asOf,
    salaryProfileActiveMap,
  });
  const filingStatus = retirementFilingStatus(
    profileStatus,
    thisYearFiling.status,
  );

  const {
    resolvedTax,
    latestTaxYear,
    ltcgBracketData,
    irmaaBracketData,
    fplByHouseholdData,
    bracketData,
    missingLimitsWarning,
  } = resolveTaxYear(
    filingStatus,
    retProfiles,
    activeProfileId,
    allTaxParams,
    allLimits,
    allTaxBrackets,
    allLtcgBrackets,
    allIrmaaBrackets,
    allFplByHousehold,
  );

  // Per-person retirement settings from the active profile's rows. A person
  // with no `retirement_settings` row inherits `primaryRaiseRate`, here and in
  // profile switches' salary-override growth alike.
  const primaryRaiseRate = toNumber(settings.salaryAnnualIncrease);
  const activeProfileRows: ActiveProfileRows = {
    activeProfileId,
    profilePeople: retProfilePeople.filter(
      (r) => r.profileId === activeProfileId,
    ),
    retSettings,
    settings,
    primaryRaiseRate,
  };
  const { perPersonSettings } = perPersonSettingsFor(
    people,
    activeProfileRows,
    opts,
  );
  // The plan's "as of": a selected historical snapshot's date, else opts.asOf.
  const asOfDate = data.snapshotData?.snapshot.snapshotDate
    ? new Date(data.snapshotData.snapshot.snapshotDate)
    : opts.asOf;
  const currentYear = asOfDate.getFullYear();
  const { budgetProfileSummaries } = await budgetSummaries(
    allBudgetProfiles,
    allBudgetItems,
    db,
    profileOpts,
  );

  // Each person's current job, or the next one they start; its dates bound the years worked.
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
  // Each job's totalComp. A Salary Profile entry is complete, so
  // currentYearBonusAdjustment stays empty in the payload shape the engine reads.
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
  // combinedSalary = base salaries, the payroll basis for percent-of-pay
  // contributions and the match (bonus checks: contributionPay).
  // totalCompensation includes the resolved bonus, for display and current rates.
  const totalCompensation = sumBy(jobSalaries, (js) => js.totalComp);
  // The engine's compounding baseline — full-formula bonus, see
  // currentYearBonusAdjustmentByPerson's docblock above.
  const totalCompensationFullFormula = sumBy(
    jobSalaries,
    (js) => js.totalCompFullFormula,
  );

  const {
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    inputWarnings,
    personNameById,
    birthYearByPersonId,
    individualAccounts,
  } = startingAccounts(data, {
    settings,
    activeProfileId,
    opts,
    perPersonSettings,
    asOfDate,
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
  // Settable in Settings → Reference Data → Return Rates, else the constant.
  // Bounded here, the single read point: a NaN or out-of-range value would
  // compound through Math.pow(1 + rate, year) and wreck every projection.
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

  const {
    limitsMap,
    irsLimitPeople,
    capHousehold,
    activeContribs,
    irsLimitAccounts,
    irsGroupLimits,
    contribByCategory,
    employerMatchByCategory,
    retirementContrib,
  } = capContributions(
    resolvedTax,
    people,
    birthYearByPersonId,
    thisYearFiling,
    asOfDate,
    allContribs,
    activeJobs,
    jobSalaries,
  );

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

  // Profile-switch overrides vs plain salary overrides: a row is a switch if it
  // references EITHER axis (Contribution or Salary Profile, independently).
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

  const { switchProfileMap, switchSalaryProfileMap, switchWarnings } =
    await loadSwitchProfiles(db, profileSwitchOverrides);
  inputWarnings.push(...switchWarnings, ...missingLimitsWarning);

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
  const globalActiveCol = storedInteger(globalColSetting, 0);
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
    opts: profileOpts,
  });
  const annualExpensesVal = accumulationExpenses;
  const expenseEndings = await loadExpenseEndings(db, {
    items: allBudgetItems,
    accumulation: {
      profile: accProfile,
      column: accCol,
      annual: accumulationExpenses,
      typed: !!opts.accumulationExpenseOverride,
    },
    decumulation: {
      profile: decProfile,
      column: decCol,
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
    perfAccounts.map((p) => [p.id, p.retirementBehavior]),
  );
  const perfContributionScalingMap = new Map(
    perfAccounts.map((p) => [p.id, p.contributionScaling]),
  );
  const profileContribCtx = {
    perfCategoryMap,
    perfRetirementBehaviorMap,
    perfContributionScalingMap,
    personNameById,
    accountBreakdownByCategory,
  };

  // The row as the profile's contribution data reads it: its type narrowed, no label as null.
  const toContribDataRow = (c: (typeof activeContribs)[number]) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    label: c.label ?? null,
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
  // Contribution Profile switch: a year whose ages cap it differently (catch-up
  // from 50, 60–63, 64) switches to it capped then.
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
  // A switch row that sets a salary adds to the salary overrides after the
  // plain rows, so for a year both set, the switch row's salary wins.
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

  // As for a profile switch's rate: contributing, but not to retirement money,
  // is a 0% retirement rate (the fallback would invent 25% of salary); only
  // missing data falls back.
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
    // Always passed: retirement starts from the Retirement budget, and the
    // Coast FIRE need test has a need, even when it equals the working one.
    decumulationAnnualExpenses: decumulationExpenses,
    inflationRate: toNumber(settings.annualInflation),
    postRetirementInflationRate: settings.postRetirementInflation
      ? toNumber(settings.postRetirementInflation)
      : undefined,
    returnRates: relevantReturnRates,
    // Single person: amount (personAnnualAmount, above) and start age both come
    // from `perPersonSettings[0]`, never the `settings` scalar: one row drives
    // both, and retirement_profile_people holds the edited values.
    socialSecurityAnnual:
      perPersonSettings.length === 1
        ? buildSocialSecurityEntries([perPersonSettings[0]!], filingStatus)[0]!
            .annualAmount
        : toNumber(settings.socialSecurityMonthly) * 12,
    ssStartAge:
      perPersonSettings.length === 1
        ? perPersonSettings[0]!.ssStartAge
        : settings.ssStartAge,
    // Entries only for multi-person households: they also feed rmdStartAgeByPerson,
    // which switches on per-person RMDs, so a single person's SS goes through
    // socialSecurityAnnual above. No start-age shift: this is the real plan.
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
