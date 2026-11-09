/**
 * Projection router: a pure `mergeRouters` composition of the sibling sub-router files,
 * one per endpoint family (each kept under ~500 lines). Shared schemas live in `_shared.ts`.
 */
import { mergeRouters } from "../../trpc";
import { coastFireRouter } from "./coast-fire";
import { coastFireProbeRouter } from "./coast-fire-probe";
import { monteCarloRouter } from "./monte-carlo";
import { monteCarloPeekRouter } from "./monte-carlo-peek";
import { presetsRouter } from "./presets";
import { projectionMetadataRouter } from "./metadata";
import { relocationProjectionRouter } from "./relocation";
import { scenariosRouter } from "./scenarios";
import { socialSecurityRouter } from "./social-security";
import { strategyRouter } from "./strategy";
import { stressTestRouter } from "./stress-test";
import { taxOptimizationRouter } from "./tax-optimization";
import { withdrawalBracketOptimizerRouter } from "./withdrawal-bracket-optimizer";

export const projectionRouter = mergeRouters(
  scenariosRouter,
  projectionMetadataRouter,
  coastFireRouter,
  coastFireProbeRouter,
  monteCarloRouter,
  monteCarloPeekRouter,
  strategyRouter,
  stressTestRouter,
  presetsRouter,
  relocationProjectionRouter,
  taxOptimizationRouter,
  withdrawalBracketOptimizerRouter,
  socialSecurityRouter,
);
