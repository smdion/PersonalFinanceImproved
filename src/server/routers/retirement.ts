/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, and profile-switching scenarios. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateRelocation } from "@/lib/calculators/relocation";
import {
  toNumber,
  getCurrentSalary,
  getEffectiveIncome,
  getPeriodsPerYear,
  getLatestSnapshot,
  computeAnnualContribution,
  computeEmployerMatch,
} from "@/server/helpers";
import { isRetirementParent } from "@/lib/config/account-types";
import { PERF_CATEGORY_DEFAULT } from "@/lib/config/display-labels";
import { getAge } from "@/lib/utils/date";
import { roundToCents } from "@/lib/utils/math";

// `fetchRetirementData` and `buildEnginePayload` were moved to
// `src/server/retirement/build-engine-payload.ts` in the v0.5.2 refactor.
// Projection router imports them directly from the new path; nothing else
// imports from here, so no re-export shim is needed.

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
      // Filter to Retirement-only contributions for the relocation tool.
      // audit-exception: literal "401k/IRA" string compare is intentional here
      // for visual filtering and is allowed to bypass the parent-category
      // predicate rule.
      const perfCatMap = new Map(
        perfAccounts.map((p) => [p.id, p.parentCategory]),
      );
      const allContribs = allContribsRaw.filter(
        (c) =>
          c.performanceAccountId != null &&
          perfCatMap.get(c.performanceAccountId) === PERF_CATEGORY_DEFAULT,
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
      // When a historical snapshot is selected, use its date as the reference point
      const referenceDate = snapshotData?.snapshot.snapshotDate
        ? new Date(snapshotData.snapshot.snapshotDate)
        : new Date();
      // Age as of reference date (calendar-accurate via getAge)
      const age = getAge(new Date(primaryPerson.dateOfBirth), referenceDate);

      // Portfolio — only retirement-category accounts from latest balance snapshot
      let portfolioTotal = 0;
      if (snapshotData) {
        for (const a of snapshotData.accounts) {
          if (a.parentCategory && !isRetirementParent(a.parentCategory))
            continue;
          portfolioTotal += a.amount;
        }
      }

      // Salary
      const asOfDate = referenceDate;
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
          const cv = toNumber(c.contributionValue);
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
            toNumber(c.employerMatchValue),
            toNumber(c.employerMaxMatchPct),
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
        .map((r) => toNumber(r.rateOfReturn));
      const avgReturnRate =
        relevantRates.length > 0
          ? relevantRates.reduce((s, r) => s + r, 0) / relevantRates.length
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
          ? toNumber(selectedScenario.withdrawalRate)
          : toNumber(settings.withdrawalRate),
        inflationRate: toNumber(settings.annualInflation),
        nominalReturnRate: avgReturnRate,
        socialSecurityAnnual: toNumber(settings.socialSecurityMonthly) * 12,
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
