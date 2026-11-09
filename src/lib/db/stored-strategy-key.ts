/**
 * retirement_settings.withdrawal_strategy as read: a free varchar, checked
 * once against the strategy set; a key outside it is logged and read as
 * stored, so any install loads.
 */
import { z } from "zod/v4";
import {
  WITHDRAWAL_STRATEGY_VALUES,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { passOnAsStored, readStoredShape } from "@/lib/db/stored-shape";

const strategyKey = z.enum(WITHDRAWAL_STRATEGY_VALUES);

/** The stored key as the engine takes it. An unknown key is logged once
 *  per process (not on every read) and passed on as stored. */
export function readStoredStrategy(stored: unknown): WithdrawalStrategyType {
  return passOnAsStored(
    readStoredShape(stored, strategyKey, {
      event: "withdrawal_strategy_unknown_key",
      key: () => String(stored),
      data: () => ({ stored }),
    }),
  );
}
