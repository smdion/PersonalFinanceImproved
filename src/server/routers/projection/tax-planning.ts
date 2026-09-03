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
 */
import { createTRPCRouter } from "../../trpc";

export const taxPlanningRouter = createTRPCRouter({});
