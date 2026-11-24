/**
 * retirement_settings.withdrawal_strategy as read: a free varchar, checked
 * once against the strategy set; a key outside it is logged and runs as the
 * column's default (Fixed), named in a note, so any install loads.
 */
import { z } from "zod/v4";
import {
  WITHDRAWAL_STRATEGY_VALUES,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import {
  STRATEGY_IF_UNKNOWN,
  runningStrategyConfig,
  storedStrategyConfig,
} from "@/lib/config/stored-withdrawal-strategy";
import { readStoredShape } from "@/lib/db/stored-shape";

const strategyKey = z.enum(WITHDRAWAL_STRATEGY_VALUES);

/** The strategy the engine runs for a stored key. An unknown key is logged
 *  once per process (not on every read) and runs as Fixed; it stays stored. */
export function readStoredStrategy(stored: unknown): WithdrawalStrategyType {
  const read = readStoredShape(stored, strategyKey, {
    event: "withdrawal_strategy_unknown_key",
    key: () => String(stored),
    data: () => ({ stored }),
  });
  return read.fits ? read.value : STRATEGY_IF_UNKNOWN;
}

/** The note for a stored key `readStoredStrategy` runs as Fixed; none for a
 *  key this version knows. */
export function unknownStrategyNotes(stored: string): string[] {
  if (storedStrategyConfig(stored)) return [];
  const used = runningStrategyConfig(stored).label;
  return [
    `The saved spending strategy "${stored}" isn't one this version knows, so the projection uses ${used}. Update Ledgr or pick a strategy.`,
  ];
}
