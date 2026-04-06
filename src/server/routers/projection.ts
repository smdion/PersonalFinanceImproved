/** Projection router for long-term financial forecasting including accumulation/decumulation phases, Monte Carlo simulations, and lump-sum scenario modeling. */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateProjection } from "@/lib/calculators/engine";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  interpolateAllocations,
  geometricMean,
} from "@/lib/calculators/random";
import { formatPercent } from "@/lib/utils/format";
import { toNumber } from "@/server/helpers";
import type {
  AccountBalance,
  AccountCategory,
  AccumulationOverride,
  DecumulationOverride,
  DecumulationDefaults,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getAllCategories,
  categoriesWithIrsLimit,
  categoriesWithTaxPreference,
  getLimitGroup,
  getDefaultDecumulationOrder,
  isOverflowTarget,
  zeroBalance,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/display-labels";
import { roundToCents } from "@/lib/utils/math";

const lumpSumSchema = z
  .array(
    z.object({
      amount: z.number().positive(),
      targetAccount: z.enum(accountCategoryEnum()),
      taxType: z.enum(["traditional", "roth"]).optional(),
      targetAccountName: z.string().max(200).optional(),
      label: z.string().max(100).optional(),
    }),
  )
  .optional();

// Shared Zod schemas for accumulation/decumulation overrides — used by
// computeProjection and computeMonteCarloProjection inputs.
const accumulationOverrideSchema = z
  .array(
    z.object({
      year: z.number().int(),
      contributionRate: z.number().min(0).max(1).optional(),
      routingMode: z.enum(["waterfall", "percentage"]).optional(),
      accountOrder: z.array(z.enum(accountCategoryEnum())).optional(),
      accountSplits: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      taxSplits: z
        .record(z.enum(accountCategoryEnum()), z.number().min(0).max(1))
        .optional(),
      accountCaps: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      taxTypeCaps: z
        .object({
          traditional: z.number().optional(),
          roth: z.number().optional(),
        })
        .optional(),
      lumpSums: lumpSumSchema,
      reset: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  )
  .default([]);

const decumulationOverrideSchema = z
  .array(
    z.object({
      year: z.number().int(),
      withdrawalRate: z.number().min(0).max(1).optional(),
      withdrawalRoutingMode: z
        .enum(["bracket_filling", "waterfall", "percentage"])
        .optional(),
      withdrawalOrder: z.array(z.enum(accountCategoryEnum())).optional(),
      withdrawalSplits: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      withdrawalTaxPreference: z
        .record(z.enum(accountCategoryEnum()), z.enum(["traditional", "roth"]))
        .optional(),
      withdrawalAccountCaps: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      withdrawalTaxTypeCaps: z
        .object({
          traditional: z.number().optional(),
          roth: z.number().optional(),
        })
        .optional(),
      rothConversionTarget: z.number().min(0).max(1).optional(),
      lumpSums: lumpSumSchema,
      reset: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  )
  .default([]);
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { fetchRetirementData, buildEnginePayload } from "./retirement";
import {
  buildContributionDisplaySpecs,
  accountDisplayName,
} from "@/server/helpers";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import {
  getAllStrategyKeys,
  getStrategyMeta,
  getStrategyDefaults,
} from "@/lib/config/withdrawal-strategies";

/** Build strategyParams from DB settings columns. */
function buildStrategyParams(settings: {
  gkUpperGuardrail: string | null;
  gkLowerGuardrail: string | null;
  gkIncreasePct: string | null;
  gkDecreasePct: string | null;
  gkSkipInflationAfterLoss: boolean;
  sdAnnualDeclineRate: string | null;
  cpWithdrawalPercent: string | null;
  cpFloorPercent: string | null;
  enWithdrawalPercent: string | null;
  enRollingYears: number | null;
  enFloorPercent: string | null;
  vdBasePercent: string | null;
  vdCeilingPercent: string | null;
  vdFloorPercent: string | null;
  rmdMultiplier: string | null;
}): Partial<Record<WithdrawalStrategyType, Record<string, number | boolean>>> {
  return {
    guyton_klinger: {
      upperGuardrail: toNumber(settings.gkUpperGuardrail ?? "0.80"),
      lowerGuardrail: toNumber(settings.gkLowerGuardrail ?? "1.20"),
      increasePercent: toNumber(settings.gkIncreasePct ?? "0.10"),
      decreasePercent: toNumber(settings.gkDecreasePct ?? "0.10"),
      skipInflationAfterLoss: settings.gkSkipInflationAfterLoss,
    },
    spending_decline: {
      annualDeclineRate: toNumber(settings.sdAnnualDeclineRate ?? "0.02"),
    },
    constant_percentage: {
      withdrawalPercent: toNumber(settings.cpWithdrawalPercent ?? "0.05"),
      floorPercent: toNumber(settings.cpFloorPercent ?? "0.90"),
    },
    endowment: {
      withdrawalPercent: toNumber(settings.enWithdrawalPercent ?? "0.05"),
      rollingYears: settings.enRollingYears ?? 10,
      floorPercent: toNumber(settings.enFloorPercent ?? "0.90"),
    },
    vanguard_dynamic: {
      basePercent: toNumber(settings.vdBasePercent ?? "0.05"),
      ceilingPercent: toNumber(settings.vdCeilingPercent ?? "0.05"),
      floorPercent: toNumber(settings.vdFloorPercent ?? "0.025"),
    },
    rmd_spending: {
      rmdMultiplier: toNumber(settings.rmdMultiplier ?? "1.0"),
    },
  };
}

/**
 * Build decumulation defaults from DB settings + client-supplied routing overrides.
 * Shared by computeProjection and computeMonteCarloProjection.
 */
function buildDecumulationDefaults(
  settings: Parameters<typeof buildStrategyParams>[0] & {
    withdrawalRate: string | null;
    withdrawalStrategy: string | null;
  },
  clientDefaults: {
    withdrawalRoutingMode: string;
    withdrawalOrder: string[];
    withdrawalSplits: Record<string, number>;
    withdrawalTaxPreference: Record<string, string>;
  },
  distributionTaxRates: DecumulationDefaults["distributionTaxRates"],
): DecumulationDefaults {
  return {
    withdrawalRate: toNumber(settings.withdrawalRate),
    withdrawalRoutingMode:
      clientDefaults.withdrawalRoutingMode as DecumulationDefaults["withdrawalRoutingMode"],
    withdrawalOrder: clientDefaults.withdrawalOrder as AccountCategory[],
    withdrawalSplits: clientDefaults.withdrawalSplits as Record<
      AccountCategory,
      number
    >,
    withdrawalTaxPreference: clientDefaults.withdrawalTaxPreference as Partial<
      Record<AccountCategory, "traditional" | "roth">
    >,
    distributionTaxRates,
    withdrawalStrategy:
      (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed",
    strategyParams: buildStrategyParams(settings),
  };
}

export const projectionRouter = createTRPCRouter({
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
      }),
    )
    .query(async ({ ctx, input }) => {
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input.snapshotId,
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
        age: _age,
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

      // Build the engine input — accumulation defaults from DB, overrides from UI
      // When metadataOnly is true, skip the heavy projection calculation (used by the
      // retirement page which only needs settings/expenses/budget metadata).
      const result = input.metadataOnly
        ? null
        : calculateProjection({
            ...baseEngineInput,
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

      return {
        result,
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
          // Fallback: use linked performance account's display name
          // Pass the contributor's ownerName so joint accounts show the correct person
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
            // Prefer perf account name (uses contributor's ownerName for joint accounts),
            // fall back to portfolio match name
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

  /**
   * Monte Carlo Projection
   *
   * Runs N trials of the contribution engine with randomized return rates
   * sampled from correlated log-normal distributions based on asset class
   * parameters and glide path allocations from the DB.
   *
   * Returns percentile bands for fan chart, success rate, and key metrics.
   */
  computeMonteCarloProjection: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.object({
        numTrials: z.number().int().min(100).max(10000).default(1000),
        seed: z.number().int().optional(),
        /** Simulation preset: controls return assumptions, volatility, inflation risk, and trial count. */
        preset: z
          .enum(["aggressive", "default", "conservative", "custom"])
          .default("default"),
        /** Tax mode: 'simple' collapses to single tax-free balance (cFIREsim-comparable), 'advanced' uses full multi-account tax engine. */
        taxMode: z.enum(["simple", "advanced"]).default("simple"),
        // --- Optional contribution profile (overrides contribution accounts + salary) ---
        contributionProfileId: z.number().int().optional(),
        /** Optional per-asset-class return/volatility overrides from the UI. */
        assetClassOverrides: z
          .array(
            z.object({
              id: z.number(),
              meanReturn: z.number().min(-0.1).max(0.3).optional(),
              stdDev: z.number().min(0).max(0.5).optional(),
            }),
          )
          .optional(),
        /** Optional salary overrides from UI (same as getProjection). */
        salaryOverrides: z
          .array(z.object({ personId: z.number(), salary: z.number() }))
          .optional(),

        // --- Decumulation defaults (mirrors getProjection) ---
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

        // --- Accumulation overrides (mirrors getProjection) ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides (mirrors getProjection) ---
        decumulationOverrides: decumulationOverrideSchema,

        // --- Phase-based budget selection (independent profile+column per phase) ---
        accumulationBudgetProfileId: z.number().int().optional(),
        accumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for accumulation (bypasses budget profile). */
        accumulationExpenseOverride: z.number().min(0).optional(),
        decumulationBudgetProfileId: z.number().int().optional(),
        decumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for decumulation (bypasses budget profile). */
        decumulationExpenseOverride: z.number().min(0).optional(),
        /** Optional inflation risk params. */
        inflationRisk: z
          .object({
            meanRate: z.number().min(0).max(0.2),
            stdDev: z.number().min(0).max(0.1),
          })
          .optional(),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch shared data + MC-specific tables + saved overrides in parallel
      const [
        data,
        assetClasses,
        assetCorrelations,
        glidePathRows,
        savedAssetOverridesRow,
        savedInflationOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input.snapshotId }),
        ctx.db
          .select()
          .from(schema.assetClassParams)
          .where(eq(schema.assetClassParams.isActive, true))
          .orderBy(asc(schema.assetClassParams.sortOrder)),
        ctx.db.select().from(schema.assetClassCorrelations),
        ctx.db.select().from(schema.glidePathAllocations),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_asset_class_overrides"))
          .then((r) => r[0] ?? null),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
          .then((r) => r[0] ?? null),
      ]);

      // Merge saved overrides: UI-provided overrides take priority over DB-saved ones
      const savedAssetOverrides = (savedAssetOverridesRow?.value ?? []) as {
        id: number;
        meanReturn?: number;
        stdDev?: number;
      }[];
      const savedInflationOverrides = (savedInflationOverridesRow?.value ??
        null) as { meanRate?: number; stdDev?: number } | null;

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
      if (!payload)
        return {
          result: null,
          savedOverrides: {
            assetClassOverrides: savedAssetOverrides,
            inflationOverrides: savedInflationOverrides,
          },
        };

      const {
        settings,
        bracketData: _bracketData,
        age,
        avgRetirementAge,
        maxEndAge,
        totalCompensation,
        portfolioByTaxType,
        employerMatchByCategory,
        selectedScenario: _selectedScenario,
        totalRealContrib,
        distributionTaxRates,
        annualExpensesVal,
        baseEngineInput,
      } = payload;

      // Build the full engine input — mirrors getProjection so MC respects the same overrides
      const engineInput = {
        ...baseEngineInput,
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          input.decumulationDefaults,
          distributionTaxRates,
        ),
        accumulationOverrides:
          input.accumulationOverrides as AccumulationOverride[],
        decumulationOverrides:
          input.decumulationOverrides as DecumulationOverride[],
      };

      // Simple tax mode: collapse all balances into a single tax-free portfolio (cFIREsim-comparable)
      if (input.taxMode === "simple") {
        const totalBalance =
          portfolioByTaxType.preTax +
          portfolioByTaxType.taxFree +
          portfolioByTaxType.hsa +
          portfolioByTaxType.afterTax;

        engineInput.startingBalances = {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: totalBalance,
          afterTaxBasis: totalBalance,
        };

        // Zero all account balances, put totalBalance in the overflow target (brokerage)
        const simplifiedBalances = Object.fromEntries(
          getAllCategories().map((cat) => {
            if (isOverflowTarget(cat)) {
              return [
                cat,
                {
                  structure: "basis_tracking" as const,
                  balance: totalBalance,
                  basis: totalBalance,
                },
              ];
            }
            return [cat, zeroBalance(cat)];
          }),
        ) as Record<AccountCategory, AccountBalance>;
        engineInput.startingAccountBalances = simplifiedBalances;

        engineInput.decumulationDefaults.distributionTaxRates = {
          ...engineInput.decumulationDefaults.distributionTaxRates,
          traditionalFallbackRate: 0,
          roth: 0,
          hsa: 0,
          brokerage: 0,
          grossUpForTaxes: false,
        };
      }

      // ----- Monte Carlo: Fetch preset from DB -----
      const isCustom = input.preset === "custom";

      // Fetch preset row + its glide path + return overrides from DB
      const [presetRows, presetGpRows, presetRoRows] = await Promise.all([
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .select()
              .from(schema.mcPresets)
              .where(eq(schema.mcPresets.key, input.preset)),
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .execute<{
                preset_key: string;
                age: number;
                asset_class_id: number;
                class_name: string;
                allocation: string;
              }>(
                sql`SELECT p.key AS preset_key, gp.age, gp.asset_class_id, ac.name AS class_name, gp.allocation
                  FROM mc_preset_glide_paths gp
                  JOIN mc_presets p ON p.id = gp.preset_id
                  JOIN asset_class_params ac ON ac.id = gp.asset_class_id
                  WHERE p.key = ${input.preset}
                  ORDER BY gp.age, ac.sort_order`,
              )
              .then((r) => r.rows),
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .execute<{
                asset_class_id: number;
                class_name: string;
                mean_return: string;
              }>(
                sql`SELECT ro.asset_class_id, ac.name AS class_name, ro.mean_return
                  FROM mc_preset_return_overrides ro
                  JOIN mc_presets p ON p.id = ro.preset_id
                  JOIN asset_class_params ac ON ac.id = ro.asset_class_id
                  WHERE p.key = ${input.preset}`,
              )
              .then((r) => r.rows),
      ]);

      const preset = presetRows[0] ?? null;

      // Build override lookups: DB-saved overrides as base, UI overrides on top
      const effectiveAssetOverrides = [...savedAssetOverrides];
      for (const uiOvr of input.assetClassOverrides ?? []) {
        const idx = effectiveAssetOverrides.findIndex((o) => o.id === uiOvr.id);
        if (idx >= 0) effectiveAssetOverrides[idx] = uiOvr;
        else effectiveAssetOverrides.push(uiOvr);
      }
      const overrideById = new Map(
        effectiveAssetOverrides.map((o) => [o.id, o]),
      );
      const returnOverrideById = new Map(
        presetRoRows.map((ro) => [ro.asset_class_id, toNumber(ro.mean_return)]),
      );
      const hasReturnOverrides = returnOverrideById.size > 0;

      // Validate asset class override IDs match DB
      if (input.assetClassOverrides) {
        const activeIds = new Set(assetClasses.map((ac) => ac.id));
        for (const override of input.assetClassOverrides) {
          if (!activeIds.has(override.id)) {
            throw new Error(
              `Asset class override id '${override.id}' does not match any active asset class`,
            );
          }
        }
      }

      // Build MC-specific inputs: UI overrides > preset return overrides > preset multiplier > DB values
      const returnMultiplier = preset ? toNumber(preset.returnMultiplier) : 1.0;
      const volMultiplier = preset ? toNumber(preset.volMultiplier) : 1.0;

      const mcAssetClasses = assetClasses.map((ac) => {
        const dbReturn = toNumber(ac.meanReturn);
        const dbStdDev = toNumber(ac.stdDev);
        const uiOverride = overrideById.get(ac.id);
        return {
          id: ac.id,
          name: ac.name,
          meanReturn:
            uiOverride?.meanReturn ??
            (hasReturnOverrides
              ? (returnOverrideById.get(ac.id) ??
                dbReturn * (returnMultiplier || 0.5))
              : isCustom
                ? dbReturn
                : dbReturn * returnMultiplier),
          stdDev:
            uiOverride?.stdDev ??
            (isCustom ? dbStdDev : dbStdDev * volMultiplier),
        };
      });

      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));

      // Glide path: DB preset for named presets, glide_path_allocations for custom
      let mcGlidePath: { age: number; allocations: Record<number, number> }[];
      if (!isCustom && presetGpRows.length > 0) {
        // Build from mc_preset_glide_paths
        const gpByAge = new Map<number, Record<number, number>>();
        for (const row of presetGpRows) {
          if (!gpByAge.has(row.age)) gpByAge.set(row.age, {});
          gpByAge.get(row.age)![row.asset_class_id] = toNumber(row.allocation);
        }
        mcGlidePath = Array.from(gpByAge.entries())
          .sort(([a], [b]) => a - b)
          .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      } else {
        // Custom: build from glide_path_allocations table
        const gpByAge = new Map<number, Record<number, number>>();
        for (const gp of glidePathRows) {
          if (!gpByAge.has(gp.age)) gpByAge.set(gp.age, {});
          gpByAge.get(gp.age)![gp.assetClassId] = toNumber(gp.allocation);
        }
        mcGlidePath = Array.from(gpByAge.entries())
          .sort(([a], [b]) => a - b)
          .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      }

      // Resolve effective inflation risk: explicit UI override > saved DB overrides > preset DB values > fallback
      const baseInflationRisk = preset
        ? {
            meanRate: toNumber(preset.inflationMean),
            stdDev: toNumber(preset.inflationStdDev),
          }
        : { meanRate: 0.025, stdDev: 0.012 };
      const effectiveInflationRisk =
        input.inflationRisk ??
        (savedInflationOverrides
          ? {
              meanRate:
                savedInflationOverrides.meanRate ?? baseInflationRisk.meanRate,
              stdDev:
                savedInflationOverrides.stdDev ?? baseInflationRisk.stdDev,
            }
          : null) ??
        baseInflationRisk;

      // Resolve return clamp bounds from preset (or defaults)
      const returnClampMin = preset ? toNumber(preset.returnClampMin) : -0.5;
      const returnClampMax = preset ? toNumber(preset.returnClampMax) : 1.0;

      // Build MC-aligned deterministic return rates using GEOMETRIC means.
      // The arithmetic mean is the expected single-year return, but deterministic compounding
      // should use the geometric mean (median compounding rate) to avoid overstating growth.
      // The MC stochastic trials naturally produce geometric compounding through randomization.
      const mcDeterministicRates: { label: string; rate: number }[] = [];
      for (
        let a = engineInput.currentAge;
        a <= engineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcDeterministicRates.push({ label: `Age ${a}`, rate: blended });
      }
      const mcEngineInput = {
        ...engineInput,
        returnRates: mcDeterministicRates,
      };

      const result = calculateMonteCarlo({
        engineInput: mcEngineInput,
        numTrials: input.numTrials,
        seed: input.seed,
        assetClasses: mcAssetClasses,
        correlations: mcCorrelations,
        glidePath: mcGlidePath,
        inflationRisk: effectiveInflationRisk,
        returnClampMin,
        returnClampMax,
      });

      // Build current glide path allocation for display (interpolate at current age)
      const currentGpEntry =
        mcGlidePath.find((gp) => gp.age >= age) ?? mcGlidePath[0];

      // Compute blended portfolio return/vol for display (geometric mean = realistic compounding rate)
      const currentAlloc = currentGpEntry?.allocations ?? {};
      const blendedReturn = mcAssetClasses.reduce((sum, ac) => {
        const w = currentAlloc[ac.id] ?? 0;
        return w > 0 ? sum + w * geometricMean(ac.meanReturn, ac.stdDev) : sum;
      }, 0);
      const blendedVol = mcAssetClasses.reduce(
        (sum, ac) => sum + ac.stdDev * (currentAlloc[ac.id] ?? 0),
        0,
      );

      // Build DB (raw) asset class values for comparison
      const dbAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn),
        stdDev: toNumber(ac.stdDev),
      }));

      return {
        result,
        simulationInputs: {
          currentAge: age,
          retirementAge: avgRetirementAge,
          endAge: maxEndAge,
          startingBalance:
            portfolioByTaxType.preTax +
            portfolioByTaxType.taxFree +
            portfolioByTaxType.hsa +
            portfolioByTaxType.afterTax,
          annualContributions:
            totalRealContrib +
            Object.values(employerMatchByCategory).reduce((s, v) => s + v, 0),
          annualExpenses: annualExpensesVal,
          inflationRate: toNumber(settings.annualInflation),
          salary: totalCompensation,
          assetClasses: mcAssetClasses,
          dbAssetClasses,
          currentAllocation: currentAlloc,
          glidePathAges: mcGlidePath.map((gp) => gp.age),
          glidePath: mcGlidePath,
          preset: input.preset,
          presetLabel: preset?.label ?? "Custom",
          presetDescription:
            preset?.description ??
            "Raw DB values — no preset adjustments applied",
          blendedReturn,
          blendedVol,
          inflationRisk: effectiveInflationRisk,
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalStrategy: settings.withdrawalStrategy ?? "fixed",
          decumulationExpenseOverride: input.decumulationExpenseOverride,
          accumulationExpenseOverride: input.accumulationExpenseOverride,
          taxMode: input.taxMode,
          hasAssetClassOverrides: effectiveAssetOverrides.length > 0,
          hasSalaryOverrides: (input.salaryOverrides ?? []).length > 0,
          correlations: mcCorrelations,
          returnClampMin,
          returnClampMax,
          returnMultiplier,
          volMultiplier,
        },
        savedOverrides: {
          assetClassOverrides: savedAssetOverrides,
          inflationOverrides: savedInflationOverrides,
        },
      };
    }),

  // --- Mutations for editing projection assumptions ---

  updateReturnRateTable: protectedProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({ age: z.number().int(), rateOfReturn: z.number() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      for (const entry of input.entries) {
        await db
          .insert(schema.returnRateTable)
          .values({ age: entry.age, rateOfReturn: String(entry.rateOfReturn) })
          .onConflictDoUpdate({
            target: schema.returnRateTable.age,
            set: { rateOfReturn: String(entry.rateOfReturn) },
          });
      }
      return { updated: input.entries.length };
    }),

  updateGlidePathAllocations: protectedProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            age: z.number().int(),
            allocations: z.record(z.string(), z.number()),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      // Delete existing custom glide path and replace
      await db.delete(schema.glidePathAllocations);
      const rows: { age: number; assetClassId: number; allocation: string }[] =
        [];
      for (const entry of input.entries) {
        for (const [idStr, alloc] of Object.entries(entry.allocations)) {
          const assetClassId = parseInt(idStr, 10);
          if (!isNaN(assetClassId)) {
            rows.push({
              age: entry.age,
              assetClassId,
              allocation: String(alloc),
            });
          }
        }
      }
      if (rows.length > 0) {
        await db.insert(schema.glidePathAllocations).values(rows);
      }
      return { updated: rows.length };
    }),

  updateClampBounds: protectedProcedure
    .input(
      z.object({
        preset: z.enum(["custom"]),
        returnClampMin: z.number(),
        returnClampMax: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      await db
        .update(schema.mcPresets)
        .set({
          returnClampMin: String(input.returnClampMin),
          returnClampMax: String(input.returnClampMax),
        })
        .where(eq(schema.mcPresets.key, input.preset));
      return { updated: true };
    }),

  /**
   * Compare all withdrawal strategies side-by-side.
   *
   * Fetches DB data once, then runs calculateProjection() for each strategy
   * varying only withdrawalStrategy + strategyParams.
   */
  computeStrategyComparison: protectedProcedure
    .input(
      z
        .object({
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          decumulationBudgetProfileId: z.number().int().optional(),
          decumulationBudgetColumn: z.number().int().min(0).optional(),
          decumulationExpenseOverride: z.number().min(0).optional(),
          accumulationBudgetProfileId: z.number().int().optional(),
          accumulationBudgetColumn: z.number().int().min(0).optional(),
          accumulationExpenseOverride: z.number().min(0).optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Load retirement data + MC config in parallel
      const [
        data,
        assetClasses,
        assetCorrelations,
        glidePathRows,
        savedInflationOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input?.snapshotId }),
        ctx.db
          .select()
          .from(schema.assetClassParams)
          .where(eq(schema.assetClassParams.isActive, true))
          .orderBy(asc(schema.assetClassParams.sortOrder)),
        ctx.db.select().from(schema.assetClassCorrelations),
        ctx.db.select().from(schema.glidePathAllocations),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
          .then((r) => r[0] ?? null),
      ]);

      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input?.salaryOverrides,
        contributionProfileId: input?.contributionProfileId,
        accumulationBudgetProfileId: input?.accumulationBudgetProfileId,
        accumulationBudgetColumn: input?.accumulationBudgetColumn,
        accumulationExpenseOverride: input?.accumulationExpenseOverride,
        decumulationBudgetProfileId: input?.decumulationBudgetProfileId,
        decumulationBudgetColumn: input?.decumulationBudgetColumn,
        decumulationExpenseOverride: input?.decumulationExpenseOverride,
      });
      if (!payload) return { strategies: [], activeStrategy: null };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        avgRetirementAge,
      } = payload;

      // Resolve effective inflation risk (same logic as computeMonteCarlo)
      const savedInflationOverrides = (savedInflationOverridesRow?.value ??
        null) as { meanRate?: number; stdDev?: number } | null;
      const baseInflationRisk = { meanRate: 0.025, stdDev: 0.012 };
      const effectiveInflationRisk = savedInflationOverrides
        ? {
            meanRate:
              savedInflationOverrides.meanRate ?? baseInflationRisk.meanRate,
            stdDev: savedInflationOverrides.stdDev ?? baseInflationRisk.stdDev,
          }
        : baseInflationRisk;

      // Build MC inputs for success rate computation (200 trials per strategy)
      const mcAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn),
        stdDev: toNumber(ac.stdDev),
      }));
      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));
      const gpByAge = new Map<number, Record<number, number>>();
      for (const gp of glidePathRows) {
        if (!gpByAge.has(gp.age)) gpByAge.set(gp.age, {});
        gpByAge.get(gp.age)![gp.assetClassId] = toNumber(gp.allocation);
      }
      const mcGlidePath = Array.from(gpByAge.entries())
        .sort(([a], [b]) => a - b)
        .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));

      // Build MC-aligned deterministic return rates using geometric means
      const mcReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= baseEngineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcReturnRates.push({ label: `Age ${a}`, rate: blended });
      }
      const mcBaseEngineInput = {
        ...baseEngineInput,
        returnRates: mcReturnRates,
      };
      const hasMcData = mcAssetClasses.length > 0 && mcGlidePath.length > 0;

      const userStrategyParams = buildStrategyParams(settings);
      const activeStrategy =
        (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed";

      const strategies = getAllStrategyKeys().map((strategyKey) => {
        const meta = getStrategyMeta(strategyKey);
        // Use user-configured params for the active strategy, defaults for others
        const params =
          strategyKey === activeStrategy
            ? userStrategyParams
            : { [strategyKey]: getStrategyDefaults(strategyKey) };

        const decumulationDefaults = {
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalRoutingMode: "bracket_filling" as const,
          withdrawalOrder: getDefaultDecumulationOrder() as AccountCategory[],
          withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS } as Record<
            AccountCategory,
            number
          >,
          withdrawalTaxPreference: {},
          distributionTaxRates,
          withdrawalStrategy: strategyKey,
          strategyParams: params,
        };

        const result = calculateProjection({
          ...baseEngineInput,
          decumulationDefaults,
          accumulationOverrides: [],
          decumulationOverrides: [],
        });

        // Extract decumulation years for year-by-year data
        const decYears = result.projectionByYear.filter(
          (y): y is Extract<typeof y, { phase: "decumulation" }> =>
            y.phase === "decumulation",
        );

        const withdrawals = decYears.map((y) => y.totalWithdrawal);
        const avgWithdrawal =
          withdrawals.length > 0
            ? withdrawals.reduce((s, w) => s + w, 0) / withdrawals.length
            : 0;

        // Run lightweight MC (200 trials) for success rate + spending stability
        let successRate: number | null = null;
        let spendingStabilityRate: number | null = null;
        let budgetStabilityRate: number | null = null;
        if (hasMcData) {
          const mcResult = calculateMonteCarlo({
            engineInput: {
              ...mcBaseEngineInput,
              decumulationDefaults,
              accumulationOverrides: [],
              decumulationOverrides: [],
            },
            numTrials: 200,
            seed: 42,
            assetClasses: mcAssetClasses,
            correlations: mcCorrelations,
            glidePath: mcGlidePath,
            inflationRisk: effectiveInflationRisk,
          });
          successRate = mcResult.successRate;
          spendingStabilityRate = mcResult.spendingStabilityRate;
          budgetStabilityRate = mcResult.budgetStabilityRate;
        }

        return {
          strategy: strategyKey,
          label: meta.label,
          shortLabel: meta.shortLabel,
          portfolioDepletionAge: result.portfolioDepletionAge,
          sustainableWithdrawal: result.sustainableWithdrawal,
          year1Withdrawal: decYears[0]?.totalWithdrawal ?? 0,
          avgAnnualWithdrawal: roundToCents(avgWithdrawal),
          minAnnualWithdrawal:
            withdrawals.length > 0 ? roundToCents(Math.min(...withdrawals)) : 0,
          maxAnnualWithdrawal:
            withdrawals.length > 0 ? roundToCents(Math.max(...withdrawals)) : 0,
          endBalance:
            decYears.length > 0 ? decYears[decYears.length - 1]!.endBalance : 0,
          legacyAmount:
            decYears.length > 0 ? decYears[decYears.length - 1]!.endBalance : 0,
          successRate,
          spendingStabilityRate,
          budgetStabilityRate,
          yearByYear: decYears.map((y) => ({
            age: y.age,
            withdrawal: roundToCents(y.totalWithdrawal),
            endBalance: roundToCents(y.endBalance),
          })),
        };
      });

      return {
        strategies,
        activeStrategy,
        retirementAge: avgRetirementAge,
      };
    }),

  /** Analyze the active strategy — run what-if MC scenarios and return ranked recommendations. */
  analyzeStrategy: protectedProcedure
    .input(
      z
        .object({
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          accumulationBudgetProfileId: z.number().int().optional(),
          accumulationBudgetColumn: z.number().int().min(0).optional(),
          accumulationExpenseOverride: z.number().min(0).optional(),
          decumulationBudgetProfileId: z.number().int().optional(),
          decumulationBudgetColumn: z.number().int().min(0).optional(),
          decumulationExpenseOverride: z.number().min(0).optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Load data (same as strategy comparison)
      const [
        data,
        assetClasses,
        assetCorrelations,
        glidePathRows,
        savedInflationOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input?.snapshotId }),
        ctx.db
          .select()
          .from(schema.assetClassParams)
          .where(eq(schema.assetClassParams.isActive, true))
          .orderBy(asc(schema.assetClassParams.sortOrder)),
        ctx.db.select().from(schema.assetClassCorrelations),
        ctx.db.select().from(schema.glidePathAllocations),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
          .then((r) => r[0] ?? null),
      ]);

      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input?.salaryOverrides,
        contributionProfileId: input?.contributionProfileId,
        accumulationBudgetProfileId: input?.accumulationBudgetProfileId,
        accumulationBudgetColumn: input?.accumulationBudgetColumn,
        accumulationExpenseOverride: input?.accumulationExpenseOverride,
        decumulationBudgetProfileId: input?.decumulationBudgetProfileId,
        decumulationBudgetColumn: input?.decumulationBudgetColumn,
        decumulationExpenseOverride: input?.decumulationExpenseOverride,
      });
      if (!payload)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
        };

      const { settings, distributionTaxRates, baseEngineInput } = payload;

      // MC infrastructure (same as strategy comparison)
      const savedInflationOverrides = (savedInflationOverridesRow?.value ??
        null) as { meanRate?: number; stdDev?: number } | null;
      const baseInflationRisk = { meanRate: 0.025, stdDev: 0.012 };
      const effectiveInflationRisk = savedInflationOverrides
        ? {
            meanRate:
              savedInflationOverrides.meanRate ?? baseInflationRisk.meanRate,
            stdDev: savedInflationOverrides.stdDev ?? baseInflationRisk.stdDev,
          }
        : baseInflationRisk;

      const mcAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn),
        stdDev: toNumber(ac.stdDev),
      }));
      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));
      const gpByAge = new Map<number, Record<number, number>>();
      for (const gp of glidePathRows) {
        if (!gpByAge.has(gp.age)) gpByAge.set(gp.age, {});
        gpByAge.get(gp.age)![gp.assetClassId] = toNumber(gp.allocation);
      }
      const mcGlidePath = Array.from(gpByAge.entries())
        .sort(([a], [b]) => a - b)
        .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));

      if (mcAssetClasses.length === 0 || mcGlidePath.length === 0)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
        };

      // Build MC return rates
      const mcReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= baseEngineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcReturnRates.push({ label: `Age ${a}`, rate: blended });
      }

      const activeStrategy =
        (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed";
      const strategyMeta = getStrategyMeta(activeStrategy);
      const userStrategyParams = buildStrategyParams(settings);
      const activeParams = userStrategyParams[activeStrategy] ?? {};

      const mcBaseEngineInput = {
        ...baseEngineInput,
        returnRates: mcReturnRates,
        accumulationOverrides: [] as [],
        decumulationOverrides: [] as [],
        decumulationDefaults: {
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalRoutingMode: "bracket_filling" as const,
          withdrawalOrder: getDefaultDecumulationOrder() as AccountCategory[],
          withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS } as Record<
            AccountCategory,
            number
          >,
          withdrawalTaxPreference: {},
          distributionTaxRates,
          withdrawalStrategy: activeStrategy,
          strategyParams: userStrategyParams,
        },
      };

      // --- Run baseline MC ---
      const baselineMc = calculateMonteCarlo({
        engineInput: mcBaseEngineInput,
        numTrials: 200,
        seed: 42,
        assetClasses: mcAssetClasses,
        correlations: mcCorrelations,
        glidePath: mcGlidePath,
        inflationRisk: effectiveInflationRisk,
      });
      const baseline = {
        successRate: baselineMc.successRate,
        stabilityRate:
          baselineMc.budgetStabilityRate ?? baselineMc.spendingStabilityRate,
      };

      // --- Diagnose ---
      type DiagnosisGoal = "survival" | "smoothness" | "healthy";
      let primaryGoal: DiagnosisGoal = "healthy";
      if (baseline.successRate < 0.9) primaryGoal = "survival";
      else if (baseline.stabilityRate < 0.5) primaryGoal = "smoothness";
      const targetMetric: "survival" | "smoothness" =
        primaryGoal === "healthy" ? "smoothness" : primaryGoal;

      // --- Select levers ---
      type Lever =
        | {
            kind: "strategyParam";
            key: string;
            label: string;
            delta: number;
            unit: "relative" | "absolute";
            currentValue: number;
          }
        | {
            kind: "global";
            field: string;
            label: string;
            delta: number;
            unit: "relative" | "absolute";
            currentValue: number;
          };

      const levers: Lever[] = [];

      // Strategy-specific levers from paramField.lever metadata
      for (const field of strategyMeta.paramFields) {
        if (!field.lever) continue;
        if (!field.lever.targets.includes(targetMetric)) continue;
        if (typeof field.default === "boolean") continue; // skip boolean params
        const currentValue =
          typeof activeParams[field.key] === "number"
            ? (activeParams[field.key] as number)
            : (field.default as number);
        levers.push({
          kind: "strategyParam",
          key: field.key,
          label: field.label,
          delta: field.lever.delta,
          unit: field.lever.unit,
          currentValue,
        });
      }

      // Universal levers
      const universalLevers: {
        field: string;
        delta: number;
        unit: "relative" | "absolute";
        targets: readonly string[];
        label: string;
        currentValue: number;
        max: number;
      }[] = [
        {
          field: "retirementAge",
          delta: 2,
          unit: "absolute",
          targets: ["survival", "smoothness"],
          label: "Retirement Age",
          currentValue: baseEngineInput.retirementAge,
          max: baseEngineInput.projectionEndAge - 5,
        },
        {
          field: "withdrawalRate",
          delta: -0.005,
          unit: "absolute",
          targets: ["survival"],
          label: "Withdrawal Rate",
          currentValue: toNumber(settings.withdrawalRate),
          max: 1,
        },
        {
          field: "ssStartAge",
          delta: 3,
          unit: "absolute",
          targets: ["survival"],
          label: "SS Start Age",
          currentValue: baseEngineInput.ssStartAge,
          max: 70,
        },
      ];
      for (const ul of universalLevers) {
        if (!ul.targets.includes(targetMetric)) continue;
        const adjusted = ul.currentValue + ul.delta;
        if (adjusted > ul.max || adjusted < 0) continue; // out of range
        levers.push({
          kind: "global",
          field: ul.field,
          label: ul.label,
          delta: ul.delta,
          unit: ul.unit,
          currentValue: ul.currentValue,
        });
      }

      // Cap at 6 scenarios
      const selectedLevers = levers.slice(0, 6);

      // --- Run what-if MC scenarios ---
      type Recommendation = {
        label: string;
        currentValue: string;
        adjustedValue: string;
        successRate: number;
        stabilityRate: number;
        successDelta: number;
        stabilityDelta: number;
      };

      const recommendations: Recommendation[] = [];
      for (const lever of selectedLevers) {
        const adjustedNum =
          lever.unit === "relative"
            ? lever.currentValue * (1 + lever.delta)
            : lever.currentValue + lever.delta;

        // Round to step size if strategy param
        let rounded = adjustedNum;
        if (lever.kind === "strategyParam") {
          const field = strategyMeta.paramFields.find(
            (f) => f.key === lever.key,
          );
          if (field?.step) {
            rounded = Math.round(adjustedNum / field.step) * field.step;
            rounded = Math.round(rounded * 10000) / 10000;
          }
        }

        // Build variant engine input
        let variantInput = { ...mcBaseEngineInput };
        if (lever.kind === "strategyParam") {
          const tweakedParams = {
            ...userStrategyParams,
            [activeStrategy]: {
              ...activeParams,
              [lever.key]: rounded,
            },
          };
          variantInput = {
            ...variantInput,
            decumulationDefaults: {
              ...variantInput.decumulationDefaults,
              strategyParams: tweakedParams,
            },
          };
        } else {
          // Global lever — modify the engine input field directly
          if (lever.field === "retirementAge") {
            variantInput = { ...variantInput, retirementAge: rounded };
          } else if (lever.field === "withdrawalRate") {
            variantInput = {
              ...variantInput,
              decumulationDefaults: {
                ...variantInput.decumulationDefaults,
                withdrawalRate: rounded,
              },
            };
          } else if (lever.field === "ssStartAge") {
            variantInput = { ...variantInput, ssStartAge: rounded };
          }
        }

        const variantMc = calculateMonteCarlo({
          engineInput: variantInput,
          numTrials: 200,
          seed: 42,
          assetClasses: mcAssetClasses,
          correlations: mcCorrelations,
          glidePath: mcGlidePath,
          inflationRisk: effectiveInflationRisk,
        });

        const variantStability =
          variantMc.budgetStabilityRate ?? variantMc.spendingStabilityRate;

        // Format display values
        const formatVal = (v: number, l: Lever) => {
          if (
            l.kind === "global" &&
            (l.field === "retirementAge" || l.field === "ssStartAge")
          )
            return String(Math.round(v));
          if (l.kind === "global" && l.field === "withdrawalRate")
            return formatPercent(v, 2);
          // Strategy param — check field type
          const field = strategyMeta.paramFields.find(
            (f) => f.key === (l as { key: string }).key,
          );
          if (field?.type === "percent") return formatPercent(v, 1);
          if (field?.type === "number") return String(Math.round(v));
          return String(v);
        };

        recommendations.push({
          label: lever.label,
          currentValue: formatVal(lever.currentValue, lever),
          adjustedValue: formatVal(rounded, lever),
          successRate: variantMc.successRate,
          stabilityRate: variantStability,
          successDelta: variantMc.successRate - baseline.successRate,
          stabilityDelta: variantStability - baseline.stabilityRate,
        });
      }

      // Rank by improvement to primary goal, filter negligible, take top 3
      const scored = recommendations
        .map((r) => ({
          ...r,
          score:
            primaryGoal === "survival"
              ? r.successDelta * 2 + r.stabilityDelta
              : r.stabilityDelta * 2 + r.successDelta,
        }))
        .filter((r) => r.score > 0.02)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ score: _score, ...rest }) => rest);

      return {
        baseline: {
          successRate: baseline.successRate,
          stabilityRate: baseline.stabilityRate,
        },
        diagnosis: primaryGoal,
        strategyLabel: strategyMeta.label,
        recommendations: scored,
      };
    }),

  updateInflationRisk: protectedProcedure
    .input(
      z.object({
        preset: z.enum(["aggressive", "default", "conservative", "custom"]),
        inflationMean: z.number(),
        inflationStdDev: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      await db
        .update(schema.mcPresets)
        .set({
          inflationMean: String(input.inflationMean),
          inflationStdDev: String(input.inflationStdDev),
        })
        .where(eq(schema.mcPresets.key, input.preset));
      return { updated: true };
    }),

  /** Persist MC asset class return/volatility overrides to appSettings. */
  updateAssetClassOverrides: protectedProcedure
    .input(
      z.array(
        z.object({
          id: z.number(),
          meanReturn: z.number().optional(),
          stdDev: z.number().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_asset_class_overrides";
      if (input.length === 0) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true, count: 0 };
      }
      await db
        .insert(schema.appSettings)
        .values({ key, value: input })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input },
        });
      return { updated: true, count: input.length };
    }),

  /** List all user-created Monte Carlo simulation presets. */
  listPresets: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.mcUserPresets)
      .orderBy(asc(schema.mcUserPresets.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      simulations: r.simulations,
      returnMean: toNumber(r.returnMean),
      returnStdDev: toNumber(r.returnStdDev),
      inflationMean: toNumber(r.inflationMean),
      inflationStdDev: toNumber(r.inflationStdDev),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }),

  /** Create a new user Monte Carlo simulation preset. */
  createPreset: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).trim(),
        simulations: z.number().int().min(100).max(100000).default(1000),
        returnMean: z.number(),
        returnStdDev: z.number().min(0),
        inflationMean: z.number(),
        inflationStdDev: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.mcUserPresets)
        .values({
          name: input.name,
          simulations: input.simulations,
          returnMean: String(input.returnMean),
          returnStdDev: String(input.returnStdDev),
          inflationMean: String(input.inflationMean),
          inflationStdDev: String(input.inflationStdDev),
        })
        .returning();
      return {
        id: row!.id,
        name: row!.name,
        simulations: row!.simulations,
        returnMean: toNumber(row!.returnMean),
        returnStdDev: toNumber(row!.returnStdDev),
        inflationMean: toNumber(row!.inflationMean),
        inflationStdDev: toNumber(row!.inflationStdDev),
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    }),

  /** Update an existing user Monte Carlo simulation preset. */
  updatePreset: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(100).trim().optional(),
        simulations: z.number().int().min(100).max(100000).optional(),
        returnMean: z.number().optional(),
        returnStdDev: z.number().min(0).optional(),
        inflationMean: z.number().optional(),
        inflationStdDev: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const setValues: Record<string, unknown> = {};
      if (fields.name !== undefined) setValues.name = fields.name;
      if (fields.simulations !== undefined)
        setValues.simulations = fields.simulations;
      if (fields.returnMean !== undefined)
        setValues.returnMean = String(fields.returnMean);
      if (fields.returnStdDev !== undefined)
        setValues.returnStdDev = String(fields.returnStdDev);
      if (fields.inflationMean !== undefined)
        setValues.inflationMean = String(fields.inflationMean);
      if (fields.inflationStdDev !== undefined)
        setValues.inflationStdDev = String(fields.inflationStdDev);
      await ctx.db
        .update(schema.mcUserPresets)
        .set(setValues)
        .where(eq(schema.mcUserPresets.id, id));
      return { updated: true };
    }),

  /** Delete a user Monte Carlo simulation preset. */
  deletePreset: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.mcUserPresets)
        .where(eq(schema.mcUserPresets.id, input.id));
      return { deleted: true };
    }),

  /** Persist MC stochastic inflation overrides to appSettings. */
  updateInflationOverrides: protectedProcedure
    .input(
      z.object({
        meanRate: z.number().optional(),
        stdDev: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_inflation_overrides";
      const isEmpty =
        input.meanRate === undefined && input.stdDev === undefined;
      if (isEmpty) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true };
      }
      await db
        .insert(schema.appSettings)
        .values({ key, value: input })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input },
        });
      return { updated: true };
    }),
});
