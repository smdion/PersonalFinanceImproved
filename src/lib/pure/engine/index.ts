/** The projection engine's public API: code outside `lib/pure/engine` imports
 *  values from here, and types and input schemas from `./types` (module map:
 *  ARCHITECTURE.md). */
export { calculateProjection } from "../../calculators/engine/projection";

export {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  marginalRateAboveTarget,
  computeTaxableSS,
} from "../../calculators/engine/tax-estimation";

export type { WithholdingBracket } from "../../calculators/engine/tax-estimation";

export { rankWithdrawalTiers } from "../../calculators/engine/withdrawal-cost-ranking";
export type {
  WithdrawalTier,
  WithdrawalSourceKind,
  RankWithdrawalTiersInput,
} from "../../calculators/engine/withdrawal-cost-ranking";

export { shortfallFloor } from "../../calculators/engine/gap-year-draw";
