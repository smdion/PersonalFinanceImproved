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
import { createTRPCRouter } from "../../trpc";
import type { RoutingMode } from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
} from "@/lib/config/account-types";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  decumulationDefaultsInputSchema,
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

export const taxPlanningRouter = createTRPCRouter({});
