/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, profile-switching scenarios, and retirement-settings/scenario/override/return-rate CRUD. */
import { eq, ne, asc, and, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
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
  mergeSalaryProfileJobFields,
  getLatestSnapshot,
  computeAnnualContribution,
  computeGroupedEmployerMatch,
  fetchContributionProfile,
  resolveProfile,
  getPrimaryPerson,
  resolveLinkedBudgetItemAmounts,
  resolveContribPeriods,
} from "@/server/helpers";
import type { Db } from "@/server/helpers";
import type { W4FilingStatus } from "@/lib/config/enum-values";
import type { ContribRowWithActiveFields } from "@/server/helpers/contribution";
import { isRetirementParent } from "@/lib/config/account-types";
import { getAge } from "@/lib/utils/date";
import { roundToCents } from "@/lib/utils/math";
import {
  filterActiveJobs,
  canDeleteRetirementProfile,
} from "@/lib/pure/profiles";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";
import { withdrawalStrategyEnum } from "@/lib/config/withdrawal-strategies";
import { zDecimal } from "./settings/_shared";
import {
  resolveRetirementProfileIdFrom,
  pickProfileSettingsRow,
  resolveRetirementProfileId,
} from "@/server/helpers/retirement-profile";

/**
 * Resolve the filing status to store when a caller sends null/undefined
 * (meaning "auto") — the person's own active, non-speculative job's W-4
 * filing status, or "MFJ" as the ultimate fallback. Mirrors
 * build-engine-payload.ts's read-time job-facts tier so the write-time
 * value and the read-time fallback agree, but only used here at write time
 * since filing_status is NOT NULL on the DB row (see drizzle/0021).
 */
async function resolveDefaultFilingStatus(
  db: Db,
  personId: number,
): Promise<W4FilingStatus> {
  const [job] = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.personId, personId),
        isNull(schema.jobs.endDate),
        eq(schema.jobs.isSpeculative, false),
      ),
    )
    .limit(1);
  if (!job) return "MFJ";
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  return salaryProfileActiveMap.get(job.id)?.w4FilingStatus ?? "MFJ";
}

// --- CRUD Zod schemas ---

const retirementSettingsInput = z.object({
  personId: z.number().int(),
  /** Which retirement profile this write targets. Explicit key presence
   *  matters, not just the value — see the upsert mutation's docblock. Omit
   *  the field entirely only from legacy/API callers that predate profiles;
   *  every UI call site should send it (sourced from the `settings.profileId`
   *  already on the wire from computeProjection, via buildSettingsPatch). */
  profileId: z.number().int().nullable().optional(),
  retirementAge: z.number().int().min(18).max(100),
  endAge: z.number().int().min(30).max(120),
  returnAfterRetirement: zDecimal,
  annualInflation: zDecimal,
  postRetirementInflation: zDecimal.nullable().optional(),
  salaryAnnualIncrease: zDecimal,
  salaryCap: zDecimal.nullable().optional(),
  raisesDuringRetirement: z.boolean().default(false),
  ruleOf55Override: z.boolean().optional(),
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
  rmdExcessHandling: z.enum(["reinvest", "spend"]).optional(),
  qcdMaximize: z.boolean().optional(),
  rmdSmoothingEnabled: z.boolean().optional(),
  rmdSmoothingMaxBracketTarget: zDecimal.nullable().optional(),
  enableIrmaaAwareness: z.boolean().optional(),
  enableAcaAwareness: z.boolean().optional(),
  householdSize: z.number().int().min(1).max(8).optional(),
  socialSecurityMonthly: zDecimal.optional(),
  ssStartAge: z.number().int().min(62).max(70).optional(),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]).nullable().optional(),
});

// retirementScenarioInput removed with the retirementScenarios router
// (Retirement Profiles step B) — nothing writes that table any more.

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
        retProfiles,
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
        ctx.db
          .select()
          .from(schema.retirementProfiles)
          .orderBy(asc(schema.retirementProfiles.id)),
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

      // Active profile's row, matching build-engine-payload — the readiness
      // analysis must read the same assumptions the projection does.
      const activeRetProfileId = resolveRetirementProfileIdFrom(
        await ctx.db.select().from(schema.appSettings),
        retProfiles,
      );
      const settings = pickProfileSettingsRow(
        retSettings,
        activeRetProfileId,
        primaryPerson.id,
      );
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
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        null,
      );
      const activeJobs = mergeSalaryProfileJobFields(
        filterActiveJobs(allJobs),
        salaryProfileActiveMap,
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
        // Profile-patched jobs (resolved.activeJobs), NOT the outer raw
        // activeJobs closed over above — a per-arm profile-set payPeriod
        // must affect fixed_per_period annualization here, since different
        // arms can legitimately represent different real jobs/offers with
        // different pay schedules. Defaults to the raw jobs only for the
        // (non-comparison) live-data callers that never resolve a profile.
        jobsForPeriods: {
          id: number;
          payPeriod: string | undefined;
        }[] = activeJobs,
      ) => {
        const salaryById = new Map<number, number>();
        const annualById = new Map<number, number>();
        const incompleteIds: number[] = [];
        for (const c of contribs) {
          const cv = Number(c.contributionValue);
          const js = salaries.find((x) => x.job.id === c.jobId);
          const job = jobsForPeriods.find((j) => j.id === c.jobId);
          const salary = js?.salary ?? 0;
          // A missing job here must degrade this ONE contribution out of
          // this arm's total, not throw — one incomplete job can't be
          // allowed to kill the whole relocation comparison.
          const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
            c.contributionMethod,
            job,
          );
          if (incomplete) incompleteIds.push(c.id);
          salaryById.set(c.id, salary);
          annualById.set(
            c.id,
            incomplete
              ? 0
              : computeAnnualContribution(
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
        return { totalContribs, totalEmployerMatch, incompleteIds };
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
          salaryProfileActiveMap,
        );
        const resolvedCombinedSalary = resolved.jobSalaries.reduce(
          (s, js) => s + js.salary,
          0,
        );

        const totals = computeContribTotals(
          resolved.activeContribs,
          resolved.jobSalaries,
          resolved.activeJobs,
        );
        return {
          combinedSalary: resolvedCombinedSalary,
          annualContributions: totals.totalContribs,
          employerMatch: totals.totalEmployerMatch,
          incompleteAccountIds: totals.incompleteIds,
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
          incompleteAccountIds: currentContribData.incompleteAccountIds,
        },
        relocationContribProfile: {
          annualContributions: roundToCents(
            relocContribData.annualContributions,
          ),
          employerMatch: roundToCents(relocContribData.employerMatch),
          combinedSalary: roundToCents(relocContribData.combinedSalary),
          incompleteAccountIds: relocContribData.incompleteAccountIds,
        },
      };
    }),

  // getProjection and getMonteCarloProjection moved to projection.ts

  retirementProfilePeople: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfilePeople)
        .orderBy(
          asc(schema.retirementProfilePeople.profileId),
          asc(schema.retirementProfilePeople.personId),
        ),
    ),

    // Retirement Profiles phase 4 (the assumptions band). Until this
    // mutation existed, every per-person editor on the Projection
    // Assumptions card (Timeline's per-person Retirement Age + Rule of 55,
    // Social Security's per-person benefit) actually called
    // `retirementSettings.upsert`, writing `retirement_settings` — the
    // table `build-engine-payload.ts` stopped reading per-person values
    // from once step B (2026-08-30) switched those reads to
    // `retirement_profile_people`. The edits saved, the UI showed the new
    // number optimistically, and the projection never moved — same failure
    // shape as the pre-0b5d5fe `end_age` bug, just at this table instead.
    // This is the real write path now; the affected client call sites are
    // updated in the same commit as this mutation.
    upsertPerson: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          retirementAge: z.number().int().min(18).max(100).optional(),
          endAge: z.number().int().min(30).max(120).optional(),
          socialSecurityMonthly: zDecimal.nullable().optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
          ruleOf55Override: z.boolean().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(schema.retirementProfilePeople)
          .where(
            and(
              eq(schema.retirementProfilePeople.profileId, input.profileId),
              eq(schema.retirementProfilePeople.personId, input.personId),
            ),
          );
        // retirementAge/endAge are NOT NULL — the completeness invariant
        // (profile duplicate / person create, see retirementProfiles below)
        // guarantees `existing` here in every real flow, but an insert path
        // still needs concrete values if it's ever reached cold.
        if (
          !existing &&
          (input.retirementAge == null || input.endAge == null)
        ) {
          throw new Error(
            "retirementAge and endAge are required to create a new retirement_profile_people row",
          );
        }
        const { profileId, personId, ...patch } = input;
        const values = {
          profileId,
          personId,
          retirementAge: patch.retirementAge ?? existing!.retirementAge,
          endAge: patch.endAge ?? existing!.endAge,
          ...("socialSecurityMonthly" in patch
            ? { socialSecurityMonthly: patch.socialSecurityMonthly }
            : {}),
          ...("ssStartAge" in patch ? { ssStartAge: patch.ssStartAge } : {}),
          ...("ruleOf55Override" in patch
            ? { ruleOf55Override: patch.ruleOf55Override }
            : {}),
        };
        return existing
          ? ctx.db
              .update(schema.retirementProfilePeople)
              .set(values)
              .where(eq(schema.retirementProfilePeople.id, existing.id))
              .returning()
              .then((r) => r[0])
          : ctx.db
              .insert(schema.retirementProfilePeople)
              .values(values)
              .returning()
              .then((r) => r[0]);
      }),

    // "Plan Through" (end age) and Social Security "Start Age" both render
    // as ONE household-wide control regardless of person count
    // (sections/timeline.tsx, sections/social-security.tsx), but the
    // engine's real per-person read source for both
    // (`retirement_profile_people`) is per-person storage. Fan whichever
    // field the caller sends to every person's row in the profile — same
    // shape as `retirementSettings.upsert`'s endAge fan-out used to be the
    // fix for, before the read moved to this table out from under it (see
    // upsertPerson's docblock above).
    upsertHouseholdFields: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          endAge: z.number().int().min(30).max(120).optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { profileId, ...fields } = input;
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(patch).length === 0) return [];
        return ctx.db
          .update(schema.retirementProfilePeople)
          .set(patch)
          .where(eq(schema.retirementProfilePeople.profileId, profileId))
          .returning();
      }),
  }),

  retirementSettings: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSettings)
        .orderBy(asc(schema.retirementSettings.personId)),
    ),
    // Retirement Profiles phase 4: `retirement_settings` was re-keyed in
    // step C to a composite (profile_id, person_id) index — a person can
    // now hold ONE ROW PER PROFILE. This mutation must scope every read and
    // write by profile, or a household with 2+ profiles gets every profile's
    // row for that person matched (and overwritten) by a single edit.
    //
    // Key PRESENCE, not just value, matters: `profileId: undefined` (key
    // omitted — a legacy/API caller that predates profiles) resolves
    // server-side to the household's globally-active profile, so every
    // existing UI call site keeps editing exactly what it edits today.
    // `profileId: null` (key present, value null) means "the caller
    // resolved a real profileId and it was null" (e.g. a fresh/pre-backfill
    // household with zero profiles yet) — that is NOT the same as "use the
    // active profile," and must NOT silently retarget the write there; it
    // scopes to the (rare, legitimate) null-profile rows via `isNull`
    // instead of `eq`. Collapsing these two cases with `??` was the bug:
    // once the assumptions band lets you VIEW a non-active profile, an
    // omitted-vs-null mixup would render profile B while writing profile A.
    upsert: adminProcedure
      .input(retirementSettingsInput)
      .mutation(async ({ ctx, input }) => {
        const profileIdGiven = Object.prototype.hasOwnProperty.call(
          input,
          "profileId",
        );
        const resolvedProfileId = profileIdGiven
          ? input.profileId!
          : await resolveRetirementProfileId(ctx.db);
        const profileScope =
          resolvedProfileId != null
            ? eq(schema.retirementSettings.profileId, resolvedProfileId)
            : isNull(schema.retirementSettings.profileId);

        const existing = await ctx.db
          .select()
          .from(schema.retirementSettings)
          .where(
            and(
              eq(schema.retirementSettings.personId, input.personId),
              profileScope,
            ),
          );
        // filing_status is NOT NULL on the DB row (see drizzle/0021's
        // backfill) even though a caller may still send null/undefined to
        // mean "auto" — resolve that request to a concrete value here, the
        // same way build-engine-payload.ts's job-facts tier does at read
        // time, so the column never gets a null written to it.
        const { profileId: _profileIdKey, ...inputFields } = input;
        const resolvedInput = {
          ...inputFields,
          profileId: resolvedProfileId,
          filingStatus:
            input.filingStatus ??
            (await resolveDefaultFilingStatus(ctx.db, input.personId)),
        };
        return ctx.db.transaction(async (tx) => {
          const saved =
            existing.length > 0
              ? await tx
                  .update(schema.retirementSettings)
                  .set(resolvedInput)
                  .where(
                    and(
                      eq(schema.retirementSettings.personId, input.personId),
                      profileScope,
                    ),
                  )
                  .returning()
                  .then((r) => r[0])
              : await tx
                  .insert(schema.retirementSettings)
                  .values(resolvedInput)
                  .returning()
                  .then((r) => r[0]);

          // Propagate household-grain fields to every other person's row —
          // WITHIN THE SAME PROFILE ONLY (the `profileScope` filter below).
          //
          // `retirement_settings` is one row per (profile, person), but a
          // few of its columns are presented in the UI as a SINGLE
          // household control while being read across all people within
          // that profile. Historically `end_age` was the live case here
          // ("Plan Through" — see sections/timeline.tsx). As of the
          // Retirement Profiles migration (step B), the engine's actual
          // per-person read for end_age moved to `retirement_profile_people`
          // — see the `retirementProfilePeople.upsertPerson` /
          // `upsertHouseholdEndAge` mutations below, which are now the
          // real write path for that field. This fan-out stays for
          // whatever legacy readers still fall back to
          // `retirement_settings.end_age` (build-engine-payload.ts's
          // `pp ?? retSettings.find(...)` fallback, reached only when a
          // profile-person row is missing).
          //
          // DELIBERATELY NARROW. Do not extend this to every column:
          // `salary_annual_increase` is genuinely per-person and read
          // per-person (build-engine-payload.ts, whose docblock records
          // that applying the primary's raise rate to everyone "silently
          // produced the wrong number" — a bug already fixed once). Fanning
          // that out would re-introduce it. Only add a field here if its UI
          // control is household-wide AND its read path aggregates across
          // people within one profile.
          const HOUSEHOLD_FANOUT_FIELDS = ["endAge"] as const;
          const fanout = Object.fromEntries(
            HOUSEHOLD_FANOUT_FIELDS.filter(
              (f) => resolvedInput[f] !== undefined,
            ).map((f) => [f, resolvedInput[f]]),
          );
          if (Object.keys(fanout).length > 0) {
            // Existing rows only — a person with no row already inherits the
            // primary's value via the `?? settings.endAge` fallback in
            // build-engine-payload.ts, so creating rows here would add
            // state without changing the result.
            await tx
              .update(schema.retirementSettings)
              .set(fanout)
              .where(
                and(
                  ne(schema.retirementSettings.personId, input.personId),
                  profileScope,
                ),
              );
          }

          return saved;
        });
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

  // retirementScenarios CRUD removed 2026-08-30 (Retirement Profiles step B).
  // It had ZERO UI callers while the table it wrote was read on every engine
  // build, so it could silently change every projection with no way to see
  // or undo it. The four distribution tax rates it carried now live on
  // retirement_settings and are read from there; leaving a writable router
  // pointed at the now-ignored columns would be a second, invisible answer
  // to "what drives my projection" — the exact thing this work removes.
  //
  // The TABLE survives for now: retirement.ts's relocation comparison still
  // reads its withdrawal_rate, which is deliberately NOT relocated (see the
  // schema docblock — retirement_settings.withdrawal_rate already exists and
  // collapsing the two is a user-visible change needing its own commit).

  /**
   * Retirement Profiles CRUD (Retirement Profiles step D — "multiple
   * profiles + the Plan field"). Each profile is a COMPLETE WORLD: no
   * baseline, no default, no inheritance, no merge at read time — same
   * contract Salary Profiles already state. `duplicate` is the one creation
   * path (no bare `create`): retirement_settings has ~40 columns, many
   * NOT NULL with no sensible blank default, so every new profile starts as
   * a clone of an existing one, matching the plan's own recommendation that
   * "duplicate to compare" be the primary action.
   *
   * adminProcedure throughout, matching retirementSettings.upsert's existing
   * gate — RULES.md Composed Router: an inconsistent procedure type within
   * one group is a bug, not a design choice.
   */
  retirementProfiles: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfiles)
        .orderBy(asc(schema.retirementProfiles.id)),
    ),

    /**
     * Clone an existing profile's retirement_settings row (per person) and
     * retirement_profile_people row (per person) into a new profile.
     *
     * Household-grain columns on retirement_settings are still duplicated
     * onto every person's row (the contract step that collapses this to one
     * row per profile is deferred to v0.8.0) and can legitimately have
     * drifted between people — pickProfileSettingsRow's own docblock records
     * a real household whose withdrawal_rate/rmd_excess_handling disagreed
     * across person rows. Cloning from the PRIMARY person's source row into
     * every person's new row (not each person's own current row) avoids
     * baking that drift in as if it were intentional per-person
     * configuration in the new profile.
     */
    duplicate: adminProcedure
      .input(
        z.object({
          sourceProfileId: z.number().int(),
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          const people = await tx
            .select()
            .from(schema.people)
            .orderBy(asc(schema.people.id));
          if (people.length === 0) {
            throw new Error("No people exist to seed the new profile with.");
          }
          const primaryPerson = getPrimaryPerson(people);

          const sourceSettings = await tx
            .select()
            .from(schema.retirementSettings)
            .where(
              eq(schema.retirementSettings.profileId, input.sourceProfileId),
            );
          const sourceHousehold =
            (primaryPerson
              ? sourceSettings.find((s) => s.personId === primaryPerson.id)
              : undefined) ?? sourceSettings[0];
          if (!sourceHousehold) {
            throw new Error("Source profile has no settings to clone.");
          }

          const sourcePeopleRows = await tx
            .select()
            .from(schema.retirementProfilePeople)
            .where(
              eq(
                schema.retirementProfilePeople.profileId,
                input.sourceProfileId,
              ),
            );
          const sourcePrimaryPeopleRow =
            (primaryPerson
              ? sourcePeopleRows.find((r) => r.personId === primaryPerson.id)
              : undefined) ?? sourcePeopleRows[0];

          const [newProfile] = await tx
            .insert(schema.retirementProfiles)
            .values({
              name: input.name,
              description: input.description ?? null,
            })
            .returning();
          if (!newProfile) throw new Error("Failed to create profile.");

          const {
            id: _hhId,
            personId: _hhPersonId,
            profileId: _hhProfileId,
            ...householdFields
          } = sourceHousehold;
          await tx.insert(schema.retirementSettings).values(
            people.map((p) => ({
              ...householdFields,
              personId: p.id,
              profileId: newProfile.id,
            })),
          );

          if (sourcePrimaryPeopleRow) {
            const {
              id: _ppId,
              personId: _ppPersonId,
              profileId: _ppProfileId,
              ...perPersonFields
            } = sourcePrimaryPeopleRow;
            await tx.insert(schema.retirementProfilePeople).values(
              people.map((p) => ({
                ...perPersonFields,
                personId: p.id,
                profileId: newProfile.id,
              })),
            );
          }

          return newProfile;
        });
      }),

    /** Rename / re-describe a profile. Assumptions themselves are edited
     *  through retirementSettings.upsert, scoped to whichever profile is
     *  active — not here. */
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).nullish(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementProfiles)
          .set(data)
          .where(eq(schema.retirementProfiles.id, id))
          .returning()
          .then((r) => r[0]),
      ),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const activeSettingRows = await ctx.db
          .select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, SK_ACTIVE_RETIREMENT_PROFILE_ID));
        const activeId = (activeSettingRows[0]?.value ?? null) as number | null;

        const allProfiles = await ctx.db
          .select({ id: schema.retirementProfiles.id })
          .from(schema.retirementProfiles);

        const deleteCheck = canDeleteRetirementProfile(
          activeId,
          input.id,
          allProfiles.length,
        );
        if (!deleteCheck.allowed) throw new Error(deleteCheck.reason);

        if (!allProfiles.some((p) => p.id === input.id))
          throw new Error("Profile not found");

        const pinningPlans = await ctx.db
          .select({ name: schema.scenarios.name })
          .from(schema.scenarios)
          .where(eq(schema.scenarios.retirementProfileId, input.id));
        if (pinningPlans.length > 0) {
          throw new Error(
            `Cannot delete: active in ${pinningPlans.length} Plan(s) (${pinningPlans
              .map((p) => p.name)
              .join(", ")}). Change that Plan's retirement profile first.`,
          );
        }

        // Explicit child-row cleanup, NOT relying on ON DELETE cascade.
        // Both FKs declare cascade in schema-pg.ts, and Postgres (the
        // production dialect) honours it — but the migration that added
        // retirement_settings.profile_id used ALTER TABLE ADD COLUMN, and
        // drizzle-kit's SQLite generator emits that form WITHOUT the ON
        // DELETE clause (confirmed live 2026-08-30: SQLite CREATE TABLE
        // preserves it, ALTER TABLE ADD COLUMN silently drops it). Any
        // SQLite-dialect install — which schema-sqlite.ts exists to
        // support, not just tests — would fail this delete with a foreign
        // key error instead of cascading. Deleting explicitly here is
        // correct and harmless on both dialects.
        await ctx.db.transaction(async (tx) => {
          await tx
            .delete(schema.retirementProfilePeople)
            .where(eq(schema.retirementProfilePeople.profileId, input.id));
          await tx
            .delete(schema.retirementSettings)
            .where(eq(schema.retirementSettings.profileId, input.id));
          await tx
            .delete(schema.retirementProfiles)
            .where(eq(schema.retirementProfiles.id, input.id));
        });
        return { success: true };
      }),
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
