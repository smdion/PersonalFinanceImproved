/**
 * Scenario endpoints: unified projection engine.
 *
 * Contains `computeProjection` (the unified contribution/distribution
 * engine). Coast FIRE endpoints (`computeCoastFire`, `computeCoastFireMC`)
 * live in the sibling `coast-fire.ts` file.
 */
import { calendarYear } from "@/lib/utils/date";
import { jobYearsNote } from "@/lib/pure/household/profiles";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
import { calculateProjection } from "@/lib/pure/engine";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import { buildAccumulationOrder } from "@/lib/pure/contributions/accumulation-order";
import {
  computeCurrentStockAllocationPercent,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import { buildContributionDisplaySpecs } from "@/lib/pure/contributions/display-specs";
import { toNumber } from "@/lib/utils/numbers";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import {
  getAllCategories,
  categoriesWithTaxPreference,
} from "@/lib/config/account-types";
import { portfolioTaxTypeOf } from "@/lib/config/tax-treatment-buckets";
import {
  strategyParamFields,
  type StrategyParamColumn,
} from "@/lib/config/withdrawal-strategies";
import { roundToCents, sumBy } from "@/lib/utils/math";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  buildCoastFireProfileSwitches,
  resolveProjectionOverrides,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

/** A settings row's strategy param columns, as stored. */
function pickStrategyParamColumns<
  T extends Partial<Record<StrategyParamColumn, unknown>>,
>(row: T): Pick<T, StrategyParamColumn> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the keys are exactly the param columns
  return Object.fromEntries(
    strategyParamFields().map((f) => [f.column, row[f.column]]),
  ) as Pick<T, StrategyParamColumn>;
}

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
      z.strictObject({
        // Accumulation defaults are derived from paycheck/contribution accounts on the server.
        // No client-side accumulation defaults input.

        // --- Decumulation defaults ---
        decumulationDefaults: decumulationDefaultsInputSchema,

        // --- Accumulation overrides ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides ---
        decumulationOverrides: decumulationOverrideSchema,

        selection: profileSelectionSchema.optional(),
        /** When true, skip the heavy projection calculation and return only metadata (settings, expenses, budget profiles). */
        metadataOnly: z.boolean().default(false),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
        /** When set, apply a Coast FIRE scenario override: zero all contributions
         *  starting at this age. Replaces user-authored accumulation overrides
         *  for this query — Coast FIRE is a pure "stop contributing" scenario.
         *  Decumulation overrides are preserved. */
        coastFireOverrideAge: z.number().int().min(18).max(120).optional(),
        /** Bypass the projection cache and force a fresh compute — the
         *  explicit "Run Simulation" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, payload } = await prepareProjectionRun(ctx.db, {
        selection: input.selection,
        snapshotId: input.snapshotId,
      });
      if (!payload) return { result: null };
      // No return rate: a state, not an engine throw. Metadata (settings,
      // budgets) needs no rate, so a metadataOnly read still gets it.
      if (payload.notConfigured && !input.metadataOnly)
        return { result: null, notConfigured: payload.notConfigured };

      const {
        primaryPerson,
        settings,
        filingStatus,
        people,
        activeJobs,
        activeContribs,
        jobSalaries,
        age,
        planRetirementAge,
        planEndAge,
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
        irsGroupLimits,
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
      let result: ReturnType<typeof calculateProjection> | null = null;
      if (!input.metadataOnly) {
        const engineInput = {
          ...baseEngineInput,
          profileSwitches: profileSwitchesForEngine,
          decumulationDefaults: buildDecumulationDefaults(
            settings,
            input.decumulationDefaults,
            distributionTaxRates,
          ),
          // Omitted "Changes by year" = the household's saved rows.
          ...((await resolveProjectionOverrides(ctx.db, input)) as {
            accumulationOverrides: AccumulationOverride[];
            decumulationOverrides: DecumulationOverride[];
          }),
        };
        const inputHash = hashEngineInput("deterministic", engineInput);

        const cached = input.forceRefresh
          ? null
          : await readProjectionCache<ReturnType<typeof calculateProjection>>(
              ctx.db,
              inputHash,
            );
        if (cached) {
          result = cached.result;
        } else {
          result = calculateProjection(engineInput);
          await writeProjectionCache(ctx.db, inputHash, result, null);
        }
      }

      if (result && routerWarnings.length > 0) {
        result.warnings.unshift(...routerWarnings);
      }
      if (result && noContribData) {
        result.warnings.push(
          "No contribution accounts found — projections may be inaccurate. Add contribution accounts on the Paycheck page.",
        );
      }

      // Plan health inputs — derived inputs
      // the PlanHealthCard needs for contribution-order and glide-path
      // warnings. Implementation lives in accumulation-order.ts and projection-run.ts.
      const accumulationOrder = buildAccumulationOrder(activeContribs);
      const currentStockAllocationPercent =
        computeCurrentStockAllocationPercent(data, age);
      // portfolioAccountLabel wants id → name, for the contributionSpecs
      // perf-account-label fallback below.
      const nameMap = new Map(people.map((p) => [p.id, p.name] as const));

      return {
        result,
        /** Job start/end dates the projection counts in whole years. */
        jobYearsNote: jobYearsNote(
          baseEngineInput.workingYearsByPerson ?? {},
          (id) => nameMap.get(id) ?? "",
        ),
        planHealth: {
          currentAge: age,
          accumulationOrder,
          currentStockAllocationPercent,
        },
        combinedSalary: roundToCents(totalCompensation),
        /** Each limit group's household limit, shared limits counted once. */
        irsGroupLimits,
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
        ).map(({ id, personId, ...rest }) => {
          // Add parentCategory from the linked performance account.
          // Looked up by the source row's stable id — personId/ownerName
          // can't disambiguate between multiple joint contributions in the
          // same category, since both are null for every joint row.
          const contrib = activeContribs.find((c) => c.id === id);
          const parentCategory =
            contrib?.parentCategory ??
            (contrib?.performanceAccountId
              ? perfCategoryMap.get(contrib.performanceAccountId)
              : undefined);
          // Match to portfolio account display name using same cascade as engine
          const matchTaxType =
            portfolioTaxTypeOf(rest.taxTreatment) ?? rest.taxTreatment;
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
          // Fallback: use linked performance account's display name,
          // routed through the shared precedence rule (portfolio-labels.ts)
          // so THIS contribution row's own real owner (personId) wins over
          // perfAcct's own ownershipType — a shared, jointly-tracked master
          // (e.g. one Vanguard IRA both spouses contribute to separately)
          // has ownershipType "joint", which would otherwise render "Joint
          // ..." for every such row instead of each person's own name.
          const perfAcct = contrib?.performanceAccountId
            ? perfAccountMap.get(contrib.performanceAccountId)
            : undefined;
          const perfFallback = perfAcct
            ? portfolioAccountLabel(perfAcct, perfAcct, personId, nameMap)
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
          birthYear: calendarYear(p.dateOfBirth),
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
          const accRates = schedule.filter((r) => r.age <= planRetirementAge);
          return {
            currentRate: schedule[0]?.rate ?? null,
            retirementRate:
              schedule.find((r) => r.age === planRetirementAge)?.rate ?? null,
            postRetirementRate:
              schedule.find((r) => r.age === planRetirementAge + 1)?.rate ??
              null,
            avgAccumulation:
              accRates.length > 0
                ? sumBy(accRates, (r) => r.rate) / accRates.length
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
          salaryProfileId: o.salaryProfileId ?? null,
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
          // The plan's ages, on the same scale as each row's age. Not anyone's
          // setting: a save sends back ownRetirementAge / ownEndAge.
          retirementAge: planRetirementAge,
          endAge: planEndAge,
          retirementYear: baseEngineInput.retirementYear,
          ownRetirementAge: settings.retirementAge,
          ownEndAge: settings.endAge,
          annualInflation: settings.annualInflation,
          postRetirementInflation: settings.postRetirementInflation,
          salaryAnnualIncrease: settings.salaryAnnualIncrease,
          // From app_settings["brokerage_contribution_increase"], resolved
          // into the engine payload — surfaced so the assumptions report can
          // state it (it compounds into projected brokerage balance). Read
          // from the server-resolved payload, never recomputed client-side.
          brokerageContributionIncrease:
            baseEngineInput.brokerageContributionRamp ?? 0,
          personId: settings.personId,
          // Retirement Profiles phase 4 (the assumptions band) — client
          // writes must scope back to the profile these values came from,
          // not the household's globally-active one. See
          // buildSettingsPatch/retirementSettings.upsert's docblocks.
          profileId: settings.profileId,
          returnAfterRetirement: settings.returnAfterRetirement,
          salaryCap: settings.salaryCap,
          withdrawalRate: settings.withdrawalRate,
          taxMultiplier: settings.taxMultiplier,
          grossUpForTaxes: settings.grossUpForTaxes,
          rothBracketTarget: settings.rothBracketTarget,
          enableRothConversions: settings.enableRothConversions,
          rothConversionTarget: settings.rothConversionTarget,
          withdrawalStrategy: settings.withdrawalStrategy,
          discretionaryWithdrawalOrder: settings.discretionaryWithdrawalOrder,
          withdrawalRoutingMode: settings.withdrawalRoutingMode,
          withdrawalOrder: settings.withdrawalOrder,
          withdrawalSplits: settings.withdrawalSplits,
          ...pickStrategyParamColumns(settings),
          rmdExcessHandling: settings.rmdExcessHandling,
          rmdExcessTargetPerformanceAccountId:
            settings.rmdExcessTargetPerformanceAccountId,
          qcdMaximize: settings.qcdMaximize,
          rmdSmoothingEnabled: settings.rmdSmoothingEnabled,
          rmdSmoothingMaxBracketTarget: settings.rmdSmoothingMaxBracketTarget,
          socialSecurityMonthly: settings.socialSecurityMonthly,
          ssStartAge: settings.ssStartAge,
          enableIrmaaAwareness: settings.enableIrmaaAwareness,
          irmaaOnTopOfBudget: settings.irmaaOnTopOfBudget,
          gapYearStopSaving: settings.gapYearStopSaving,
          gapYearDraws: settings.gapYearDraws,
          enableAcaAwareness: settings.enableAcaAwareness,
          householdSize: settings.householdSize,
          filingStatus,
          filingStatusExplicit: settings.filingStatus ?? null,
          standardDeduction: distributionTaxRates.standardDeduction ?? null,
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
