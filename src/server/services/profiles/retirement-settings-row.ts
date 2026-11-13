/** A retirement settings row as a writer inserts it: the Roth bracket overlay
 *  switch stated, never left empty (tag 0022's converter turns an empty one
 *  on, so a replay would undo a saved "off"). */
import type * as schema from "@/lib/db/schema";
import { storedRothOverlay } from "@/lib/config/roth-bracket-overlay";
import { acaHouseholdSize } from "@/lib/config/aca-tables";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import type { DbOrTx } from "@/lib/db";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";

/** The insert type with the switch required. */
export type RetirementSettingsInsert =
  typeof schema.retirementSettings.$inferInsert & {
    rothBracketOverlay: boolean;
  };

/** A new household's Roth bracket overlay: off, so its order is its own until it turns it on. */
export const DEFAULT_ROTH_BRACKET_OVERLAY = false;

/** A new row's ACA household size when the writer sends none (it stays editable): from the
 *  people and this year's return status as `thisYearFilingStatus` resolves it for this row. */
export async function newRowAcaHouseholdSize(
  db: DbOrTx,
  args: {
    rowStatus: ReturnFilingStatus | null;
    people: readonly { id: number; isPrimaryUser: boolean }[];
    appSettings: readonly { key: string; value: unknown }[];
    asOf: Date;
  },
): Promise<number> {
  const { status } = await thisYearFilingStatus(db, {
    appSettings: args.appSettings,
    profileStatus: args.rowStatus,
    people: args.people,
    asOf: args.asOf,
  });
  return acaHouseholdSize(args.people.length, status);
}

type WithoutSwitch = Omit<RetirementSettingsInsert, "rothBracketOverlay">;

/** The demo's new household row: filing status "Auto" (null, from the jobs'
 *  W-4) and the overlay a new household starts with. */
export const NEW_HOUSEHOLD_ROW = {
  filingStatus: null,
  rothBracketOverlay: DEFAULT_ROTH_BRACKET_OVERLAY,
} as const;

/** A copy of a stored row, switch included, read as `storedRothOverlay` reads it. */
export const copiedSettingsRow = (
  row: WithoutSwitch & { rothBracketOverlay: boolean | null },
): RetirementSettingsInsert => ({
  ...row,
  rothBracketOverlay: storedRothOverlay(row.rothBracketOverlay),
});
