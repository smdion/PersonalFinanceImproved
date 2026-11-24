import {
  WITHDRAWAL_STRATEGY_CONFIG,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "./withdrawal-strategies";

function isStrategyKey(key: string): key is WithdrawalStrategyType {
  return Object.hasOwn(WITHDRAWAL_STRATEGY_CONFIG, key);
}

/** A withdrawal strategy's config by its stored key. `withdrawal_strategy`
 *  is a stored varchar, so the key may name no current strategy: undefined
 *  then. Only own keys match, so "constructor" or "toString" finds nothing. */
export function storedStrategyConfig(
  key: string,
): ReturnType<typeof getStrategyMeta> | undefined {
  return isStrategyKey(key) ? getStrategyMeta(key) : undefined;
}

/** What a stored key no current strategy has runs as: the column's default
 *  (docs/FALLBACKS.md, "Stored strategy key"). */
export const STRATEGY_IF_UNKNOWN = "fixed" satisfies WithdrawalStrategyType;

/** The config of the strategy a stored key runs as: its own, or Fixed's. */
export function runningStrategyConfig(
  key: string,
): ReturnType<typeof getStrategyMeta> {
  return storedStrategyConfig(key) ?? getStrategyMeta(STRATEGY_IF_UNKNOWN);
}
