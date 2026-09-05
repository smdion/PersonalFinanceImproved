/**
 * Tax Optimization surface — router endpoints.
 *
 * Every procedure here runs the SAME `calculateProjection()` the
 * Retirement page uses, via the SAME `fetchRetirementData` /
 * `buildEnginePayload` helpers — there is no parallel year-by-year tax
 * loop (that is the banned "second computation path", `docs/RULES.md`).
 * `compareWithdrawalStrategies` and `rothConversionWhatIf` run that engine
 * N times with different `decumulationOverrides` and score the results,
 * exactly like `withdrawal-bracket-optimizer.ts` and `coast-fire.ts` do.
 * `projectTaxYears` is a single deterministic run reshaped for the IRMAA
 * callout (the page no longer renders a year-by-year table).
 *
 * Modeled on `withdrawal-bracket-optimizer.ts`: `protectedProcedure.query`,
 * synchronous, cheap, uncached — no `expensiveRateLimitMiddleware`, no
 * server-side projection cache (Coast FIRE precedent). Lives inside
 * `projection/` (not a top-level `routers/tax-optimization.ts`) because it
 * shares `fetchRetirementData` / `buildEnginePayload` / `_shared.ts`
 * schemas verbatim with the rest of this family; client calls are
 * `api.projection.projectTaxYears` etc.
 *
 * Assumptions (retirement age, inflation, withdrawal strategy, Roth
 * settings, …) are NOT inputs here — the Tax Optimization page embeds the
 * Retirement page's `AssumptionsBand`, which saves straight to the active
 * Retirement Profile, so the profile is the single source and the input
 * below only needs to say WHICH profile / budget / snapshot to read. This
 * mirrors `computeProjection`'s input (`scenarios.ts`) field-for-field.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/calculators/engine";
import { optimizeRothBracketTarget } from "@/lib/calculators/withdrawal-bracket-optimizer";
import type {
  AccumulationOverride,
  DecumulationOverride,
  RoutingMode,
} from "@/lib/calculators/types";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import { taxYearFlags } from "@/lib/pure/report/year-table";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
} from "@/lib/config/account-types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  decumulationDefaultsInputSchema,
  buildDecumulationDefaults,
} from "./_shared";

/**
 * `RoutingMode` as a Zod enum — the withdrawal-sequencing strategies the
 * comparison procedure accepts. Never `z.string()` (`docs/RULES.md`; the
 * R48-REVIEW security note calls this out specifically). The `satisfies`
 * check ties the tuple to the engine's own `RoutingMode` union so a new
 * routing mode can't be added there without this failing to compile.
 */
const ROUTING_MODES = [
  "waterfall",
  "percentage",
  "bracket_filling",
] as const satisfies readonly RoutingMode[];
// Exhaustiveness the other direction: every RoutingMode is listed above.
type _RoutingModeCovered =
  Exclude<RoutingMode, (typeof ROUTING_MODES)[number]> extends never
    ? true
    : ["RoutingMode has a value missing from ROUTING_MODES", RoutingMode];
const _routingModeCovered: _RoutingModeCovered = true;
void _routingModeCovered;

export const zRoutingMode = z.enum(ROUTING_MODES);

/**
 * The read-selection surface every Tax Optimization procedure shares — which
 * profile(s) / budget / snapshot to project. Mirrors `computeProjection`'s
 * input (`scenarios.ts:61-108`); it deliberately carries no assumption
 * values (see the file docblock).
 */
export const taxOptimizationBaseInput = z.object({
  decumulationDefaults: decumulationDefaultsInputSchema,
  accumulationOverrides: accumulationOverrideSchema,
  decumulationOverrides: decumulationOverrideSchema,
  salaryActiveFields: z
    .array(z.object({ personId: z.number(), salary: z.number() }))
    .optional(),
  contributionProfileId: z.number().int().optional(),
  /** Independent "what if I earned X" axis. */
  salaryProfileId: z.number().int().optional(),
  /** View a non-active Retirement Profile — same "view without activating"
   *  contract as `computeProjection`. */
  retirementProfileId: z.number().int().optional(),
  accumulationBudgetProfileId: z.number().int().optional(),
  accumulationBudgetColumn: z.number().int().min(0).optional(),
  accumulationExpenseOverride: z.number().min(0).optional(),
  decumulationBudgetProfileId: z.number().int().optional(),
  decumulationBudgetColumn: z.number().int().min(0).optional(),
  decumulationExpenseOverride: z.number().min(0).optional(),
  snapshotId: z.number().int().optional(),
});

/**
 * One named withdrawal-sequencing strategy for the side-by-side
 * comparison. `order` only applies when `mode === "waterfall"`.
 */
export const withdrawalStrategyChoiceSchema = z.object({
  label: z.string().min(1).max(40),
  mode: zRoutingMode,
  order: z.array(z.enum(accountCategoryEnum())).optional(),
});

/**
 * One year's Roth-conversion target for the "explicit schedule" what-if.
 * `targetRate` is a marginal-rate ceiling (0–0.5); applied sticky-forward
 * as a `decumulationOverride`.
 */
export const rothConversionTargetSchema = z.object({
  year: z.number().int().min(2024).max(2100),
  targetRate: z.number().min(0).max(0.5),
});

/** Kept exported so callers/tests can build a valid default `order`. */
export const DEFAULT_WITHDRAWAL_ORDER = getDefaultDecumulationOrder();

// ---------------------------------------------------------------------------
// Shared engine runner — the single computation path
// ---------------------------------------------------------------------------

type TaxOptimizationBaseInput = z.infer<typeof taxOptimizationBaseInput>;

/**
 * fetch → buildEnginePayload → run `calculateProjection` ONCE, with the
 * request's profile/budget selection and any client `decumulationDefaults`
 * / overrides applied. Byte-for-byte the same construction
 * `withdrawal-bracket-optimizer.ts` uses; the strategy-comparison and Roth
 * what-if procedures call this in a loop with an extra override pushed on.
 * Returns `null` when the household has no projectable data yet.
 */
async function runProjection(
  db: Parameters<typeof fetchRetirementData>[0],
  input: TaxOptimizationBaseInput,
  extraDecumulationOverrides: DecumulationOverride[] = [],
) {
  const data = await fetchRetirementData(db, {
    snapshotId: input.snapshotId,
    contributionProfileId: input.contributionProfileId,
    salaryProfileId: input.salaryProfileId,
  });
  const payload = await buildEnginePayload(db, data, {
    salaryActiveFields: input.salaryActiveFields,
    contributionProfileId: input.contributionProfileId,
    salaryProfileId: input.salaryProfileId,
    retirementProfileId: input.retirementProfileId,
    accumulationBudgetProfileId: input.accumulationBudgetProfileId,
    accumulationBudgetColumn: input.accumulationBudgetColumn,
    accumulationExpenseOverride: input.accumulationExpenseOverride,
    decumulationBudgetProfileId: input.decumulationBudgetProfileId,
    decumulationBudgetColumn: input.decumulationBudgetColumn,
    decumulationExpenseOverride: input.decumulationExpenseOverride,
  });
  if (!payload) return null;

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
    decumulationOverrides: [
      ...(input.decumulationOverrides as DecumulationOverride[]),
      ...extraDecumulationOverrides,
    ],
  };

  return {
    engineInput,
    result: calculateProjection(engineInput),
    taxDataYear: distributionTaxRates.taxDataYear,
    taxParamsVersion: distributionTaxRates.taxParamsVersion,
  };
}

/** The decumulation slice of a projection, narrowed. */
function decumulationYears(
  projectionByYear: { phase: string }[],
): EngineDecumulationYear[] {
  return projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
}

/** Lifetime tax = Σ (withdrawal tax + Roth-conversion tax + IRMAA +
 *  early-withdrawal penalty) over the decumulation horizon. Byte-for-byte
 *  `scoreCandidate` in `withdrawal-bracket-optimizer.ts`. NIIT is NOT
 *  added separately — the engine already folds it into `taxCost`
 *  (`decumulation-year.ts` does `taxCost = taxCost + niitAmount`); the
 *  earlier `+ niitAmount` here was double-counting it. */
export function lifetimeTax(years: EngineDecumulationYear[]): number {
  return years.reduce(
    (sum, y) =>
      sum +
      (y.taxCost ?? 0) +
      (y.rothConversionTaxCost ?? 0) +
      (y.irmaaCost ?? 0) +
      (y.penaltyCost ?? 0),
    0,
  );
}

// ---------------------------------------------------------------------------
// projectTaxYears — the year-by-year tax table (roadmap #4)
// ---------------------------------------------------------------------------

export type TaxYearRow = {
  year: number;
  age: number;
  /** Where the year's money comes from (nominal $). No salary/pension line
   *  — the engine models neither in decumulation. */
  income: {
    socialSecurity: number;
    traditionalWithdrawal: number;
    rothWithdrawal: number;
    otherWithdrawal: number;
    requiredMinimumDistribution: number;
    rothConversion: number;
  };
  taxableSocialSecurity: number;
  /** Federal tax on withdrawals for the year (engine's `taxCost`). */
  federalTax: number;
  niit: number;
  irmaaSurcharge: number;
  rothConversionTax: number;
  ltcgRate: number;
  effectiveTaxRate: number;
  /** Running Σ of federalTax + niit + irmaaSurcharge + rothConversionTax. */
  cumulativeTax: number;
  endingBalance: number;
  balanceByTaxType: EngineDecumulationYear["balanceByTaxType"];
  qcdAmount: number;
  rmdShortfall: number;
  rmdExcess: number;
  unmetNeed: number;
  acaSubsidyPreserved: boolean;
  acaMagiHeadroom: number;
  /** Set once Group D lands; harmless (undefined) until then. */
  rothConversionIrmaaCapped?: boolean;
  flags: string[];
};

function toTaxYearRow(
  y: EngineDecumulationYear,
  cumulativeTax: number,
): TaxYearRow {
  const otherWithdrawal = Math.max(
    0,
    y.totalWithdrawal - y.totalTraditionalWithdrawal - y.totalRothWithdrawal,
  );
  return {
    year: y.year,
    age: y.age,
    income: {
      socialSecurity: y.ssIncome,
      traditionalWithdrawal: y.totalTraditionalWithdrawal,
      rothWithdrawal: y.totalRothWithdrawal,
      otherWithdrawal,
      requiredMinimumDistribution: y.rmdAmount,
      rothConversion: y.rothConversionAmount,
    },
    taxableSocialSecurity: y.taxableSS,
    federalTax: y.taxCost,
    niit: y.niitAmount,
    irmaaSurcharge: y.irmaaCost,
    rothConversionTax: y.rothConversionTaxCost,
    ltcgRate: y.ltcgRate,
    effectiveTaxRate: y.effectiveTaxRate,
    cumulativeTax,
    endingBalance: y.endBalance,
    balanceByTaxType: y.balanceByTaxType,
    qcdAmount: y.qcdAmount,
    rmdShortfall: y.rmdShortfallAmount,
    rmdExcess: y.rmdExcessAmount,
    unmetNeed: y.unmetNeedMaterial ? (y.unmetNeed ?? 0) : 0,
    acaSubsidyPreserved: y.acaSubsidyPreserved,
    acaMagiHeadroom: y.acaMagiHeadroom,
    rothConversionIrmaaCapped: y.rothConversionIrmaaCapped,
    flags: taxYearFlags(y),
  };
}

export const taxOptimizationRouter = createTRPCRouter({
  /**
   * Year-by-year tax projection through decumulation — a straight read of
   * the deterministic engine run (NOT Monte Carlo). One row per
   * decumulation year with income sources, federal / NIIT / IRMAA tax,
   * effective rate, balances, a running lifetime-tax total, and the shared
   * "notable year" flags.
   */
  projectTaxYears: protectedProcedure
    .input(taxOptimizationBaseInput)
    .query(async ({ ctx, input }) => {
      const run = await runProjection(ctx.db, input);
      if (!run) return { rows: [] as TaxYearRow[], meta: null };

      const years = decumulationYears(run.result.projectionByYear);
      let cumulative = 0;
      const rows = years.map((y) => {
        // `y.taxCost` already includes NIIT — don't add `y.niitAmount`
        // again (that was double-counting it into the running total).
        cumulative += y.taxCost + y.irmaaCost + y.rothConversionTaxCost;
        return toTaxYearRow(y, cumulative);
      });

      return {
        rows,
        meta: {
          bracketsThroughYear: run.taxDataYear,
          taxParamsVersion: run.taxParamsVersion,
          projectedFromYear: run.result.projectionByYear[0]?.year ?? null,
          portfolioDepletionYear: run.result.portfolioDepletionYear,
        },
      };
    }),

  /**
   * Run the household's projection once per named withdrawal-sequencing
   * strategy and score each on lifetime tax — the side-by-side comparison
   * (roadmap #2). Clone-and-score, same pattern as
   * `optimizeRothBracketTarget`: a baseline run learns the first
   * decumulation year, then each strategy is one extra
   * `decumulationOverride` from that year forward.
   */
  compareWithdrawalStrategies: protectedProcedure
    .input(
      taxOptimizationBaseInput.extend({
        strategies: z.array(withdrawalStrategyChoiceSchema).min(2).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const baseline = await runProjection(ctx.db, input);
      if (!baseline) return { strategies: [], baselineLabel: null };

      const baselineDecum = decumulationYears(baseline.result.projectionByYear);
      const firstDecumYear = baselineDecum[0]?.year;
      if (firstDecumYear === undefined) {
        return { strategies: [], baselineLabel: null };
      }

      // "Your current plan" — the household's real resolved defaults
      // (buildDecumulationDefaults: session override, else
      // retirement_settings.withdrawal_routing_mode, else
      // "bracket_filling"), scored the identical way as the named
      // candidates below. `baseline` already computed this projection to
      // learn `firstDecumYear`; previously its score was thrown away and
      // the client had no way to tell which (if any) of the three fixed
      // candidates matched what the plan actually runs — matching by
      // `mode` string alone breaks the moment a household's real routing
      // is "waterfall" with a custom order that isn't one of the three
      // presets. Returning the baseline's own score sidesteps that
      // entirely: it's never a guess.
      const baselineFinalYear = baselineDecum[baselineDecum.length - 1];
      const currentPlan = {
        label: "Your current plan",
        mode: baseline.engineInput.decumulationDefaults.withdrawalRoutingMode,
        isCurrentPlan: true as const,
        lifetimeTax: lifetimeTax(baselineDecum),
        terminalByTaxType: baselineFinalYear?.balanceByTaxType ?? null,
        depletedYear: baseline.result.portfolioDepletionYear ?? null,
      };

      const scored = [];
      for (const strategy of input.strategies) {
        const override: DecumulationOverride = {
          year: firstDecumYear,
          withdrawalRoutingMode: strategy.mode,
          ...(strategy.mode === "waterfall" && strategy.order
            ? { withdrawalOrder: strategy.order }
            : {}),
        } as DecumulationOverride;

        const run = await runProjection(ctx.db, input, [override]);
        const years = run ? decumulationYears(run.result.projectionByYear) : [];
        const finalYear = years[years.length - 1];
        scored.push({
          label: strategy.label,
          mode: strategy.mode,
          lifetimeTax: lifetimeTax(years),
          terminalByTaxType: finalYear?.balanceByTaxType ?? null,
          depletedYear: run?.result.portfolioDepletionYear ?? null,
        });
      }

      // The cheapest lifetime tax among non-depleting strategies (any
      // strategy — fall back to overall cheapest if all deplete). Includes
      // "Your current plan" in the ranking — it's a real, comparably-scored
      // candidate, not just a reference row.
      const allScored = [currentPlan, ...scored];
      const viable = allScored.filter((s) => s.depletedYear === null);
      const ranked = (viable.length ? viable : allScored)
        .slice()
        .sort((a, b) => a.lifetimeTax - b.lifetimeTax);

      return {
        strategies: allScored,
        baselineLabel: ranked[0]?.label ?? null,
      };
    }),

  /**
   * Roth conversion what-if (roadmap #1). Two modes in one procedure:
   *
   * - `optimize` → delegates to the already-shipped
   *   `optimizeRothBracketTarget` (the multi-year clone-and-score search
   *   over the household's real marginal brackets). Not re-implemented.
   * - `explicit` → applies the caller's per-year `targetRate` schedule as
   *   sticky-forward `decumulationOverrides`, runs the engine once, and
   *   also runs a baseline with conversions switched off, then returns the
   *   before/after: per-year conversion + tax now, RMD reduction, IRMAA
   *   delta, and the first year cumulative tax-with-conversions drops
   *   below cumulative tax-without (`breakEvenYear`).
   */
  rothConversionWhatIf: protectedProcedure
    .input(
      z.discriminatedUnion("mode", [
        taxOptimizationBaseInput.extend({ mode: z.literal("optimize") }),
        taxOptimizationBaseInput.extend({
          mode: z.literal("explicit"),
          conversionTargets: z.array(rothConversionTargetSchema).min(1).max(60),
        }),
      ]),
    )
    .query(async ({ ctx, input }) => {
      const run = await runProjection(ctx.db, input);
      if (!run) return { mode: input.mode, result: null };

      if (input.mode === "optimize") {
        return {
          mode: "optimize" as const,
          result: optimizeRothBracketTarget(run.engineInput),
        };
      }

      const baselineDecum = decumulationYears(run.result.projectionByYear);
      const firstDecumYear = baselineDecum[0]?.year;
      if (firstDecumYear === undefined) {
        return { mode: "explicit" as const, result: null };
      }

      // WITH the caller's schedule: one sticky-forward override per target.
      const withOverrides: DecumulationOverride[] = input.conversionTargets.map(
        (t) =>
          ({
            year: t.year,
            rothConversionTarget: t.targetRate,
          }) as DecumulationOverride,
      );
      // WITHOUT conversions: a single override from the first decum year
      // capping the conversion target at 0 (convert up to a 0% marginal
      // rate = nothing).
      const offOverride = [
        {
          year: firstDecumYear,
          rothConversionTarget: 0,
        } as DecumulationOverride,
      ];

      const [withRun, offRun] = await Promise.all([
        runProjection(ctx.db, input, withOverrides),
        runProjection(ctx.db, input, offOverride),
      ]);
      const withYears = withRun
        ? decumulationYears(withRun.result.projectionByYear)
        : [];
      const offYears = offRun
        ? decumulationYears(offRun.result.projectionByYear)
        : [];
      const offByYear = new Map(offYears.map((y) => [y.year, y]));

      let cumWith = 0;
      let cumOff = 0;
      let breakEvenYear: number | null = null;
      const perYear = withYears.map((y) => {
        const off = offByYear.get(y.year);
        // `taxCost` already includes NIIT — see the projectTaxYears loop.
        cumWith += y.taxCost + y.irmaaCost + y.rothConversionTaxCost;
        cumOff += off
          ? off.taxCost + off.irmaaCost + off.rothConversionTaxCost
          : 0;
        if (breakEvenYear === null && cumWith < cumOff) breakEvenYear = y.year;
        return {
          year: y.year,
          age: y.age,
          conversionAmount: y.rothConversionAmount,
          conversionTaxNow: y.rothConversionTaxCost,
          rmdWith: y.rmdAmount,
          rmdOff: off?.rmdAmount ?? 0,
          rmdReduction: (off?.rmdAmount ?? 0) - y.rmdAmount,
          irmaaWith: y.irmaaCost,
          irmaaOff: off?.irmaaCost ?? 0,
          cumulativeTaxWith: cumWith,
          cumulativeTaxWithout: cumOff,
        };
      });

      return {
        mode: "explicit" as const,
        result: {
          perYear,
          breakEvenYear,
          lifetimeTaxWith: lifetimeTax(withYears),
          lifetimeTaxWithout: lifetimeTax(offYears),
        },
      };
    }),
});
