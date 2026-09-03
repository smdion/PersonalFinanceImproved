/**
 * Tax Planning surface — router endpoints.
 *
 * Presentation-only. Every procedure here runs the SAME
 * `calculateProjection()` the Retirement page uses, via the SAME
 * `fetchRetirementData` / `buildEnginePayload` helpers — there is no
 * parallel year-by-year tax loop (that is the banned "second computation
 * path", `docs/RULES.md`). The multi-strategy and Roth what-if procedures
 * run that engine N times with different `decumulationOverrides` and score
 * the results, exactly like `withdrawal-bracket-optimizer.ts` and
 * `coast-fire.ts` already do.
 *
 * Modeled on `withdrawal-bracket-optimizer.ts`: `protectedProcedure.query`,
 * synchronous, cheap, uncached — no `expensiveRateLimitMiddleware`, no
 * server-side projection cache (Coast FIRE precedent). Lives inside
 * `projection/` (not a top-level `routers/tax-planning.ts`) because it
 * shares `fetchRetirementData` / `buildEnginePayload` / `_shared.ts`
 * schemas verbatim with the rest of this family; client calls are
 * `api.projection.projectTaxYears` etc.
 *
 * Assumptions (retirement age, inflation, withdrawal strategy, Roth
 * settings, …) are NOT inputs here — the Tax Planning page edits the
 * active Retirement Profile through the Retirement page's own components
 * and save mutations, so the profile is the single source and the input
 * below only needs to say WHICH profile / budget / snapshot to read. This
 * mirrors `computeProjection`'s input (`scenarios.ts`) field-for-field.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/calculators/engine";
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
 * The read-selection surface every Tax Planning procedure shares — which
 * profile(s) / budget / snapshot to project. Mirrors `computeProjection`'s
 * input (`scenarios.ts:61-108`); it deliberately carries no assumption
 * values (see the file docblock).
 */
export const taxPlanningBaseInput = z.object({
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

type TaxPlanningBaseInput = z.infer<typeof taxPlanningBaseInput>;

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
  input: TaxPlanningBaseInput,
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

/** Lifetime tax = Σ (withdrawal tax + Roth-conversion tax + IRMAA + NIIT +
 *  early-withdrawal penalty) over the decumulation horizon. Mirrors
 *  `scoreCandidate` in `withdrawal-bracket-optimizer.ts`, plus `niitAmount`
 *  (that scorer predates the NIIT field). */
export function lifetimeTax(years: EngineDecumulationYear[]): number {
  return years.reduce(
    (sum, y) =>
      sum +
      (y.taxCost ?? 0) +
      (y.rothConversionTaxCost ?? 0) +
      (y.irmaaCost ?? 0) +
      (y.niitAmount ?? 0) +
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
    rothConversionIrmaaCapped: (
      y as EngineDecumulationYear & { rothConversionIrmaaCapped?: boolean }
    ).rothConversionIrmaaCapped,
    flags: taxYearFlags(y),
  };
}

export const taxPlanningRouter = createTRPCRouter({
  /**
   * Year-by-year tax projection through decumulation — a straight read of
   * the deterministic engine run (NOT Monte Carlo). One row per
   * decumulation year with income sources, federal / NIIT / IRMAA tax,
   * effective rate, balances, a running lifetime-tax total, and the shared
   * "notable year" flags.
   */
  projectTaxYears: protectedProcedure
    .input(taxPlanningBaseInput)
    .query(async ({ ctx, input }) => {
      const run = await runProjection(ctx.db, input);
      if (!run) return { rows: [] as TaxYearRow[], meta: null };

      const years = decumulationYears(run.result.projectionByYear);
      let cumulative = 0;
      const rows = years.map((y) => {
        cumulative +=
          y.taxCost + y.niitAmount + y.irmaaCost + y.rothConversionTaxCost;
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
});
