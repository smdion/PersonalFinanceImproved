/**
 * Tax Optimization endpoints: each runs the same `calculateProjection()` as the Retirement
 * page (no second computation path). Assumptions come from the active Retirement Profile.
 */
import { withControlledOverrides } from "@/lib/pure/contributions/controlled-overrides";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/pure/engine";
import { optimizeRothBracketTarget } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import { firstBreakEvenYear } from "@/lib/pure/retirement/conversion-break-even";
import type {
  DecumulationOverride,
  RoutingMode,
} from "@/lib/pure/engine/types";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import { taxYearFlags } from "@/lib/pure/advice/report/year-table";
import { accountCategoryEnum } from "@/lib/config/account-types";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

/**
 * `RoutingMode` as a Zod enum (never `z.string()`, `docs/RULES.md`); `satisfies`
 * ties the tuple to the engine's `RoutingMode` union.
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

const zRoutingMode = z.enum(ROUTING_MODES);

/**
 * Which profile(s) / budget / snapshot to project, mirroring `computeProjection`'s
 * input; carries no assumption values.
 */
const taxOptimizationBaseInput = z.strictObject({
  decumulationDefaults: decumulationDefaultsInputSchema,
  accumulationOverrides: accumulationOverrideSchema,
  decumulationOverrides: decumulationOverrideSchema,
  selection: profileSelectionSchema.optional(),
  snapshotId: z.number().int().optional(),
});

/**
 * One named withdrawal-sequencing strategy for the side-by-side
 * comparison. `order` only applies when `mode === "waterfall"`.
 */
const withdrawalStrategyChoiceSchema = z.object({
  label: z.string().min(1).max(40),
  mode: zRoutingMode,
  order: z.array(z.enum(accountCategoryEnum())).optional(),
});

/**
 * One year's Roth-conversion target for the "explicit schedule" what-if.
 * `targetRate` is a marginal-rate ceiling (0–0.5); applied sticky-forward
 * as a `decumulationOverride`.
 */
const rothConversionTargetSchema = z.object({
  year: z.number().int().min(2024).max(2100),
  targetRate: z.number().min(0).max(0.5),
});

// ---------------------------------------------------------------------------
// Shared engine runner — the single computation path
// ---------------------------------------------------------------------------

type TaxOptimizationBaseInput = z.infer<typeof taxOptimizationBaseInput>;

/**
 * Runs `calculateProjection` once with the request's selection and overrides applied.
 * Returns `null` when the household has no projectable data yet, and the
 * not-configured reason when no return rate covers its current age.
 */
async function runProjection(
  ctx: Parameters<typeof prepareProjectionRun>[0],
  input: TaxOptimizationBaseInput,
  extraDecumulationOverrides: DecumulationOverride[] = [],
) {
  const { payload } = await prepareProjectionRun(ctx, {
    selection: input.selection,
    snapshotId: input.snapshotId,
  });
  if (!payload) return null;
  if (payload.notConfigured) return payload.notConfigured;

  const { distributionTaxRates } = payload;
  const resolved = await prepareEngineInput(ctx.db, payload, input);
  const engineInput = {
    ...resolved,
    // The what-if's fields win over the saved rows' (a saved later-year
    // row must not quietly undo the comparison).
    decumulationOverrides: withControlledOverrides(
      resolved.decumulationOverrides,
      extraDecumulationOverrides,
    ),
  };

  return {
    engineInput,
    result: calculateProjection(engineInput),
    taxDataYear: distributionTaxRates.taxDataYear,
    // The brackets' own year (they can be older than the limits year).
    taxBracketsYear: distributionTaxRates.taxBracketsYear,
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

/** Lifetime tax = Σ (withdrawal tax + Roth-conversion tax + IRMAA + early-withdrawal
 *  penalty) over decumulation, as `scoreCandidate` in `withdrawal-bracket-optimizer.ts`.
 *  NIIT is not added: the engine already folds it into `taxCost`. */
function lifetimeTax(years: EngineDecumulationYear[]): number {
  return years.reduce(
    (sum, y) =>
      sum +
      y.taxCost +
      y.rothConversionTaxCost +
      y.irmaaCost +
      (y.penaltyCost ?? 0),
    0,
  );
}

// ---------------------------------------------------------------------------
// computeTaxProjection — the year-by-year tax table (roadmap #4)
// ---------------------------------------------------------------------------

type TaxYearRow = {
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
  retirementBalance: number;
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
    retirementBalance: y.retirementBalance,
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
   * Year-by-year tax projection through decumulation from one deterministic run:
   * income sources, taxes, effective rate, balances, running lifetime tax and flags.
   */
  computeTaxProjection: protectedProcedure
    .input(taxOptimizationBaseInput)
    .query(async ({ ctx, input }) => {
      const run = await runProjection(ctx, input);
      if (!run) return { rows: [] as TaxYearRow[], meta: null };
      if (typeof run === "string")
        return {
          rows: [] as TaxYearRow[],
          meta: null,
          notConfigured: run,
        };

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
          bracketsThroughYear: run.taxBracketsYear,
          taxParamsVersion: run.taxParamsVersion,
          projectedFromYear: run.result.projectionByYear[0]?.year ?? null,
          retirementDepletionYear: run.result.retirementDepletionYear,
        },
      };
    }),

  /**
   * Scores the household's projection on lifetime tax once per withdrawal strategy;
   * each strategy is one extra `decumulationOverride` from the first decumulation year.
   */
  computeWithdrawalStrategyComparison: protectedProcedure
    .input(
      taxOptimizationBaseInput.extend({
        strategies: z.array(withdrawalStrategyChoiceSchema).min(2).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const baseline = await runProjection(ctx, input);
      if (!baseline) return { strategies: [], baselineLabel: null };
      if (typeof baseline === "string")
        return {
          strategies: [],
          baselineLabel: null,
          notConfigured: baseline,
        };

      const baselineDecum = decumulationYears(baseline.result.projectionByYear);
      const firstDecumYear = baselineDecum[0]?.year;
      if (firstDecumYear === undefined) {
        return { strategies: [], baselineLabel: null };
      }

      // "Your current settings": the household's real resolved defaults, scored like the
      // candidates below, so the client never has to guess which preset matches the plan.
      const baselineFinalYear = baselineDecum[baselineDecum.length - 1];
      const currentPlan = {
        label: "Your current settings",
        mode: baseline.engineInput.decumulationDefaults.withdrawalRoutingMode,
        // Matching a waterfall preset needs the resolved order as well as `mode`.
        withdrawalOrder: baseline.engineInput.decumulationDefaults
          .withdrawalOrder as string[],
        isCurrentPlan: true as const,
        lifetimeTax: lifetimeTax(baselineDecum),
        terminalByTaxType: baselineFinalYear?.balanceByTaxType ?? null,
        failureYear: assessPlan(baseline.result).failureYear,
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

        const out = await runProjection(ctx, input, [override]);
        const run = typeof out === "string" ? null : out;
        const years = run ? decumulationYears(run.result.projectionByYear) : [];
        const finalYear = years[years.length - 1];
        scored.push({
          label: strategy.label,
          mode: strategy.mode,
          lifetimeTax: lifetimeTax(years),
          terminalByTaxType: finalYear?.balanceByTaxType ?? null,
          failureYear: run ? assessPlan(run.result).failureYear : null,
        });
      }

      // Cheapest lifetime tax among strategies whose plan holds (else overall cheapest),
      // with "Your current settings" ranked as a real candidate.
      const allScored = [currentPlan, ...scored];
      const viable = allScored.filter((s) => s.failureYear === null);
      const ranked = (viable.length ? viable : allScored)
        .slice()
        .sort((a, b) => a.lifetimeTax - b.lifetimeTax);

      return {
        strategies: allScored,
        baselineLabel: ranked[0]?.label ?? null,
      };
    }),

  /**
   * Roth conversion what-if: `optimize` delegates to `optimizeRothBracketTarget`;
   * `explicit` applies a per-year `targetRate` schedule and compares it with a
   * no-conversion baseline (tax now, RMD reduction, IRMAA delta, `breakEvenYear`).
   */
  computeRothConversionWhatIf: protectedProcedure
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
      const run = await runProjection(ctx, input);
      if (!run) return { mode: input.mode, result: null };
      if (typeof run === "string")
        return {
          mode: input.mode,
          result: null,
          notConfigured: run,
        };

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
        runProjection(ctx, input, withOverrides),
        runProjection(ctx, input, offOverride),
      ]);
      const withYears =
        withRun && typeof withRun !== "string"
          ? decumulationYears(withRun.result.projectionByYear)
          : [];
      const offYears =
        offRun && typeof offRun !== "string"
          ? decumulationYears(offRun.result.projectionByYear)
          : [];
      const offByYear = new Map(offYears.map((y) => [y.year, y]));

      let cumWith = 0;
      let cumOff = 0;
      const perYear = withYears.map((y) => {
        const off = offByYear.get(y.year);
        // `taxCost` already includes NIIT — see the computeTaxProjection loop.
        cumWith += y.taxCost + y.irmaaCost + y.rothConversionTaxCost;
        cumOff += off
          ? off.taxCost + off.irmaaCost + off.rothConversionTaxCost
          : 0;
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
          breakEvenYear: firstBreakEvenYear(perYear),
          lifetimeTaxWith: lifetimeTax(withYears),
          lifetimeTaxWithout: lifetimeTax(offYears),
        },
      };
    }),
});
