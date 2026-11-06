/** The asset side of each year-end row, shared by the Assets and
 *  Historical summaries: home improvements and other assets by year, and
 *  the year notes. */
import { asc } from "drizzle-orm";
import type { z } from "zod/v4";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { resolveYearAssets } from "@/lib/pure/net-worth/historical";
import type { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import { buildYearEndHistory } from "@/server/services/net-worth/year-end-history";

/** Each year-end row with its line-item asset figures, the home
 *  improvement and other-asset rows, and the notes keyed `year:field`. */
export async function loadYearAssets(
  db: Db,
  asOf: Date,
  targeting: z.output<typeof zYearEndTargeting>,
) {
  const [yearEndHistory, homeImprovements, otherAssets, noteRows] =
    await Promise.all([
      buildYearEndHistory(db, asOf, {
        budgetProfileId: targeting?.budgetProfileId,
        budgetColumn: targeting?.budgetColumn,
      }),
      db
        .select()
        .from(schema.homeImprovementItems)
        .orderBy(asc(schema.homeImprovementItems.year)),
      db
        .select()
        .from(schema.otherAssetItems)
        .orderBy(asc(schema.otherAssetItems.year)),
      db.select().from(schema.historicalNotes),
    ]);

  const notes: Record<string, string> = {};
  for (const n of noteRows) notes[`${n.year}:${n.field}`] = n.note;

  return {
    years: yearEndHistory.map((row) => ({
      row,
      assets: resolveYearAssets(row, homeImprovements, otherAssets),
    })),
    homeImprovements,
    otherAssets,
    notes,
  };
}
