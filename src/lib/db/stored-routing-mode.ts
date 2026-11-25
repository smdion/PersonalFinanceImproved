/**
 * retirement_settings.withdrawal_routing_mode as read: a varchar with no
 * CHECK, so a mode outside the set (a newer Ledgr's, through a downgrade) is
 * logged and runs as the default, named in a note; it stays stored.
 */
import {
  DEFAULT_WITHDRAWAL_ROUTING_MODE,
  WITHDRAWAL_ROUTING_MODE_LABELS,
  knownRoutingMode,
  type WithdrawalRoutingMode,
} from "@/lib/config/withdrawal-routing";
import { logWarnOnce } from "@/lib/logger";

/** The mode the engine runs for a stored one, and the note for a mode this
 *  version doesn't know (it runs as the default, which every page shows). */
export function readStoredRoutingMode(stored: string): {
  value: WithdrawalRoutingMode;
  notes: string[];
} {
  const known = knownRoutingMode(stored);
  if (known) return { value: known, notes: [] };
  logWarnOnce("withdrawal_routing_mode_unknown", stored, { stored });
  const used = WITHDRAWAL_ROUTING_MODE_LABELS[DEFAULT_WITHDRAWAL_ROUTING_MODE];
  return {
    value: DEFAULT_WITHDRAWAL_ROUTING_MODE,
    notes: [
      `The saved withdrawal routing "${stored}" isn't one this version knows, so the projection uses ${used}. Update Ledgr or pick a routing under Taxes.`,
    ],
  };
}
