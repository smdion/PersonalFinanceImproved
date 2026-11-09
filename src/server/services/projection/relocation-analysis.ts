/** The relocation analysis (retirement.computeRelocationAnalysis): its
 *  input, the two budget and contribution scenarios being compared. */
import { z } from "zod/v4";
import type { RequestScope } from "@/server/data/request-scope";
import { householdRetirementYear } from "@/server/services/profiles/retirement-year";
import {
  capResolvedProfile,
  loadCapHousehold,
} from "@/server/services/contributions/caps";
import type { CapPassed } from "@/lib/pure/contributions/contribution-caps";
import { returnRateAtAge } from "@/lib/pure/simulation/return-rate-breakpoints";
import { eq, asc } from "drizzle-orm";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
import * as schema from "@/lib/db/schema";
import { calculateRelocation } from "@/lib/pure/retirement/relocation";
import {
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
  mergeSalaryProfileJobFields,
} from "@/lib/pure/household/compensation";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { fetchContributionProfile } from "@/server/services/contributions/profile";
import { resolveProfile } from "@/server/services/contributions/profile";
import type { ContribRowWithActiveFields } from "@/server/services/contributions/profile";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { toNumber } from "@/lib/utils/numbers";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { getAllPeople } from "@/server/data/people";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import {
  isRetirementParent,
  type AccountCategory,
} from "@/lib/config/account-types";
import { ageOnDate } from "@/lib/pure/household/age";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { filterActiveJobs } from "@/lib/pure/household/profiles";
import { loadActiveRetirementSettings } from "@/server/data/retirement-settings";
import type { Db } from "@/lib/db";

export const zRelocationAnalysisInput = z.object({
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
  relocationContributionProfileId: z.number().int().nullable().default(null),
});

export async function computeRelocationAnalysis(
  ctx: { db: Db; scope: RequestScope },
  input: z.output<typeof zRelocationAnalysisInput>,
) {
  const [
    people,
    allJobs,
    retScenarios,
    returnRates,
    allContributionsRaw,
    snapshotData,
    allBudgetProfiles,
    allBudgetItems,
    perfAccounts,
    appSettingsRows,
  ] = await Promise.all([
    getAllPeople(ctx.db),
    ctx.db.select().from(schema.jobs),
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
    ctx.db.select().from(schema.appSettings),
  ]);
  // Filter to Retirement-only contributions for the relocation tool.
  const perfCatMap = new Map(perfAccounts.map((p) => [p.id, p.parentCategory]));
  const allContributions = allContributionsRaw.filter(
    (c) =>
      c.performanceAccountId != null &&
      isRetirementParent(perfCatMap.get(c.performanceAccountId)),
  );

  const primaryPerson = getPrimaryPerson(people);
  if (!primaryPerson) return { result: null, budgetInfo: null };

  // Active profile's row, matching build-engine-payload — the readiness
  // analysis must read the same assumptions the projection does.
  const settings = await loadActiveRetirementSettings(
    ctx.db,
    appSettingsRows,
    primaryPerson.id,
  );
  if (!settings) return { result: null, budgetInfo: null };

  if (allBudgetProfiles.length === 0) return { result: null, budgetInfo: null };

  // Build per-profile column totals — resolved through the same
  // contribution-account chain computeActiveSummary/build-engine-payload.ts
  // use (see resolveLinkedBudgetItemAmounts) rather than raw `amounts`,
  // which is intentionally stale for contribution-linked items. Active
  // profiles throughout, matching this endpoint's
  // documented "control arm" salary resolution below.
  const profileSummaries = await Promise.all(
    allBudgetProfiles.map(async (p) => {
      const items = allBudgetItems.filter((i) => i.profileId === p.id);
      const labels = p.columnLabels as string[];
      const months = (p.columnMonths as number[] | null) ?? null;
      const numColumns = labels.length;
      const activeProfiles = await resolveProfileSelection(ctx.scope);
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        ctx,
        items,
        numColumns,
        activeProfiles,
      );
      const totals = labels.map((_: string, colIndex: number) =>
        resolvedItems.reduce(
          (sum: number, item) => sum + (item.amounts[colIndex] ?? 0),
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
    }),
  );

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
      const adjProfile = profileSummaries.find((p) => p.id === adj.profileId);
      if (adjProfile) {
        return {
          ...adj,
          monthlyExpenses: resolveMonthly(adjProfile, adj.budgetColumn, null),
        };
      }
    }
    return adj;
  });

  // Age
  // When a historical snapshot is selected, use its date as the reference point
  const referenceDate = snapshotData?.snapshot.snapshotDate
    ? new Date(snapshotData.snapshot.snapshotDate)
    : ctx.scope.asOf;
  const age = ageOnDate(primaryPerson.dateOfBirth, referenceDate);

  // Portfolio — only retirement-category accounts from latest balance snapshot
  let portfolioTotal = 0;
  if (snapshotData) {
    for (const a of snapshotData.accounts) {
      if (a.parentCategory && !isRetirementParent(a.parentCategory)) continue;
      portfolioTotal += a.amount;
    }
  }

  // Salary — the control arm of the relocation comparison. A job has no
  // salary/bonus of its own any more, so the ACTIVE Salary Profile is
  // the only live source (see resolveCompensation's docblock).
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(ctx.db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    filterActiveJobs(allJobs, referenceDate),
    salaryProfileActiveMap,
  );
  const jobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: j,
      ...contributionPay(comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
      resolvedBonusOverride: null,
    };
  });
  // Contributions (live data)
  const activeContributions = allContributions.filter(
    (c) =>
      activeJobs.some((j) => j.id === c.jobId) ||
      (c.jobId === null && people.some((p) => p.id === c.personId)),
  );

  // Yearly contributions and employer match for one arm — the one
  // summary path (aggregateContributionsByCategory: bonus checks per
  // account's fromBonus, the per-account match pay, incomplete
  // accounts). `contribs` is always resolveProfile's output, never the
  // raw activeContributions rows, which carry no value of their own. Jobs are
  // the arm's profile-patched ones, so a profile's pay schedule counts.
  const computeContributionTotals = (
    contribs: (ContribRowWithActiveFields & CapPassed)[],
    salaries: typeof jobSalaries,
    jobsForPeriods: {
      id: number;
      personId: number;
      payPeriod: string | undefined;
    }[] = activeJobs,
  ) => {
    const r = aggregateContributionsByCategory(
      contribs.map((c) => ({
        ...c,
        accountType: c.accountType as AccountCategory,
        parentCategory: c.parentCategory ?? "",
      })),
      jobsForPeriods,
      salaries.map((js) => ({
        job: { id: js.job.id, personId: js.job.personId },
        salary: js.salary,
        bonusGross: js.bonusGross,
      })),
    );
    return {
      totalContributions: sumBy(
        Object.values(r.contribByCategory),
        (c) => c.annual,
      ),
      totalEmployerMatch: sumBy(
        Object.values(r.employerMatchByCategory),
        (m) => m,
      ),
      incompleteIds: r.incompleteAccountIds,
    };
  };

  // Resolve contribution profiles for each scenario. No profile (or a
  // stale id that no longer exists) resolves against an empty active-fields
  // map — accounts carry no value of their own anymore, so this correctly
  // yields zero contributions rather than a "live" reading of the raw rows.
  const capHousehold = await loadCapHousehold(
    ctx.db,
    people,
    null,
    ctx.scope.asOf,
    referenceDate.getFullYear(),
  );
  const resolveContributionProfile = async (profileId: number | null) => {
    const profile = profileId
      ? await fetchContributionProfile(ctx.db, profileId)
      : null;

    // jobSalaries already reflects the active Salary Profile: this is the
    // relocation analysis's comparison arm, so no Plan-specific salary applies.
    const resolved = resolveProfile(
      profile ?? { contributionActiveFields: {} },
      activeContributions,
      activeJobs,
      jobSalaries,
      salaryProfileActiveMap,
    );
    const resolvedCombinedSalary = resolved.jobSalaries.reduce(
      (s, js) => s + js.salary,
      0,
    );

    const totals = computeContributionTotals(
      capResolvedProfile(resolved, capHousehold),
      resolved.jobSalaries,
      resolved.activeJobs,
    );
    return {
      combinedSalary: resolvedCombinedSalary,
      annualContributions: totals.totalContributions,
      employerMatch: totals.totalEmployerMatch,
      incompleteAccountIds: totals.incompleteIds,
    };
  };

  const currentContributionData = await resolveContributionProfile(
    input.currentContributionProfileId,
  );
  const relocContributionData = await resolveContributionProfile(
    input.relocationContributionProfileId,
  );

  // Average return rate over the years to retirement, each year at the
  // breakpoint in effect (returnRateAtAge) — per year, not per row, so
  // a table with one row per age and its collapsed form agree.
  const rateBreakpoints = returnRates.map(
    (r) => [r.age, toNumber(r.rateOfReturn)] as const,
  );
  const yearRates: number[] = [];
  // When the plan's withdrawals start, as the primary person's age.
  const plannedYear = await householdRetirementYear(ctx.db, ctx.scope.asOf);
  const retirementAge =
    plannedYear !== null
      ? age + plannedYear - referenceDate.getFullYear()
      : settings.retirementAge;
  for (let a = age; a <= Math.max(age, retirementAge); a++) {
    const r = returnRateAtAge(rateBreakpoints, a);
    if (r !== null) yearRates.push(r);
  }
  const avgReturnRate =
    yearRates.length > 0
      ? yearRates.reduce((s, r) => s + r, 0) / yearRates.length
      : DEFAULT_RETURN_RATE;

  const selectedScenario = retScenarios.find((s) => s.isSelected);
  const salaryGrowthRate = toNumber(settings.salaryAnnualIncrease);

  const result = calculateRelocation({
    currentMonthlyExpenses: currentMonthly,
    relocationMonthlyExpenses: relocationMonthly,
    yearAdjustments: resolvedYearAdjustments,
    contributionOverrides: input.contributionOverrides,
    largePurchases: input.largePurchases,
    currentAge: age,
    retirementAge,
    currentPortfolio: portfolioTotal,
    currentAnnualContributions: currentContributionData.annualContributions,
    currentEmployerContributions: currentContributionData.employerMatch,
    currentCombinedSalary: currentContributionData.combinedSalary,
    relocationAnnualContributions: relocContributionData.annualContributions,
    relocationEmployerContributions: relocContributionData.employerMatch,
    relocationCombinedSalary: relocContributionData.combinedSalary,
    currentSalaryGrowthRate: salaryGrowthRate,
    relocationSalaryGrowthRate: salaryGrowthRate,
    withdrawalRate: selectedScenario
      ? toNumber(selectedScenario.withdrawalRate)
      : toNumber(settings.withdrawalRate),
    inflationRate: toNumber(settings.annualInflation),
    nominalReturnRate: avgReturnRate,
    // Known limitation (deliberately not fixed — see TODO.md): this is
    // the household `retirement_settings` scalar, NOT the per-person /
    // PIA-aware resolution `build-engine-payload.ts` uses
    // (`personAnnualAmount` + `parseAnnualPia`). This proc doesn't even
    // fetch `retirement_profile_people`. Low impact for a coarse
    // relocation-vs-stay FI comparison: the same SS figure is applied
    // to both arms, so it largely cancels in the reported delta. Wiring
    // the full per-person/PIA resolution here isn't proportionate to
    // that; revisit if the relocation tool ever surfaces an absolute
    // (not just comparative) retirement number.
    socialSecurityAnnual: toNumber(settings.socialSecurityMonthly) * 12,
    asOfDate: referenceDate,
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
        currentContributionData.annualContributions,
      ),
      employerMatch: roundToCents(currentContributionData.employerMatch),
      combinedSalary: roundToCents(currentContributionData.combinedSalary),
      incompleteAccountIds: currentContributionData.incompleteAccountIds,
    },
    relocationContribProfile: {
      annualContributions: roundToCents(
        relocContributionData.annualContributions,
      ),
      employerMatch: roundToCents(relocContributionData.employerMatch),
      combinedSalary: roundToCents(relocContributionData.combinedSalary),
      incompleteAccountIds: relocContributionData.incompleteAccountIds,
    },
  };
}
