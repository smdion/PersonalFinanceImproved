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
 *
 * Shared Zod schemas + helper builders live in `_shared.ts`.
 *
 * This final shape landed in PR 2b of the v0.5.2 file-split refactor
 * (see `.scratch/docs/V052-REFACTOR-PLAN.md`). `coast-fire.ts` was split
 * from `scenarios.ts` in v0.5.3 to bring files under ~500 lines.
 * `withdrawal-bracket-optimizer.ts` added 2026-08-29 (multi-year
 * withdrawal-policy optimizer, Phase 3) as its own file for the same
 * reason, not appended to the already-521-line `coast-fire.ts`.
 */
import { mergeRouters } from "../../trpc";
import { coastFireRouter } from "./coast-fire";
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
  monteCarloRouter,
  strategyRouter,
  stressTestRouter,
  presetsRouter,
  relocationProjectionRouter,
  withdrawalBracketOptimizerRouter,
);
