/**
 * Scenario endpoints: unified projection engine.
 *
 * Contains `computeProjection` (the unified contribution/distribution
 * engine). Coast FIRE endpoints (`computeCoastFire`, `computeCoastFireMC`)
 * live in the sibling `coast-fire.ts` file.
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the v0.5.2
 * file-split refactor. Pure relocation — no logic changes.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { DEFAULT_RETURN_RATE, DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  buildAccumulationOrder,
  computeCurrentStockAllocationPercent,
} from "../projection-v5-helpers";
import {
  buildContributionDisplaySpecs,
  accountDisplayName,
  toNumber,
} from "@/server/helpers";
import type {
  AccountCategory,
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getAllCategories,
  categoriesWithIrsLimit,
  categoriesWithTaxPreference,
  getLimitGroup,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import { roundToCents } from "@/lib/utils/math";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  buildCoastFireProfileSwitches,
} from "./_shared";

export const scenariosRouter = createTRPCRouter({
  /**
   * Contribution/Distribution Engine
   *
   * Unified projection that handles both accumulation and decumulation
   * with full control over routing mode, tax splits, artificial caps,
   * and per-year sticky-forward overrides.
   *
   * All data (salary, contributions, portfolio, limits, return rates)
   * comes from the same DB sources as the other endpoints — this engine
   * just gives you much more granular control over how money is routed.
   */
  computeProjection: protectedProcedure
    .input(
      z.object({
        // Accumulation defaults are derived from paycheck/contribution accounts on the server.
        // No client-side accumulation defaults input.

        // --- Decumulation defaults ---
        decumulationDefaults: z
          .object({
            withdrawalRate: z
              .number()
              .min(0)
              .max(1)
              .default(DEFAULT_WITHDRAWAL_RATE),
            withdrawalRoutingMode: z
              .enum(["bracket_filling", "waterfall", "percentage"])
              .default("bracket_filling"),
            withdrawalOrder: z
              .array(z.enum(accountCategoryEnum()))
              .default(getDefaultDecumulationOrder()),
            withdrawalSplits: z
              .record(z.enum(accountCategoryEnum()), z.number())
              .default({ ...CONFIG_WITHDRAWAL_SPLITS }),
            withdrawalTaxPreference: z
              .record(z.string(), z.enum(["traditional", "roth"]))
              .default({}),
          })
          .default({
            withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
            withdrawalRoutingMode: "bracket_filling",
            withdrawalOrder: getDefaultDecumulationOrder(),
            withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS },
            withdrawalTaxPreference: {},
          }),

        // --- Accumulation overrides ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides ---
        decumulationOverrides: decumulationOverrideSchema,

        // --- Optional salary overrides from UI ---
        salaryOverrides: z
          .array(z.object({ personId: z.number(), salary: z.number() }))
          .optional(),
        // --- Optional contribution profile (overrides contribution accounts + salary) ---
        contributionProfileId: z.number().int().optional(),
        // --- Phase-based budget selection (independent profile+column per phase) ---
        accumulationBudgetProfileId: z.number().int().optional(),
        accumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for accumulation (bypasses budget profile). */
        accumulationExpenseOverride: z.number().min(0).optional(),
        decumulationBudgetProfileId: z.number().int().optional(),
        decumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for decumulation (bypasses budget profile). */
        decumulationExpenseOverride: z.number().min(0).optional(),
        /** When true, skip the heavy projection calculation and return only metadata (settings, expenses, budget profiles). */
        metadataOnly: z.boolean().default(false),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
        /** When set, apply a Coast FIRE scenario override: zero all contributions
         *  starting at this age. Replaces user-authored accumulation overrides
         *  for this query — Coast FIRE is a pure "stop contributing" scenario.
         *  Decumulation overrides are preserved. */
        coastFireOverrideAge: z.number().int().min(18).max(120).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input.snapshotId,
        contributionProfileId: input.contributionProfileId,
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input.salaryOverrides,
        contributionProfileId: input.contributionProfileId,
        accumulationBudgetProfileId: input.accumulationBudgetProfileId,
        accumulationBudgetColumn: input.accumulationBudgetColumn,
        accumulationExpenseOverride: input.accumulationExpenseOverride,
        decumulationBudgetProfileId: input.decumulationBudgetProfileId,
        decumulationBudgetColumn: input.decumulationBudgetColumn,
        decumulationExpenseOverride: input.decumulationExpenseOverride,
      });
      if (!payload) return { result: null };

      const {
        primaryPerson,
        settings,
        filingStatus,
        people,
        activeJobs,
        activeContribs,
        jobSalaries,
        age,
        avgRetirementAge,
        maxEndAge,
        totalCompensation,
        portfolioByTaxType,
        portfolioByTaxTypeByParentCat,
        portfolioByAccount,
        accountOwnersByCategory,
        ownershipByPerson,
        accountBreakdownByCategory,
        contribByCategory,
        employerMatchByCategory,
        salaryByPerson,
        salaryOverrideRows,
        budgetOverrideRows,
        perPersonSettings,
        budgetProfileSummaries,
        selectedScenario,
        relevantReturnRates,
        displayContribRate,
        noContribData,
        distributionTaxRates,
        annualExpensesVal,
        accumulationExpenses,
        decumulationExpenses,
        accProfile,
        accCol,
        decProfile,
        decCol,
        limitByGroup,
        personNameById,
        perfCategoryMap,
        perfAccountMap,
        rothConversionPresets,
        portfolioTotal,
        baseEngineInput,
      } = payload;

      // Router-level warnings for silent fallbacks
      const routerWarnings: string[] = [];
      const nullContribAccounts = activeContribs.filter(
        (c) =>
          c.contributionValue === null || c.contributionValue === undefined,
      );
      if (nullContribAccounts.length > 0) {
        routerWarnings.push(
          `${nullContribAccounts.length} contribution account(s) have no contribution value set — defaulting to $0`,
        );
      }
      if (portfolioTotal === 0) {
        routerWarnings.push(
          "No portfolio snapshot available — all starting balances default to $0",
        );
      }

      // When coastFireOverrideAge is set, inject a synthetic ProfileSwitch at
      // the coast year that zeros contributions + employer match sticky-
      // forward. Merges with user-authored profileSwitches (preserves any
      // pre-coast-year user switches). See buildCoastFireProfileSwitches docs.
      const profileSwitchesForEngine =
        input.coastFireOverrideAge != null
          ? buildCoastFireProfileSwitches(
              baseEngineInput,
              input.coastFireOverrideAge,
            )
          : baseEngineInput.profileSwitches;

      // When metadataOnly is true, skip the heavy projection calculation (used by the
      // retirement page which only needs settings/expenses/budget metadata).
      const result = input.metadataOnly
        ? null
        : calculateProjection({
            ...baseEngineInput,
            profileSwitches: profileSwitchesForEngine,
            decumulationDefaults: buildDecumulationDefaults(
              settings,
              input.decumulationDefaults,
              distributionTaxRates,
            ),
            accumulationOverrides:
              input.accumulationOverrides as AccumulationOverride[],
            decumulationOverrides:
              input.decumulationOverrides as DecumulationOverride[],
          });

      if (result && routerWarnings.length > 0) {
        result.warnings.unshift(...routerWarnings);
      }
      if (result && noContribData) {
        result.warnings.push(
          "No contribution accounts found — projections may be inaccurate. Add contribution accounts on the Paycheck page.",
        );
      }

      // Plan health inputs (v0.5 expert-review M1 + M6) — derived inputs
      // the PlanHealthCard needs for contribution-order and glide-path
      // warnings. Implementation lives in projection-v5-helpers.ts.
      const accumulationOrder = buildAccumulationOrder(activeContribs);
      const currentStockAllocationPercent =
        await computeCurrentStockAllocationPercent(ctx.db, age);

      return {
        result,
        planHealth: {
          currentAge: age,
          accumulationOrder,
          currentStockAllocationPercent,
        },
        combinedSalary: roundToCents(totalCompensation),
        baseLimits: Object.fromEntries(
          categoriesWithIrsLimit().map((cat) => {
            const group = getLimitGroup(cat)!;
            return [cat, limitByGroup[group] ?? 0];
          }),
        ) as Record<AccountCategory, number>,
        portfolioByTaxType,
        portfolioByTaxTypeByParentCat,
        portfolioByAccount,
        accountOwnersByCategory,
        ownershipByPerson,
        accountBreakdownByCategory,
        /** Per-account contribution specs used for projection (shared helper) */
        contributionSpecs: buildContributionDisplaySpecs(
          activeContribs,
          people,
          activeJobs,
          jobSalaries,
        ).map(({ personId, ...rest }) => {
          // Add parentCategory from the linked performance account
          const contrib = activeContribs.find(
            (c) =>
              c.accountType === rest.category &&
              (personId != null
                ? c.personId === personId
                : personNameById.get(c.personId) === rest.ownerName),
          );
          const parentCategory =
            contrib?.parentCategory ??
            (contrib?.performanceAccountId
              ? perfCategoryMap.get(contrib.performanceAccountId)
              : undefined);
          // Match to portfolio account display name using same cascade as engine
          const matchTaxType =
            TAX_TREATMENT_TO_TAX_TYPE[rest.taxTreatment] ?? rest.taxTreatment;
          const catAccts = accountBreakdownByCategory[rest.category] ?? [];
          const exactOwner = (a: {
            ownerPersonId?: number;
            ownerName?: string;
          }) =>
            a.ownerPersonId != null && personId != null
              ? a.ownerPersonId === personId
              : a.ownerName === rest.ownerName;
          const noOwner = (a: { ownerPersonId?: number; ownerName?: string }) =>
            a.ownerPersonId === undefined && a.ownerName === undefined;
          const parentCatMatch = (a: { parentCategory?: string }) => {
            if (a.parentCategory && parentCategory)
              return a.parentCategory === parentCategory;
            return true;
          };
          const matchedAcct =
            catAccts.find(
              (a) =>
                exactOwner(a) &&
                a.taxType === matchTaxType &&
                parentCatMatch(a),
            ) ??
            catAccts.find(
              (a) =>
                noOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
            ) ??
            catAccts.find((a) => exactOwner(a) && parentCatMatch(a)) ??
            catAccts.find(
              (a) => (exactOwner(a) || noOwner(a)) && parentCatMatch(a),
            );
          // Fallback: use linked performance account's display name.
          // perfAcct includes ownershipType so accountDisplayName applies
          // "Joint" prefix for joint accounts automatically.
          const perfAcct = contrib?.performanceAccountId
            ? perfAccountMap.get(contrib.performanceAccountId)
            : undefined;
          const perfFallback = perfAcct
            ? accountDisplayName(perfAcct, rest.ownerName ?? undefined)
            : undefined;
          return {
            ...rest,
            personId,
            parentCategory,
            // Prefer perf account name, fall back to portfolio match name
            accountDisplayName: perfFallback ?? matchedAcct?.name,
          };
        }),
        /** Real-world contribution data derived from active paycheck/contribution accounts */
        realDefaults: {
          contributionRate: displayContribRate,
          taxSplits: Object.fromEntries(
            categoriesWithTaxPreference().map((cat) => [
              cat,
              contribByCategory[cat].rothFraction,
            ]),
          ),
          annualByCategory: Object.fromEntries(
            getAllCategories().map((cat) => [
              cat,
              contribByCategory[cat].annual,
            ]),
          ),
          employerMatchByCategory,
        },
        people: people.map((p) => ({
          id: p.id,
          name: p.name,
          birthYear: new Date(p.dateOfBirth).getFullYear(),
        })),
        selectedScenario: selectedScenario
          ? {
              distributionTaxRateTraditional:
                selectedScenario.distributionTaxRateTraditional,
              distributionTaxRateRoth: selectedScenario.distributionTaxRateRoth,
              distributionTaxRateBrokerage:
                selectedScenario.distributionTaxRateBrokerage,
            }
          : null,
        returnRateSummary: (() => {
          const schedule = relevantReturnRates.map((r) => {
            const ageMatch = r.label.match(/(\d+)/);
            return { age: ageMatch ? Number(ageMatch[1]) : 0, rate: r.rate };
          });
          const accRates = schedule.filter((r) => r.age <= avgRetirementAge);
          return {
            currentRate: schedule[0]?.rate ?? null,
            retirementRate:
              schedule.find((r) => r.age === avgRetirementAge)?.rate ?? null,
            postRetirementRate:
              schedule.find((r) => r.age === avgRetirementAge + 1)?.rate ??
              null,
            avgAccumulation:
              accRates.length > 0
                ? accRates.reduce((s, r) => s + r.rate, 0) / accRates.length
                : DEFAULT_RETURN_RATE,
            schedule,
          };
        })(),
        /** DB-stored overrides for salary/budget CRUD in the UI */
        dbSalaryOverrides: salaryOverrideRows.map((o) => ({
          id: o.id,
          personId: o.personId,
          projectionYear: o.projectionYear,
          overrideSalary: toNumber(o.overrideSalary),
          contributionProfileId: o.contributionProfileId ?? null,
          notes: o.notes,
        })),
        salaryByPerson,
        dbBudgetOverrides: budgetOverrideRows
          .filter((o) => o.personId === primaryPerson.id)
          .map((o) => ({
            id: o.id,
            personId: o.personId,
            projectionYear: o.projectionYear,
            overrideMonthlyBudget: toNumber(o.overrideMonthlyBudget),
            notes: o.notes,
          })),
        primaryPersonId: primaryPerson.id,
        settings: {
          retirementAge: avgRetirementAge,
          endAge: maxEndAge,
          annualInflation: settings.annualInflation,
          postRetirementInflation: settings.postRetirementInflation,
          salaryAnnualIncrease: settings.salaryAnnualIncrease,
          personId: settings.personId,
          returnAfterRetirement: settings.returnAfterRetirement,
          salaryCap: settings.salaryCap,
          withdrawalRate: settings.withdrawalRate,
          taxMultiplier: settings.taxMultiplier,
          grossUpForTaxes: settings.grossUpForTaxes,
          rothBracketTarget: settings.rothBracketTarget,
          enableRothConversions: settings.enableRothConversions,
          rothConversionTarget: settings.rothConversionTarget,
          withdrawalStrategy: settings.withdrawalStrategy,
          gkUpperGuardrail: settings.gkUpperGuardrail,
          gkLowerGuardrail: settings.gkLowerGuardrail,
          gkIncreasePct: settings.gkIncreasePct,
          gkDecreasePct: settings.gkDecreasePct,
          gkSkipInflationAfterLoss: settings.gkSkipInflationAfterLoss,
          sdAnnualDeclineRate: settings.sdAnnualDeclineRate,
          cpWithdrawalPercent: settings.cpWithdrawalPercent,
          cpFloorPercent: settings.cpFloorPercent,
          enWithdrawalPercent: settings.enWithdrawalPercent,
          enRollingYears: settings.enRollingYears,
          enFloorPercent: settings.enFloorPercent,
          vdBasePercent: settings.vdBasePercent,
          vdCeilingPercent: settings.vdCeilingPercent,
          vdFloorPercent: settings.vdFloorPercent,
          rmdMultiplier: settings.rmdMultiplier,
          socialSecurityMonthly: settings.socialSecurityMonthly,
          ssStartAge: settings.ssStartAge,
          enableIrmaaAwareness: settings.enableIrmaaAwareness,
          enableAcaAwareness: settings.enableAcaAwareness,
          householdSize: settings.householdSize,
          filingStatus,
          filingStatusExplicit: settings.filingStatus ?? null,
        },
        perPersonSettings,
        annualExpenses: annualExpensesVal,
        accumulationBudgetProfileId: accProfile?.id ?? null,
        accumulationBudgetColumn: accCol,
        decumulationBudgetProfileId: decProfile?.id ?? null,
        decumulationBudgetColumn: decCol,
        accumulationExpenses,
        decumulationExpenses,
        budgetProfileSummaries,
        /** Unique bracket rates from DB tax brackets for Roth conversion dropdown presets. */
        rothConversionPresets,
        /** Brokerage goals for the brokerage page */
        brokerageGoals: data.brokerageGoalRows.map((g) => ({
          id: g.id,
          name: g.name,
          targetAmount: toNumber(g.targetAmount),
          targetYear: g.targetYear,
          priority: g.priority,
        })),
      };
    }),
});
