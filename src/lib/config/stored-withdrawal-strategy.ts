import {
  WITHDRAWAL_STRATEGY_CONFIG,
  getStrategyMeta,
} from "./withdrawal-strategies";

/** A withdrawal strategy's config by its stored key. `withdrawal_strategy`
 *  is a stored varchar, so the key may name no current strategy: undefined
 *  then. No prototype, so "constructor" or "toString" finds nothing. */
export const STRATEGY_CONFIG_BY_STORED_KEY: Partial<
  Record<string, ReturnType<typeof getStrategyMeta>>
> = Object.assign(Object.create(null), WITHDRAWAL_STRATEGY_CONFIG);
