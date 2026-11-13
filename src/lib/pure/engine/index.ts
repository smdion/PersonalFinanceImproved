/** The projection engine's public API: code outside `lib/pure/engine` imports
 *  values from here, and types and input schemas from `./types` (module map:
 *  ARCHITECTURE.md). `@public`: documented in DESIGN.md, kept for knip. */
export { calculateProjection } from "./projection";
export { isRetirementBrokerage } from "./opening-state";
export { projectionPriceLevel } from "./price-level";

export {
  estimateEffectiveTaxRate,
  /** @public */ incomeCapForMarginalRate,
  /** @public */ marginalRateAboveTarget,
  /** @public */ computeTaxableSS,
} from "./tax-estimation";

export type { /** @public */ WithholdingBracket } from "./tax-estimation";

export { /** @public */ rankWithdrawalTiers } from "./withdrawal-cost-ranking";
export type {
  /** @public */ WithdrawalTier,
  WithdrawalSourceKind,
  /** @public */ RankWithdrawalTiersInput,
} from "./withdrawal-cost-ranking";

export { shortfallFloor } from "./gap-year-draw";
