/**
 * Engine-backed relocation projection.
 *
 * Runs the full retirement projection engine for both the current and
 * relocation budget scenarios. Returns portfolio-at-retirement deltas,
 * a binary-search-derived earliest safe relocation year, a year-by-year
 * comparison table, and (when moveYear is provided) a blended projection
 * that switches from the current path to the relocation path at moveYear.
 */
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/calculators/engine";
import { toNumber } from "@/server/helpers";
import { computeBudgetAnnualTotal } from "@/server/helpers/budget";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import { buildDecumulationDefaults } from "./_shared";
import {
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { calculateLoanMonthlyPayment } from "@/lib/utils/math";
import * as schema from "@/lib/db/schema";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";

/** Pre-computed large purchase data used for ongoing-cost budget overrides
 *  and the per-row portfolio impact indicator. */
type PurchasePrecomp = {
  cashOutlay: number;
  saleProceeds: number;
  monthlyPayment: number;
  paymentEndYear: number; // exclusive — last payment year is paymentEndYear - 1
  ongoingMonthlyCost: number;
  purchaseYear: number;
  /** Net one-time portfolio impact: saleProceeds - cashOutlay (negative = loss). */
  netPortfolioImpact: number;
};

function precomputePurchases(
  purchases: {
    purchaseYear: number;
    purchasePrice: number;
    downPaymentPercent: number | null;
    loanRate: number | null;
    loanTermYears: number | null;
    ongoingMonthlyCost: number | null;
    saleProceeds: number | null;
  }[],
): PurchasePrecomp[] {
  return purchases.map((p) => {
    const downPct = p.downPaymentPercent ?? 1;
    const cashOutlay = p.purchasePrice * downPct;
    const financedPrincipal = p.purchasePrice * (1 - downPct);
    const termYears = p.loanTermYears ?? 0;
    const monthlyPayment = calculateLoanMonthlyPayment(
      financedPrincipal,
      p.loanRate ?? 0,
      termYears,
    );
    const saleProceeds = p.saleProceeds ?? 0;
    return {
      cashOutlay,
      saleProceeds,
      monthlyPayment,
      paymentEndYear: p.purchaseYear + termYears,
      ongoingMonthlyCost: p.ongoingMonthlyCost ?? 0,
      purchaseYear: p.purchaseYear,
      netPortfolioImpact: saleProceeds - cashOutlay,
    };
  });
}

/** Ongoing monthly cost from all purchases active in a given year. */
function purchaseOngoingMonthlyForYear(
  year: number,
  pcs: PurchasePrecomp[],
): number {
  let total = 0;
  for (const pc of pcs) {
    if (year >= pc.purchaseYear) {
      total += pc.ongoingMonthlyCost;
      if (year < pc.paymentEndYear) total += pc.monthlyPayment;
    }
  }
  return total;
}

export const relocationProjectionRouter = createTRPCRouter({
  /**
   * Engine-backed relocation projection.
   *
   * Uses the full retirement projection engine (same data sources as the
   * retirement page) to compare current vs. relocation scenarios and find
   * the earliest year when the user can safely relocate and still retire
   * at their configured retirementAge. Also returns year-by-year projection
   * rows for the comparison table, and — when moveYear is provided — a
   * blended projection switching from current path to relocation path at
   * that year.
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
      // Resolve asOfDate once — all downstream year/age calculations use this.
      const asOfDate = new Date();
      const currentYear = asOfDate.getFullYear();

      // Fetch all DB tables once — both scenarios share the same base data.
      const data = await fetchRetirementData(ctx.db);

      // Load the same accumulation overrides the retirement page uses (stored in DB,
      // not passed via client state). Without these, the current scenario ignores
      // any year-by-year contribution rate or salary overrides the user has
      // configured, producing balances that diverge significantly from the
      // retirement page projection.
      const accumOverrideRows = await ctx.db
        .select()
        .from(schema.projectionOverrides)
        .where(eq(schema.projectionOverrides.overrideType, "accumulation"));
      const dbAccumulationOverrides = ((accumOverrideRows[0]
        ?.overrides as Record<string, unknown>[]) ??
        []) as AccumulationOverride[];

      const deaccumOverrideRows = await ctx.db
        .select()
        .from(schema.projectionOverrides)
        .where(eq(schema.projectionOverrides.overrideType, "decumulation"));
      const dbDecumulationOverrides = ((deaccumOverrideRows[0]
        ?.overrides as Record<string, unknown>[]) ??
        []) as DecumulationOverride[];

      // Resolve annual expenses from budget profiles.
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

      const currentAnnualExpenses =
        input.currentExpenseOverride !== null
          ? input.currentExpenseOverride * 12
          : computeBudgetAnnualTotal(
              currentItems,
              input.currentBudgetColumn,
              currentProfile.columnMonths as number[] | null,
            );
      const relocationAnnualExpenses =
        input.relocationExpenseOverride !== null
          ? input.relocationExpenseOverride * 12
          : computeBudgetAnnualTotal(
              relocItems,
              input.relocationBudgetColumn,
              relocProfile.columnMonths as number[] | null,
            );

      // Build engine payloads — each scenario applies its own contribution profile.
      const currentPayload = await buildEnginePayload(ctx.db, data, {
        accumulationExpenseOverride: currentAnnualExpenses,
        contributionProfileId: input.currentContributionProfileId ?? undefined,
      });
      if (!currentPayload) return null;

      const relocPayload = await buildEnginePayload(ctx.db, data, {
        accumulationExpenseOverride: relocationAnnualExpenses,
        contributionProfileId:
          input.relocationContributionProfileId ?? undefined,
      });
      if (!relocPayload) return null;

      const clientDecumulationDefaults = {
        withdrawalRoutingMode: "bracket_filling" as const,
        withdrawalOrder: getDefaultDecumulationOrder(),
        withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS },
        withdrawalTaxPreference: {} as Record<string, string>,
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
      // Year adjustments are per-year only, but the engine inflates the previous
      // year's expenses when there's no override. To prevent a year-adjustment
      // value from leaking forward via inflation carry, generate an explicit
      // override schedule for ALL years from the first affected year to retirement,
      // using inflation-indexed baseline for non-adjusted years.
      const purchasePrecomp = precomputePurchases(input.largePurchases);
      const adjustmentByYear = new Map(
        input.yearAdjustments.map((a) => [a.year, a.monthlyExpenses]),
      );
      const baseMonthly = relocationAnnualExpenses / 12;
      const inflationRate = toNumber(relocPayload.settings.annualInflation ?? 0);
      const currentAge = currentPayload.age;
      const retirementAge = relocPayload.baseEngineInput.retirementAge;
      const retirementYear =
        currentYear + Math.max(0, retirementAge - currentAge);

      const affectedYears = [
        ...input.yearAdjustments.map((a) => a.year),
        ...input.largePurchases.map((p) => p.purchaseYear),
      ];
      const firstAffectedYear =
        affectedYears.length > 0 ? Math.min(...affectedYears) : Infinity;

      const relocBudgetOverrides: { year: number; value: number }[] = [];
      if (isFinite(firstAffectedYear)) {
        for (let y = firstAffectedYear; y <= retirementYear; y++) {
          const base = adjustmentByYear.has(y)
            ? adjustmentByYear.get(y)!
            : baseMonthly * Math.pow(1 + inflationRate, y - currentYear);
          const purchaseAddl = purchaseOngoingMonthlyForYear(
            y,
            purchasePrecomp,
          );
          relocBudgetOverrides.push({ year: y, value: base + purchaseAddl });
        }
      }

      // --- Run full projections ---
      // Current scenario: let baseEngineInput.budgetOverrides pass through unchanged.
      // Relocation scenario: override budgetOverrides with relocation-specific ones.
      const currentResult = calculateProjection({
        ...currentPayload.baseEngineInput,
        decumulationDefaults: currentDecumulationDefaults,
        accumulationOverrides: dbAccumulationOverrides,
        decumulationOverrides: dbDecumulationOverrides,
      });
      if (!currentResult) return null;

      const relocResult = calculateProjection({
        ...relocPayload.baseEngineInput,
        budgetOverrides: relocBudgetOverrides,
        decumulationDefaults: relocDecumulationDefaults,
        accumulationOverrides: dbAccumulationOverrides,
        decumulationOverrides: dbDecumulationOverrides,
      });
      if (!relocResult) return null;

      // --- Summary scalars ---
      const currentAccRows = currentResult.projectionByYear.filter(
        (r) => r.phase === "accumulation",
      );
      const relocAccRows = relocResult.projectionByYear.filter(
        (r) => r.phase === "accumulation",
      );
      const currentBalanceAtRetirement =
        currentAccRows[currentAccRows.length - 1]?.endBalance ?? 0;
      const relocationBalanceAtRetirement =
        relocAccRows[relocAccRows.length - 1]?.endBalance ?? 0;

      const withdrawalRate = toNumber(relocPayload.settings.withdrawalRate);
      const relocationFiTarget =
        withdrawalRate > 0 ? relocationAnnualExpenses / withdrawalRate : 0;

      const relocLastRow =
        relocResult.projectionByYear[relocResult.projectionByYear.length - 1];
      const isViableNow = (relocLastRow?.endBalance ?? 0) > 0;

      // --- Build year-by-year comparison rows for the two-column table ---
      const currentAccRowsByYear = new Map(
        currentAccRows.map((r) => [r.year, r]),
      );
      const adjustmentYears = new Set(input.yearAdjustments.map((a) => a.year));
      const largePurchaseImpactByYear = new Map<number, number>();
      for (const pc of purchasePrecomp) {
        const prev = largePurchaseImpactByYear.get(pc.purchaseYear) ?? 0;
        largePurchaseImpactByYear.set(
          pc.purchaseYear,
          prev + pc.netPortfolioImpact,
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
            currentBalance: currentRow.endBalance,
            relocationContribution:
              relocRow.totalEmployee + relocRow.totalEmployer,
            relocationBalance: relocRow.endBalance,
            delta: relocRow.endBalance - currentRow.endBalance,
            relocationExpenses: relocRow.projectedExpenses,
            hasAdjustment: adjustmentYears.has(relocRow.year),
            largePurchaseImpact:
              largePurchaseImpactByYear.get(relocRow.year) ?? 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // --- Binary search for earliest safe relocation year ---
      const probeViable = (rowIdx: number): boolean => {
        const probeRow = currentAccRows[rowIdx]!;
        const probeResult = calculateProjection({
          ...relocPayload.baseEngineInput,
          startingBalances: probeRow.balanceByTaxType,
          currentAge: probeRow.age,
          budgetOverrides: relocBudgetOverrides,
          decumulationDefaults: relocDecumulationDefaults,
          accumulationOverrides: dbAccumulationOverrides,
          decumulationOverrides: dbDecumulationOverrides,
        });
        const probeLast =
          probeResult?.projectionByYear[
            probeResult.projectionByYear.length - 1
          ];
        return (probeLast?.endBalance ?? 0) > 0;
      };

      let earliestRelocateYear: number | null = null;
      let earliestRelocateAge: number | null = null;
      let recommendedPortfolioToRelocate = relocationFiTarget;

      if (isViableNow) {
        earliestRelocateYear = currentYear;
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
        recommendedPortfolioToRelocate = foundRow.endBalance;
      }

      // --- Blended projection (when moveYear is provided) ---
      // Phase 1: current path from today through moveYear - 1.
      // Phase 2: relocation path from moveYear to retirement, starting with
      //          Phase 1's ending balance. Uses asOfDate = Jan 1 of moveYear so
      //          engine year/age labels are correct, and trimmed budget overrides
      //          (years < moveYear are never visited in Phase 2).
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

        if (moveYear <= currentYear) {
          // Immediate move — blended is just the full relocation path.
          blendedRows = relocAccRows.map((row) => ({
            year: row.year,
            age: Math.floor(row.age),
            balance: row.endBalance,
            contribution: row.totalEmployee + row.totalEmployer,
            expenses: row.projectedExpenses,
            phase: "relocation" as const,
            hasAdjustment: adjustmentYears.has(row.year),
            largePurchaseImpact: largePurchaseImpactByYear.get(row.year) ?? 0,
          }));
          blendedBalanceAtRetirement = relocationBalanceAtRetirement;
        } else {
          // Future move — current path until moveYear - 1, then relocation.
          const phase1Rows = currentAccRows.filter((r) => r.year < moveYear);
          const phase1HandoffRow = currentAccRows.find(
            (r) => r.year === moveYear - 1,
          );

          if (phase1HandoffRow) {
            const ageAtMoveYear = Math.floor(phase1HandoffRow.age) + 1;
            // Trim overrides: Phase 2 starts at moveYear; past-year entries are unused
            // but trimming keeps the override set clean.
            const phase2BudgetOverrides = relocBudgetOverrides.filter(
              (o) => o.year >= moveYear,
            );

            const phase2Result = calculateProjection({
              ...relocPayload.baseEngineInput,
              startingBalances: phase1HandoffRow.balanceByTaxType,
              currentAge: ageAtMoveYear,
              asOfDate: new Date(moveYear, 0, 1),
              budgetOverrides: phase2BudgetOverrides,
              decumulationDefaults: relocDecumulationDefaults,
              accumulationOverrides: dbAccumulationOverrides,
              decumulationOverrides: dbDecumulationOverrides,
            });

            if (phase2Result) {
              const phase2AccRows = phase2Result.projectionByYear.filter(
                (r) => r.phase === "accumulation",
              );
              const phase2LastAcc = phase2AccRows[phase2AccRows.length - 1];
              blendedBalanceAtRetirement = phase2LastAcc?.endBalance ?? 0;

              blendedRows = [
                ...phase1Rows.map((row) => ({
                  year: row.year,
                  age: Math.floor(row.age),
                  balance: row.endBalance,
                  contribution: row.totalEmployee + row.totalEmployer,
                  expenses: row.projectedExpenses,
                  phase: "current" as const,
                  hasAdjustment: false,
                  largePurchaseImpact: 0,
                })),
                ...phase2AccRows.map((row) => ({
                  year: row.year,
                  age: Math.floor(row.age),
                  balance: row.endBalance,
                  contribution: row.totalEmployee + row.totalEmployer,
                  expenses: row.projectedExpenses,
                  phase: "relocation" as const,
                  hasAdjustment: adjustmentYears.has(row.year),
                  largePurchaseImpact:
                    largePurchaseImpactByYear.get(row.year) ?? 0,
                })),
              ];
            }
          }
        }
      }

      return {
        currentBalanceAtRetirement,
        relocationBalanceAtRetirement,
        relocationFiTarget,
        isViableNow,
        earliestRelocateAge,
        earliestRelocateYear,
        recommendedPortfolioToRelocate,
        projectionRows,
        blendedRows,
        blendedBalanceAtRetirement,
        inflationRate: toNumber(currentPayload.settings.annualInflation ?? 0),
        baseYear: currentYear,
      };
    }),
});
