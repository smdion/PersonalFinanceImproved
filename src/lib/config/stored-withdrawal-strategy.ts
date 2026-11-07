import {
  WITHDRAWAL_STRATEGY_CONFIG,
  getStrategyMeta,
} from "./withdrawal-strategies";

/** A withdrawal strategy's config by its stored key. `withdrawal_strategy`
 *  is a stored varchar, and a restored backup is inserted as it is, so the
 *  key may name no current strategy: undefined then. */
export const STRATEGY_CONFIG_BY_STORED_KEY: Partial<
  Record<string, ReturnType<typeof getStrategyMeta>>
> = WITHDRAWAL_STRATEGY_CONFIG;
