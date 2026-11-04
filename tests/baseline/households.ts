/**
 * The baseline's 17 invented households: the November review's hand
 * worksheet (8, two of them also screens-e2e A and C), the engine ledgers
 * (7) and the other two screens-e2e households (B, D). Every figure is
 * invented; none comes from a real household.
 */
import type { Household } from "./seed";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";
import { LEDGER_HOUSEHOLDS } from "./households-ledgers";

export const HOUSEHOLDS: Household[] = [
  ...REVIEWED_HOUSEHOLDS,
  ...LEDGER_HOUSEHOLDS,
];
