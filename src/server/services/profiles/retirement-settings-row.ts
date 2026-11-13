/** A retirement settings row as a writer inserts it: the Roth bracket overlay
 *  switch stated, never left empty (tag 0022's converter turns an empty one
 *  on, so a replay would undo a saved "off"). */
import type * as schema from "@/lib/db/schema";

/** The insert type with the switch required. */
export type RetirementSettingsInsert =
  typeof schema.retirementSettings.$inferInsert & {
    rothBracketOverlay: boolean;
  };

/** A new household's Roth bracket overlay: off, so its order is its own until it turns it on. */
export const DEFAULT_ROTH_BRACKET_OVERLAY = false;

/** The demo's new household row: filing status "Auto" (null, from the jobs'
 *  W-4) and the overlay a new household starts with. */
export const NEW_HOUSEHOLD_ROW = {
  filingStatus: null,
  rothBracketOverlay: DEFAULT_ROTH_BRACKET_OVERLAY,
} as const;
