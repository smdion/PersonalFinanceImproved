/** The projection engine's public API: code outside `lib/pure/engine` imports
 *  values from here, and types and input schemas from `./types` (module map:
 *  ARCHITECTURE.md). `@public`: documented in DESIGN.md, kept for knip. */
export { calculateProjection } from "./projection";
export { isRetirementBrokerage } from "./opening-state";
export { openingParts, syntheticOpeningParts } from "./opening-parts";
export { lumpSumParts, resolveLumpSums, runLumpSums } from "./lump-sum-targets";
export type { ResolvedLumpSums } from "./lump-sum-targets";
export { projectionPriceLevel } from "./price-level";

export {
  estimateEffectiveTaxRate,
  /** @public */ incomeCapForMarginalRate,
  /** @public */ marginalRateAboveTarget,
  /** @public */ computeTaxableSS,
} from "./tax-estimation";

export type { /** @public */ WithholdingBracket } from "./tax-estimation";

export {
  /** @public */ walkDiscretionaryDraw,
} from "./withdrawal-cost-ranking";
export type { /** @public */ DrawSegment } from "./withdrawal-cost-ranking";
export type {
  WithdrawalSourceKind,
  /** @public */ DrawState,
} from "./draw-position";

export { gapUnmetNeedMaterial } from "./gap-year-draw";
