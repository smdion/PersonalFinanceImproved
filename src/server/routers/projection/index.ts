/**
 * Projection router for long-term financial forecasting.
 *
 * This file is a pure `mergeRouters` composition — all endpoint bodies live
 * in the sibling sub-router files, one per endpoint family:
 *
 * - `scenarios.ts`    — `computeProjection`
 * - `coast-fire.ts`   — `computeCoastFire`, `computeCoastFireMC`
 * - `monte-carlo.ts`  — `computeMonteCarloProjection`, `updateReturnRateTable`,
 *                       `updateGlidePathAllocations`, `updateClampBounds`
 * - `strategy.ts`     — `computeStrategyComparison`, `analyzeStrategy`,
 *                       `updateInflationRisk`, `updateAssetClassOverrides`
 * - `stress-test.ts`  — `computeStressTest`
 * - `presets.ts`      — `listPresets`, `createPreset`, `updatePreset`,
 *                       `deletePreset`, `updateInflationOverrides`
 * - `relocation.ts`   — `computeRelocationFiProjection`
 * - `withdrawal-bracket-optimizer.ts` — `computeWithdrawalBracketOptimizer`
 * - `coast-fire-probe.ts` — `computeCoastFireProbe`
 *
 * Shared Zod schemas + helper builders live in `_shared.ts`.
 *
 * `coast-fire.ts` is split from `scenarios.ts` to keep files under ~500
 * lines. `withdrawal-bracket-optimizer.ts` (multi-year withdrawal-policy
 * optimizer) is its own file for the same reason, not appended to the
 * already-large `coast-fire.ts`. `coast-fire-probe.ts` (Coast FIRE
 * custom-age picker) is separate for the same reason again, AND because
 * its result shape genuinely differs from `computeCoastFireMC`'s (see
 * that file's own docblock).
 */
import { mergeRouters } from "../../trpc";
import { coastFireRouter } from "./coast-fire";
import { coastFireProbeRouter } from "./coast-fire-probe";
import { monteCarloRouter } from "./monte-carlo";
import { presetsRouter } from "./presets";
import { relocationProjectionRouter } from "./relocation";
import { scenariosRouter } from "./scenarios";
import { strategyRouter } from "./strategy";
import { stressTestRouter } from "./stress-test";
import { withdrawalBracketOptimizerRouter } from "./withdrawal-bracket-optimizer";

export const projectionRouter = mergeRouters(
  scenariosRouter,
  coastFireRouter,
  coastFireProbeRouter,
  monteCarloRouter,
  strategyRouter,
  stressTestRouter,
  presetsRouter,
  relocationProjectionRouter,
  withdrawalBracketOptimizerRouter,
);
