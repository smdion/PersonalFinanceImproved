/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, profile-switching scenarios, and retirement-settings/scenario/override/return-rate CRUD. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  DEFAULT_RETURN_RATE,
  DEFAULT_TAX_RATE_TRADITIONAL,
  DEFAULT_TAX_RATE_ROTH,
  DEFAULT_TAX_RATE_BROKERAGE,
} from "@/lib/constants";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  brokerageProcedure,
  getSessionUserLabel,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateRelocation } from "@/lib/calculators/relocation";
import {
  toNumber,
  getEffectiveIncome,
  getTotalCompensation,
  resolveCompensation,
  loadEffectiveSalaryProfile,
  getPeriodsPerYear,
  getLatestSnapshot,
  computeAnnualContribution,
  computeGroupedEmployerMatch,
  fetchContributionProfile,
  resolveProfile,
  getPrimaryPerson,
  resolveLinkedBudgetItemAmounts,
} from "@/server/helpers";
import type { ContribRowWithActiveFields } from "@/server/helpers/contribution";
import { isRetirementParent } from "@/lib/config/account-types";
import { getAge } from "@/lib/utils/date";
import { roundToCents } from "@/lib/utils/math";
import { filterActiveJobs } from "@/lib/pure/profiles";
import { withdrawalStrategyEnum } from "@/lib/config/withdrawal-strategies";
import { zDecimal } from "./settings/_shared";

// --- CRUD Zod schemas ---

const retirementSettingsInput = z.object({
  personId: z.number().int(),
  retirementAge: z.number().int().min(18).max(100),
  endAge: z.number().int().min(30).max(120),
  returnAfterRetirement: zDecimal,
  annualInflation: zDecimal,
  postRetirementInflation: zDecimal.nullable().optional(),
  salaryAnnualIncrease: zDecimal,
  salaryCap: zDecimal.nullable().optional(),
  raisesDuringRetirement: z.boolean().default(false),
  withdrawalRate: zDecimal.optional(),
  taxMultiplier: zDecimal.optional(),
  grossUpForTaxes: z.boolean().optional(),
  rothBracketTarget: zDecimal.nullable().optional(),
  enableRothConversions: z.boolean().optional(),
  rothConversionTarget: zDecimal.nullable().optional(),
  withdrawalStrategy: z.enum(withdrawalStrategyEnum()).optional(),
  gkUpperGuardrail: zDecimal.optional(),
  gkLowerGuardrail: zDecimal.optional(),
  gkIncreasePct: zDecimal.optional(),
  gkDecreasePct: zDecimal.optional(),
  gkSkipInflationAfterLoss: z.boolean().optional(),
  sdAnnualDeclineRate: zDecimal.optional(),
  cpWithdrawalPercent: zDecimal.optional(),
  cpFloorPercent: zDecimal.optional(),
  enWithdrawalPercent: zDecimal.optional(),
  enRollingYears: z.number().int().min(3).max(20).optional(),
  enFloorPercent: zDecimal.optional(),
  vdBasePercent: zDecimal.optional(),
  vdCeilingPercent: zDecimal.optional(),
  vdFloorPercent: zDecimal.optional(),
  rmdMultiplier: zDecimal.optional(),
  enableIrmaaAwareness: z.boolean().optional(),
  enableAcaAwareness: z.boolean().optional(),
  householdSize: z.number().int().min(1).max(8).optional(),
  socialSecurityMonthly: zDecimal.optional(),
  ssStartAge: z.number().int().min(62).max(70).optional(),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]).nullable().optional(),
});

const retirementScenarioInput = z.object({
  name: z.string().min(1),
  withdrawalRate: zDecimal,
  targetAnnualIncome: zDecimal,
  annualInflation: zDecimal,
  distributionTaxRateTraditional: zDecimal.default(
    String(DEFAULT_TAX_RATE_TRADITIONAL),
  ),
  distributionTaxRateRoth: zDecimal.default(String(DEFAULT_TAX_RATE_ROTH)),
  distributionTaxRateHsa: zDecimal.default("0"),
  distributionTaxRateBrokerage: zDecimal.default(
    String(DEFAULT_TAX_RATE_BROKERAGE),
  ),
  isLtBrokerageEnabled: z.boolean().default(true),
  ltBrokerageAnnualContribution: zDecimal.default("0"),
  isSelected: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

const returnRateInput = z.object({
  age: z.number().int(),
  rateOfReturn: zDecimal,
});

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
      const perfCatMap = new Map(
        perfAccounts.map((p) => [p.id, p.parentCategory]),
      );
      const allContribs = allContribsRaw.filter(
        (c) =>
          c.performanceAccountId != null &&
          isRetirementParent(perfCatMap.get(c.performanceAccountId)),
      );

      const primaryPerson = getPrimaryPerson(people);
      if (!primaryPerson) return { result: null, budgetInfo: null };

      const settings = retSettings.find((s) => s.personId === primaryPerson.id);
      if (!settings) return { result: null, budgetInfo: null };

      if (allBudgetProfiles.length === 0)
        return { result: null, budgetInfo: null };

      // Build per-profile column totals — resolved through the same
      // contribution-account chain computeActiveSummary/build-engine-payload.ts
      // use (see resolveLinkedBudgetItemAmounts) rather than raw `amounts`,
      // which is intentionally stale for contribution-linked items. Live/
      // globally-active profiles throughout (no Plan pin), matching this
      // endpoint's documented "control arm" salary resolution below.
      const profileSummaries = await Promise.all(
        allBudgetProfiles.map(async (p) => {
          const items = allBudgetItems.filter((i) => i.profileId === p.id);
          const labels = p.columnLabels as string[];
          const months = (p.columnMonths as number[] | null) ?? null;
          const numColumns = labels.length;
          const resolvedItems = await resolveLinkedBudgetItemAmounts(
            ctx.db,
            items,
            numColumns,
            new Array(numColumns).fill(null),
            new Array(numColumns).fill(null),
          );
          const totals = labels.map((_: string, colIdx: number) =>
            resolvedItems.reduce(
              (sum: number, item) => sum + (item.amounts[colIdx] ?? 0),
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

      // Salary — intentionally un-overridden by any Plan/session pin. This
      // is the control arm of the relocation comparison; applying one here
      // would collapse the comparison it exists to run. A job has no
      // salary/bonus of its own any more, so the globally-ACTIVE Salary
      // Profile is the only live source left (see resolveCompensation's
      // docblock) — Plan-specific salary threading into relocation
      // scenarios is a separate, not-yet-built feature.
      const asOfDate = referenceDate;
      const activeJobs = filterActiveJobs(allJobs);
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        null,
      );
      const jobSalaries = activeJobs.map((j) => {
        const comp = resolveCompensation(salaryProfileActiveMap, j.id);
        return {
          job: j,
          salary: getEffectiveIncome(j, comp.salary, comp.terms),
          baseSalary: comp.salary,
          totalComp: getTotalCompensation(comp.salary, comp.terms),
          resolvedBonusOverride: null,
        };
      });
      // Contributions (live data)
      const activeContribs = allContribs.filter(
        (c) =>
          activeJobs.some((j) => j.id === c.jobId) ||
          (c.jobId === null && people.some((p) => p.id === c.personId)),
      );

      // Helper to compute totals from a set of contrib rows + job salaries.
      // `contribs` is always the output of resolveProfile/applyContribActiveFields
      // (contributionValue/Method guaranteed present) — never the raw
      // activeContribs rows, which carry no value of their own.
      const computeContribTotals = (
        contribs: ContribRowWithActiveFields[],
        salaries: typeof jobSalaries,
      ) => {
        const salaryById = new Map<number, number>();
        const annualById = new Map<number, number>();
        for (const c of contribs) {
          const cv = Number(c.contributionValue);
          const js = salaries.find((x) => x.job.id === c.jobId);
          const job = activeJobs.find((j) => j.id === c.jobId);
          const salary = js?.salary ?? 0;
          const periods = getPeriodsPerYear(job?.payPeriod ?? "biweekly");
          salaryById.set(c.id, salary);
          annualById.set(
            c.id,
            computeAnnualContribution(
              c.contributionMethod,
              cv,
              salary,
              periods,
            ),
          );
        }

        const matchByRow = computeGroupedEmployerMatch(
          contribs.map((c) => ({
            id: c.id,
            jobId: c.jobId,
            personId: c.personId,
            accountType: c.accountType,
            parentCategory: c.parentCategory,
            annual: annualById.get(c.id)!,
            salary: salaryById.get(c.id)!,
            employerMatchType: c.employerMatchType,
            employerMatchValue: toNumber(c.employerMatchValue),
            employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
            employerMatchTaxTreatment: "pre_tax", // not used by this total
          })),
        );

        let totalContribs = 0;
        let totalEmployerMatch = 0;
        for (const c of contribs) {
          totalContribs += annualById.get(c.id)!;
          totalEmployerMatch += matchByRow.get(c.id)!.matchAnnual;
        }
        return { totalContribs, totalEmployerMatch };
      };

      // Resolve contribution profiles for each scenario. No profile
      // (or a stale id that no longer exists) resolves against an empty
      // active-fields map — accounts carry no value of their own anymore,
      // so this correctly yields zero contributions rather than falling
      // back to a "live" reading of the raw account rows.
      const resolveContribProfile = async (profileId: number | null) => {
        const profile = profileId
          ? await fetchContributionProfile(ctx.db, profileId)
          : null;

        // Shared resolver (was a near-duplicate re-implementation inline
        // here — M26). jobSalaries already reflects the globally-active
        // Salary Profile — this is the control/comparison arm of the
        // relocation analysis, so it stays un-overridden by any
        // Plan-specific salary the way it always has.
        const resolved = resolveProfile(
          profile ?? { contributionActiveFields: {} },
          activeContribs,
          activeJobs,
          jobSalaries,
        );
        const resolvedCombinedSalary = resolved.jobSalaries.reduce(
          (s, js) => s + js.salary,
          0,
        );

        const totals = computeContribTotals(
          resolved.activeContribs,
          resolved.jobSalaries,
        );
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

  retirementSettings: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSettings)
        .orderBy(asc(schema.retirementSettings.personId)),
    ),
    upsert: adminProcedure
      .input(retirementSettingsInput)
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.retirementSettings)
          .where(eq(schema.retirementSettings.personId, input.personId));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.retirementSettings)
            .set(input)
            .where(eq(schema.retirementSettings.personId, input.personId))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.retirementSettings)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
  }),

  retirementSalaryOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSalaryOverrides)
        .orderBy(asc(schema.retirementSalaryOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementSalaryOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementSalaryOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementSalaryOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementSalaryOverrides)
          .where(eq(schema.retirementSalaryOverrides.id, input.id)),
      ),
  }),

  retirementBudgetOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementBudgetOverrides)
        .orderBy(asc(schema.retirementBudgetOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementBudgetOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementBudgetOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementBudgetOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementBudgetOverrides)
          .where(eq(schema.retirementBudgetOverrides.id, input.id)),
      ),
  }),

  projectionOverrides: createTRPCRouter({
    get: protectedProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db
          .select()
          .from(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          )
          .then((r) => (r[0]?.overrides as Record<string, unknown>[]) ?? []),
      ),
    save: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
          overrides: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.projectionOverrides)
          .values({
            overrideType: input.overrideType,
            overrides: input.overrides,
            createdBy: getSessionUserLabel(ctx.session),
          })
          .onConflictDoUpdate({
            target: schema.projectionOverrides.overrideType,
            set: {
              overrides: input.overrides,
              updatedBy: getSessionUserLabel(ctx.session),
            },
          })
          .returning()
          .then((r) => r[0]),
      ),
    clear: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          ),
      ),
  }),

  retirementScenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementScenarios)
        .orderBy(asc(schema.retirementScenarios.id)),
    ),
    create: adminProcedure
      .input(retirementScenarioInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementScenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(retirementScenarioInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementScenarios)
          .set(data)
          .where(eq(schema.retirementScenarios.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementScenarios)
          .where(eq(schema.retirementScenarios.id, input.id)),
      ),
  }),

  returnRates: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.returnRateTable)
        .orderBy(asc(schema.returnRateTable.age)),
    ),
    upsert: adminProcedure
      .input(returnRateInput)
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.returnRateTable)
          .where(eq(schema.returnRateTable.age, input.age));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.returnRateTable)
            .set(input)
            .where(eq(schema.returnRateTable.age, input.age))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.returnRateTable)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.returnRateTable)
          .where(eq(schema.returnRateTable.id, input.id)),
      ),
  }),
});
