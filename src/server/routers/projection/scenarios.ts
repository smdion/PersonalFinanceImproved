/**
 * Scenario endpoints: unified projection + Coast FIRE calculations.
 *
 * Contains `computeProjection` (the unified contribution/distribution
 * engine), `computeCoastFire` (deterministic Coast FIRE binary search),
 * and `computeCoastFireMC` (Monte Carlo Coast FIRE validation).
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the v0.5.2
 * file-split refactor. Pure relocation — no logic changes.
 */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { DEFAULT_RETURN_RATE, DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { calculateProjection } from "@/lib/calculators/engine";
import { findCoastFireAge } from "@/lib/calculators/coast-fire";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
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
   * Coast FIRE
   *
   * Finds the earliest age at which contributions can stop and the plan
   * still funds expenses through end of plan. Uses the same engine payload
   * as computeProjection, then binary-searches candidate "coast ages" via
   * ~log₂(retirementAge - currentAge) engine runs.
   *
   * Success criterion: `portfolioDepletionAge === null` AND
   * `sustainableWithdrawal >= projectedExpenses` at the first decumulation
   * year. See `findCoastFireAge` for the full algorithm.
   */
  computeCoastFire: protectedProcedure
    .input(
      z.object({
        // Mirrors the computeProjection input subset that affects the engine.
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
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
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

      const { settings, distributionTaxRates, baseEngineInput } = payload;

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

      const result = findCoastFireAge(engineInput);

      // Deflate nominal values to today's dollars for display (matches the
      // convention in retirement-card.tsx:118-134). Sustainable withdrawal and
      // retirement-year expenses land at retirementAge; end balance lands at
      // projectionEndAge. The calculator stays pure; deflation is a display
      // concern and happens at the router boundary.
      const yearsToRetirement = Math.max(
        0,
        engineInput.retirementAge - engineInput.currentAge,
      );
      const yearsToEnd = Math.max(
        0,
        engineInput.projectionEndAge - engineInput.currentAge,
      );
      const retirementDeflator = Math.pow(
        1 + engineInput.inflationRate,
        yearsToRetirement,
      );
      const endDeflator = Math.pow(1 + engineInput.inflationRate, yearsToEnd);

      return {
        result: {
          ...result,
          sustainableWithdrawalToday:
            result.sustainableWithdrawal / retirementDeflator,
          projectedExpensesAtRetirementToday:
            result.projectedExpensesAtRetirement / retirementDeflator,
          endBalanceToday: result.endBalance / endDeflator,
        },
      };
    }),

  /**
   * Coast FIRE — Monte Carlo validation
   *
   * Finds the earliest age at which stopping contributions still produces
   * a ≥90% Monte Carlo success rate. Binary searches candidate ages in
   * [currentAge, retirementAge), running `calculateMonteCarlo` at each
   * probe with `seed: 42` (common random numbers across probes for
   * variance reduction) and a hardcoded "default" MC preset for
   * reproducibility.
   *
   * Per advisor review: monotonicity of MC success rate in coast age is
   * *approximate*, not strict (IRMAA/ACA/LTCG cliffs can break it). After
   * binary search returns `lo`, we re-probe `lo - 1` as a sanity check.
   * If the re-probe also passes, the true earliest age may be lower but
   * we return the search result honestly with a warning.
   *
   * Cost: ~5-6 probes × 1 MC run × 1000 trials ≈ 4-6s wall clock (profiled
   * 2026-04-13). Rate-limited via `expensiveRateLimitMiddleware`.
   */
  computeCoastFireMC: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.object({
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
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
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
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch the engine payload + MC-specific tables in parallel. Mirrors
      // computeMonteCarloProjection for the "default" preset only — no
      // user-adjustable preset, no asset class overrides, no inflation
      // overrides. Coast FIRE MC uses defaults for reproducibility.
      const [data, assetClasses, assetCorrelations, presetRows, presetGpRows] =
        await Promise.all([
          fetchRetirementData(ctx.db, { snapshotId: input.snapshotId }),
          ctx.db
            .select()
            .from(schema.assetClassParams)
            .where(eq(schema.assetClassParams.isActive, true))
            .orderBy(asc(schema.assetClassParams.sortOrder)),
          ctx.db.select().from(schema.assetClassCorrelations),
          ctx.db
            .select()
            .from(schema.mcPresets)
            .where(eq(schema.mcPresets.key, "default")),
          ctx.db
            .execute<{
              age: number;
              asset_class_id: number;
              allocation: string;
            }>(
              sql`SELECT gp.age, gp.asset_class_id, gp.allocation
                FROM mc_preset_glide_paths gp
                JOIN mc_presets p ON p.id = gp.preset_id
                WHERE p.key = 'default'
                ORDER BY gp.age, gp.asset_class_id`,
            )
            .then((r) => r.rows),
        ]);

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

      const { settings, distributionTaxRates, baseEngineInput } = payload;

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

      const preset = presetRows[0];
      if (!preset) {
        return {
          result: {
            coastFireAge: null,
            status: "unreachable" as const,
            successRate: 0,
            stopNowSuccessRate: 0,
            spendingStabilityRate: 0,
            confidenceThreshold: 0.9,
            probesRun: 0,
            warning: "Default MC preset not found in database.",
            mcResult: null,
          },
        };
      }

      const returnMultiplier = toNumber(preset.returnMultiplier);
      const volMultiplier = toNumber(preset.volMultiplier);
      const mcAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn) * returnMultiplier,
        stdDev: toNumber(ac.stdDev) * volMultiplier,
      }));
      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));
      const gpByAge = new Map<number, Record<number, number>>();
      for (const row of presetGpRows) {
        if (!gpByAge.has(row.age)) gpByAge.set(row.age, {});
        gpByAge.get(row.age)![row.asset_class_id] = toNumber(row.allocation);
      }
      const mcGlidePath = Array.from(gpByAge.entries())
        .sort(([a], [b]) => a - b)
        .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      const inflationRisk = {
        meanRate: toNumber(preset.inflationMean),
        stdDev: toNumber(preset.inflationStdDev),
      };

      const CONFIDENCE = 0.9;
      const NUM_TRIALS = 1000;
      const SEED = 42;

      // Probe helper: run MC with a profile switch at `coastAge` that zeros
      // contributions AND employer match from that year forward. Pre-coast
      // years use the user's actual configured plan (specs/realContribs/rate)
      // so the pre-coast-year balance accumulates normally. Shared seed
      // across probes = common random numbers = consistent variance across
      // candidate ages.
      let probesRun = 0;
      const probeMC = (coastAge: number) => {
        probesRun += 1;
        return calculateMonteCarlo({
          engineInput: {
            ...engineInput,
            profileSwitches: buildCoastFireProfileSwitches(
              engineInput,
              coastAge,
            ),
          },
          numTrials: NUM_TRIALS,
          seed: SEED,
          assetClasses: mcAssetClasses,
          correlations: mcCorrelations,
          glidePath: mcGlidePath,
          inflationRisk,
        });
      };
      const probeAt = (coastAge: number): number =>
        probeMC(coastAge).successRate;

      const passes = (rate: number): boolean => rate >= CONFIDENCE;

      // Edge case: already past retirement.
      if (engineInput.currentAge >= engineInput.retirementAge) {
        const fullResult = probeMC(engineInput.currentAge);
        return {
          result: {
            coastFireAge: engineInput.currentAge,
            status: "already_coast" as const,
            successRate: fullResult.successRate,
            stopNowSuccessRate: fullResult.successRate,
            spendingStabilityRate: fullResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: fullResult,
          },
        };
      }

      // Probe stopping today — captured for every branch so the client can
      // show "Stopping today: X% MC" alongside the found age. This is the
      // key signal: when deterministic says "already coast" but MC says
      // "need age N," the gap is quantified by stopNowResult.successRate.
      const stopNowResult = probeMC(engineInput.currentAge);
      const stopNowSuccessRate = stopNowResult.successRate;
      if (passes(stopNowSuccessRate)) {
        return {
          result: {
            coastFireAge: engineInput.currentAge,
            status: "already_coast" as const,
            successRate: stopNowSuccessRate,
            stopNowSuccessRate,
            spendingStabilityRate: stopNowResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: stopNowResult,
          },
        };
      }

      // Probe stopping the year before retirement — is the plan reachable at all?
      const maxCoastAge = engineInput.retirementAge - 1;
      const stopLateResult = probeMC(maxCoastAge);
      if (!passes(stopLateResult.successRate)) {
        return {
          result: {
            coastFireAge: null,
            status: "unreachable" as const,
            successRate: stopLateResult.successRate,
            stopNowSuccessRate,
            spendingStabilityRate: stopLateResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: stopLateResult,
          },
        };
      }

      // Binary search for earliest passing age.
      let lo = engineInput.currentAge + 1;
      let hi = maxCoastAge;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (passes(probeAt(mid))) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }

      // Boundary re-probe — non-monotonicity sanity check (advisor #2).
      // If lo - 1 also passes, monotonicity broke somewhere; surface a
      // warning so the user knows the answer may be conservative.
      let warning: string | null = null;
      if (lo - 1 >= engineInput.currentAge + 1) {
        const rePrior = probeAt(lo - 1);
        if (passes(rePrior)) {
          warning =
            "MC success rate is non-monotone near this age — the true earliest age may be lower. Likely caused by IRMAA/ACA/LTCG bracket interactions.";
        }
      }

      // One more probe at lo for the spending stability rate + full MC data
      // (chart and hero card consume the mcResult from this query).
      const finalResult = probeMC(lo);

      return {
        result: {
          coastFireAge: lo,
          status: "found" as const,
          successRate: finalResult.successRate,
          stopNowSuccessRate,
          spendingStabilityRate: finalResult.spendingStabilityRate,
          confidenceThreshold: CONFIDENCE,
          probesRun,
          warning,
          mcResult: finalResult,
        },
      };
    }),
});
