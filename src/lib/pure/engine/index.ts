/** The projection engine's public API: code outside `lib/pure/engine` imports
 *  values from here, and types and input schemas from `./types` (module map:
 *  ARCHITECTURE.md). */
export { calculateProjection } from "./projection";
export { projectionPriceLevel } from "./price-level";

export {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  marginalRateAboveTarget,
  computeTaxableSS,
} from "./tax-estimation";

export type { WithholdingBracket } from "./tax-estimation";

export { rankWithdrawalTiers } from "./withdrawal-cost-ranking";
export type {
  WithdrawalTier,
  WithdrawalSourceKind,
  RankWithdrawalTiersInput,
} from "./withdrawal-cost-ranking";

export { shortfallFloor } from "./gap-year-draw";
