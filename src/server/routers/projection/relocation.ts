/**
 * Engine-backed relocation projection (current vs relocation budget, earliest safe move
 * year, year-by-year rows, optional blended run switching at moveYear), plus CRUD for
 * the Tools page's saved relocation scenarios.
 */
import { planRetirementAge as planRetirementAgeOf } from "@/lib/pure/household/household-timeline";
import { ageStepAt } from "@/server/services/projection/engine-payload/profile-switches";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { z } from "zod/v4";
import { eq, desc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import { calculateProjection } from "@/lib/pure/engine";
import { toNumber } from "@/lib/utils/numbers";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import { buildDecumulationDefaults } from "@/server/services/projection/projection-run";
import { safeDivide } from "@/lib/utils/math";
import {
  precomputePurchases,
  purchaseMonthlyForYear,
  steadyStateMonthly,
  type RelocationPurchaseInput,
} from "@/lib/pure/retirement/relocation";
import * as schema from "@/lib/db/schema";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import { relocationScenarioParamsSchema } from "@/lib/db/shapes/json-schemas";
import { firstRow } from "@/lib/utils/first-row";
import { writeStamp } from "@/lib/utils/clock";

/** Converts the router's nullable large-purchase input to `RelocationPurchaseInput` once,
 *  so every call site shares lib/pure/retirement/relocation.ts's precomputed data. */
function toRelocationPurchaseInput(
  purchases: {
    purchaseYear: number;
    purchasePrice: number;
    downPaymentPercent: number | null;
    loanRate: number | null;
    loanTermYears: number | null;
    ongoingMonthlyCost: number | null;
    saleProceeds: number | null;
  }[],
): RelocationPurchaseInput[] {
  return purchases.map((p) => ({
    purchasePrice: p.purchasePrice,
    downPaymentPercent: p.downPaymentPercent ?? undefined,
    loanRate: p.loanRate ?? undefined,
    loanTermYears: p.loanTermYears ?? undefined,
    ongoingMonthlyCost: p.ongoingMonthlyCost ?? undefined,
    saleProceeds: p.saleProceeds ?? undefined,
    purchaseYear: p.purchaseYear,
  }));
}

export const relocationProjectionRouter = createTRPCRouter({
  /**
   * Runs the full projection engine for current vs relocation scenarios to find the earliest
   * year the user can move and still retire at retirementAge; returns comparison rows and,
   * with moveYear, a blended projection switching paths at that year.
   */
  computeRelocationFiProjection: protectedProcedure
    .input(
      z.object({
        currentProfileId: z.number().int(),
        currentBudgetColumn: z.number().int().min(0),
        currentExpenseOverride: z.number().min(0).nullable().default(null),
        currentContributionProfileId: z.number().int().nullable().default(null),
        relocationProfileId: z.number().int(),
        relocationBudgetColumn: z.number().int().min(0),
        relocationExpenseOverride: z.number().min(0).nullable().default(null),
        relocationContributionProfileId: z
          .number()
          .int()
          .nullable()
          .default(null),
        // One Salary Profile for both scenarios (stay vs move, one income path).
        // Null: the globally-active Salary Profile, as in every engine endpoint.
        salaryProfileId: z.number().int().nullable().default(null),
        yearAdjustments: z
          .array(
            z.object({
              year: z.number().int(),
              monthlyExpenses: z.number().min(0),
            }),
          )
          .default([]),
        largePurchases: z
          .array(
            z.object({
              purchaseYear: z.number().int(),
              purchasePrice: z.number().min(0),
              downPaymentPercent: z
                .number()
                .min(0)
                .max(1)
                .nullable()
                .default(null),
              loanRate: z.number().min(0).nullable().default(null),
              loanTermYears: z.number().int().min(0).nullable().default(null),
              ongoingMonthlyCost: z.number().min(0).nullable().default(null),
              saleProceeds: z.number().min(0).nullable().default(null),
            }),
          )
          .default([]),
        moveYear: z.number().int().min(1900).max(2100).nullable().default(null),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch all DB tables once — both scenarios share the same base data,
      // the Salary Profile row included. Each scenario applies its own
      // Contribution Profile (the two buildEnginePayload calls below).
      const data = await fetchRetirementData(ctx.db, {
        salaryProfileId: input.salaryProfileId ?? undefined,
      });

      // The Retirement page's saved accumulation overrides, so the current scenario's
      // balances match that page's projection.
      const accumOverrideRows = await ctx.db
        .select()
        .from(schema.projectionOverrides)
        .where(eq(schema.projectionOverrides.overrideType, "accumulation"));
      const dbAccumulationOverrides = ((accumOverrideRows[0]?.overrides as
        Record<string, unknown>[] | undefined) ?? []) as AccumulationOverride[];

      const deaccumOverrideRows = await ctx.db
        .select()
        .from(schema.projectionOverrides)
        .where(eq(schema.projectionOverrides.overrideType, "decumulation"));
      const dbDecumulationOverrides = ((deaccumOverrideRows[0]?.overrides as
        Record<string, unknown>[] | undefined) ?? []) as DecumulationOverride[];

      const currentProfile = data.allBudgetProfiles.find(
        (p) => p.id === input.currentProfileId,
      );
      const relocProfile = data.allBudgetProfiles.find(
        (p) => p.id === input.relocationProfileId,
      );
      if (!currentProfile || !relocProfile) return null;

      const currentItems = data.allBudgetItems.filter(
        (i) => i.profileId === currentProfile.id,
      );
      const relocItems = data.allBudgetItems.filter(
        (i) => i.profileId === relocProfile.id,
      );

      // Resolved through the contribution-account chain (resolveLinkedBudgetItemAmounts),
      // as the Retirement page does: raw `amounts` is stale for contribution-linked items.
      const currentNumColumns = currentProfile.columnLabels.length;
      const relocNumColumns = relocProfile.columnLabels.length;
      const resolvedCurrentItems =
        input.currentExpenseOverride !== null
          ? currentItems
          : await resolveLinkedBudgetItemAmounts(
              ctx,
              currentItems,
              currentNumColumns,
              {
                contribProfileId: input.currentContributionProfileId ?? null,
                salaryProfileId: input.salaryProfileId ?? null,
              },
            );
      const resolvedRelocItems =
        input.relocationExpenseOverride !== null
          ? relocItems
          : await resolveLinkedBudgetItemAmounts(
              ctx,
              relocItems,
              relocNumColumns,
              {
                contribProfileId: input.relocationContributionProfileId ?? null,
                salaryProfileId: input.salaryProfileId ?? null,
              },
            );

      const currentAnnualExpenses =
        input.currentExpenseOverride !== null
          ? input.currentExpenseOverride * 12
          : computeBudgetAnnualTotal(
              resolvedCurrentItems,
              input.currentBudgetColumn,
              currentProfile.columnMonths,
            );
      const relocationAnnualExpenses =
        input.relocationExpenseOverride !== null
          ? input.relocationExpenseOverride * 12
          : computeBudgetAnnualTotal(
              resolvedRelocItems,
              input.relocationBudgetColumn,
              relocProfile.columnMonths,
            );

      // Build engine payloads — each scenario applies its own contribution
      // profile, but shares the same (Plan-pinned or globally-active)
      // Salary Profile, matching every other engine-backed endpoint.
      const currentPayload = await buildEnginePayload(ctx.db, data, {
        asOf: ctx.scope.asOf,
        accumulationExpenseOverride: currentAnnualExpenses,
        contributionProfileId: input.currentContributionProfileId ?? undefined,
        salaryProfileId: input.salaryProfileId ?? undefined,
      });
      if (!currentPayload) return null;
      // No return rate: a state the card words, not an engine throw.
      if (currentPayload.notConfigured)
        return { notConfigured: currentPayload.notConfigured };

      const relocPayload = await buildEnginePayload(ctx.db, data, {
        asOf: ctx.scope.asOf,
        accumulationExpenseOverride: relocationAnnualExpenses,
        contributionProfileId:
          input.relocationContributionProfileId ?? undefined,
        salaryProfileId: input.salaryProfileId ?? undefined,
      });
      if (!relocPayload) return null;

      // No withdrawal routing/order/splits keys: this object is the CLIENT-override slot
      // of `buildDecumulationDefaults`, so omitting them lets each scenario use the
      // household's persisted `retirement_settings`.
      const clientDecumulationDefaults = {
        withdrawalTaxPreference: {},
      };

      const currentDecumulationDefaults = buildDecumulationDefaults(
        currentPayload.settings,
        clientDecumulationDefaults,
        currentPayload.distributionTaxRates,
      );
      const relocDecumulationDefaults = buildDecumulationDefaults(
        relocPayload.settings,
        clientDecumulationDefaults,
        relocPayload.distributionTaxRates,
      );

      // --- Build relocation budget overrides ---
      // The engine inflates last year's expenses when a year has no override, so each
      // year from the first adjusted one to retirement gets an explicit value.
      const purchasePrecomp = precomputePurchases(
        toRelocationPurchaseInput(input.largePurchases),
      );
      const adjustmentByYear = new Map(
        input.yearAdjustments.map((a) => [a.year, a.monthlyExpenses]),
      );
      const baseMonthly = relocationAnnualExpenses / 12;
      const inflationRate = toNumber(relocPayload.settings.annualInflation);
      const currentAge = currentPayload.age;
      const retirementAge = planRetirementAgeOf(relocPayload.baseEngineInput);
      // Expense schedules are keyed to the ENGINE's year 0 (the snapshot's
      // year, which can trail the calendar), so year N carries N years of
      // inflation exactly like the engine's own un-overridden expenses.
      const engineBaseYear =
        relocPayload.baseEngineInput.asOfDate.getFullYear();
      const retirementYear =
        engineBaseYear +
        Math.max(0, retirementAge - relocPayload.baseEngineInput.currentAge);

      const affectedYears = [
        ...input.yearAdjustments.map((a) => a.year),
        ...input.largePurchases.map((p) => p.purchaseYear),
      ];
      const firstAffectedYear =
        affectedYears.length > 0 ? Math.min(...affectedYears) : Infinity;

      const relocBudgetOverrides: { year: number; value: number }[] = [];
      if (isFinite(firstAffectedYear)) {
        // Stops before retirementYear: a budget override in the first
        // retirement year replaces the seeded retirement budget (and later
        // years inflate from it) — these schedules are working-years only.
        for (let y = firstAffectedYear; y < retirementYear; y++) {
          const base = adjustmentByYear.has(y)
            ? adjustmentByYear.get(y)!
            : baseMonthly * Math.pow(1 + inflationRate, y - engineBaseYear);
          const purchaseAddl = purchaseMonthlyForYear(y, purchasePrecomp);
          relocBudgetOverrides.push({ year: y, value: base + purchaseAddl });
        }
      }

      // Moving partway through: ONE run from today on the current scenario switching to
      // the relocation's expenses and contribution profile at moveYear, so salary growth,
      // inflation and year-0 contributions keep counting from today.
      const relocExpensesFrom = (moveYear: number) => {
        const explicit = new Map(
          relocBudgetOverrides.map((o) => [o.year, o.value]),
        );
        const schedule: { year: number; value: number }[] = [];
        for (let y = moveYear; y < retirementYear; y++) {
          schedule.push({
            year: y,
            value:
              explicit.get(y) ??
              baseMonthly * Math.pow(1 + inflationRate, y - engineBaseYear) +
                purchaseMonthlyForYear(y, purchasePrecomp),
          });
        }
        return schedule;
      };
      const currentBase = currentPayload.baseEngineInput;
      const relocBase = relocPayload.baseEngineInput;
      // A ProfileSwitch doesn't carry routing/splits, so a different relocation
      // Contribution Profile also gets a sticky-forward accumulation override at the
      // move year (the household's own overrides for that year still win).
      const relocProfileDiffers =
        (input.relocationContributionProfileId ?? null) !==
        (input.currentContributionProfileId ?? null);
      const withRelocationRouting = (moveYear: number) => {
        if (!relocProfileDiffers) return dbAccumulationOverrides;
        const d = relocBase.accumulationDefaults;
        return [
          {
            year: moveYear,
            routingMode: d.routingMode,
            accountOrder: d.accountOrder,
            accountSplits: d.accountSplits,
            taxSplits: d.taxSplits,
          },
          ...dbAccumulationOverrides,
        ].sort((a, b) => a.year - b.year);
      };
      const runMovingIn = (moveYear: number) =>
        calculateProjection({
          ...currentBase,
          budgetOverrides: [
            ...currentBase.budgetOverrides.filter((o) => o.year < moveYear),
            ...relocExpensesFrom(moveYear),
          ],
          profileSwitches: [
            ...(currentBase.profileSwitches ?? []).filter(
              (ps) => ps.year < moveYear,
            ),
            // The relocation profile as capped by the move year's ages
            // (its latest age step by then), else as capped today.
            ageStepAt(relocPayload.activeAgeSteps, moveYear) ?? {
              year: moveYear,
              contributionSpecs: relocBase.contributionSpecs,
              employerMatchRateByCategory:
                relocBase.employerMatchRateByCategory,
              // Never borrow the current profile's amounts: they also feed
              // brokerage intentional-contribution detection every year.
              baseYearContributions: relocBase.baseYearContributions,
              baseYearEmployerMatch: relocBase.baseYearEmployerMatch,
              employerMatchByParentCat: relocBase.employerMatchByParentCat,
              contributionRate: relocBase.accumulationDefaults.contributionRate,
            },
            ...(relocBase.profileSwitches ?? []).filter(
              (ps) => ps.year > moveYear,
            ),
          ],
          decumulationDefaults: relocDecumulationDefaults,
          accumulationOverrides: withRelocationRouting(moveYear),
          decumulationOverrides: dbDecumulationOverrides,
        });

      // --- Run full projections ---
      // Current scenario: let baseEngineInput.budgetOverrides pass through unchanged.
      // Relocation scenario: override budgetOverrides with relocation-specific ones.
      const currentResult = calculateProjection({
        ...currentPayload.baseEngineInput,
        decumulationDefaults: currentDecumulationDefaults,
        accumulationOverrides: dbAccumulationOverrides,
        decumulationOverrides: dbDecumulationOverrides,
      });

      const relocResult = calculateProjection({
        ...relocPayload.baseEngineInput,
        budgetOverrides: relocBudgetOverrides,
        decumulationDefaults: relocDecumulationDefaults,
        accumulationOverrides: dbAccumulationOverrides,
        decumulationOverrides: dbDecumulationOverrides,
      });

      // --- Summary scalars ---
      const currentAccRows = currentResult.projectionByYear.filter(
        (r) => r.phase === "accumulation",
      );
      const relocAccRows = relocResult.projectionByYear.filter(
        (r) => r.phase === "accumulation",
      );
      const currentBalanceAtRetirement =
        currentAccRows[currentAccRows.length - 1]?.retirementBalance ?? 0;
      const relocationBalanceAtRetirement =
        relocAccRows[relocAccRows.length - 1]?.retirementBalance ?? 0;

      // lib/pure/retirement/relocation.ts's formula (Single Computation Path),
      // reusing the purchasePrecomp from the budget-override loop.
      const withdrawalRate = toNumber(relocPayload.settings.withdrawalRate);
      const ssMonthly = steadyStateMonthly(purchasePrecomp);
      const relocationFiTarget = safeDivide(
        relocationAnnualExpenses + ssMonthly * 12,
        withdrawalRate,
        0,
      );
      // Same formula/rate as relocationFiTarget, so the UI's "Additional Nest Egg
      // Needed" compares two figures from this endpoint (see metrics-and-banner.tsx).
      const currentFiTarget = safeDivide(
        currentAnnualExpenses,
        withdrawalRate,
        0,
      );

      const isViableNow = assessPlan(relocResult).succeeded;

      // --- Build year-by-year comparison rows for the two-column table ---
      const currentAccRowsByYear = new Map(
        currentAccRows.map((r) => [r.year, r]),
      );
      const adjustmentYears = new Set(input.yearAdjustments.map((a) => a.year));
      const largePurchaseImpactByYear = new Map<number, number>();
      for (const pc of purchasePrecomp) {
        const prev = largePurchaseImpactByYear.get(pc.purchaseYear) ?? 0;
        // Net one-time portfolio impact: saleProceeds - cashOutlay (negative = loss).
        largePurchaseImpactByYear.set(
          pc.purchaseYear,
          prev + (pc.saleProceeds - pc.cashOutlay),
        );
      }

      const projectionRows = relocAccRows
        .map((relocRow) => {
          const currentRow = currentAccRowsByYear.get(relocRow.year);
          if (!currentRow) return null;
          return {
            year: relocRow.year,
            age: Math.floor(relocRow.age),
            currentContribution:
              currentRow.totalEmployee + currentRow.totalEmployer,
            currentBalance: currentRow.retirementBalance,
            relocationContribution:
              relocRow.totalEmployee + relocRow.totalEmployer,
            relocationBalance: relocRow.retirementBalance,
            delta: relocRow.retirementBalance - currentRow.retirementBalance,
            relocationExpenses: relocRow.projectedExpenses,
            hasAdjustment: adjustmentYears.has(relocRow.year),
            largePurchaseImpact:
              largePurchaseImpactByYear.get(relocRow.year) ?? 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // --- Binary search for earliest safe relocation year ---
      const probeViable = (rowIndex: number): boolean => {
        const probeResult = runMovingIn(currentAccRows[rowIndex]!.year);
        return assessPlan(probeResult).succeeded;
      };

      let earliestRelocateYear: number | null = null;
      let earliestRelocateAge: number | null = null;
      let recommendedPortfolioToRelocate = relocationFiTarget;

      // "Now" is the projection's year 0 — the snapshot's year — like
      // every row the search below can return.
      if (isViableNow) {
        earliestRelocateYear = engineBaseYear;
        earliestRelocateAge = Math.floor(currentAge);
        recommendedPortfolioToRelocate = currentPayload.portfolioTotal;
      } else if (
        currentAccRows.length > 0 &&
        probeViable(currentAccRows.length - 1)
      ) {
        let lo = 0;
        let hi = currentAccRows.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (probeViable(mid)) {
            hi = mid;
          } else {
            lo = mid + 1;
          }
        }
        const foundRow = currentAccRows[lo]!;
        earliestRelocateYear = foundRow.year;
        earliestRelocateAge = Math.floor(foundRow.age);
        // The move happens at the START of foundRow.year, so what's needed
        // is the balance going into it: the prior year's end (or today's).
        recommendedPortfolioToRelocate =
          lo > 0
            ? currentAccRows[lo - 1]!.retirementBalance
            : currentPayload.portfolioTotal;
      }

      // --- Blended projection (when moveYear is provided) ---
      // Current scenario until moveYear, relocation from moveYear on, in one
      // engine run (runMovingIn above).
      let blendedRows:
        | {
            year: number;
            age: number;
            balance: number;
            contribution: number;
            expenses: number;
            phase: "current" | "relocation";
            hasAdjustment: boolean;
            largePurchaseImpact: number;
          }[]
        | null = null;
      let blendedBalanceAtRetirement: number | null = null;

      if (input.moveYear !== null) {
        const moveYear = input.moveYear;

        // Compared with the engine's year 0 (the snapshot's year), the same
        // basis the move-year switch and expense schedules use.
        if (moveYear <= engineBaseYear) {
          // Immediate move — blended is just the full relocation path.
          blendedRows = relocAccRows.map((row) => ({
            year: row.year,
            age: Math.floor(row.age),
            balance: row.retirementBalance,
            contribution: row.totalEmployee + row.totalEmployer,
            expenses: row.projectedExpenses,
            phase: "relocation" as const,
            hasAdjustment: adjustmentYears.has(row.year),
            largePurchaseImpact: largePurchaseImpactByYear.get(row.year) ?? 0,
          }));
          blendedBalanceAtRetirement = relocationBalanceAtRetirement;
        } else {
          const blended = runMovingIn(moveYear);
          const accRows = blended.projectionByYear.filter(
            (r) => r.phase === "accumulation",
          );
          blendedBalanceAtRetirement = accRows.at(-1)?.retirementBalance ?? 0;
          blendedRows = accRows.map((row) => {
            const moved = row.year >= moveYear;
            return {
              year: row.year,
              age: Math.floor(row.age),
              balance: row.retirementBalance,
              contribution: row.totalEmployee + row.totalEmployer,
              expenses: row.projectedExpenses,
              phase: moved ? ("relocation" as const) : ("current" as const),
              hasAdjustment: moved && adjustmentYears.has(row.year),
              largePurchaseImpact: moved
                ? (largePurchaseImpactByYear.get(row.year) ?? 0)
                : 0,
            };
          });
        }
      }

      return {
        currentBalanceAtRetirement,
        relocationBalanceAtRetirement,
        relocationFiTarget,
        currentFiTarget,
        isViableNow,
        earliestRelocateAge,
        earliestRelocateYear,
        recommendedPortfolioToRelocate,
        projectionRows,
        blendedRows,
        blendedBalanceAtRetirement,
        inflationRate: toNumber(currentPayload.settings.annualInflation),
        // The year "today's dollars" deflate to: the calendar year, as on
        // the Retirement page (use-projection-state), so the two agree.
        baseYear: ctx.scope.asOf.getFullYear(),
      };
    }),

  relocationScenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.relocationScenarios)
        .orderBy(desc(schema.relocationScenarios.updatedAt)),
    ),
    save: adminProcedure
      .input(
        z.object({
          id: z.number().int().optional(),
          name: z.string().min(1),
          params: relocationScenarioParamsSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) {
          return ctx.db
            .update(schema.relocationScenarios)
            .set({
              name: input.name,
              params: input.params,
              updatedAt: writeStamp(),
            })
            .where(eq(schema.relocationScenarios.id, input.id))
            .returning()
            .then(firstRow);
        }
        return ctx.db
          .insert(schema.relocationScenarios)
          .values({ name: input.name, params: input.params })
          .returning()
          .then(firstRow);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.relocationScenarios)
          .where(eq(schema.relocationScenarios.id, input.id)),
      ),
  }),
});
