/**
 * retirement_settings.withdrawal_strategy as read: a free varchar, checked
 * once against the strategy set; a key outside it is logged and read as
 * stored, so any install loads.
 */
import {
  WITHDRAWAL_STRATEGY_VALUES,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { logWarnOnce } from "@/lib/logger";

function isStrategyKey(key: string): key is WithdrawalStrategyType {
  return WITHDRAWAL_STRATEGY_VALUES.some((value) => value === key);
}

/** The stored key as the engine takes it. An unknown key is logged once
 *  per process (not on every read) and passed on as stored. */
export function readStoredStrategy(stored: string): WithdrawalStrategyType {
  if (isStrategyKey(stored)) return stored;
  logWarnOnce("withdrawal_strategy_unknown_key", stored, { stored });
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one place an unknown stored key passes on as stored
  return stored as WithdrawalStrategyType;
}
