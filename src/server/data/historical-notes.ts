/** Writes a note on one Historical year's field. */

import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";

/** Saves the note on a year's field; an empty or blank note deletes it. */
export async function upsertHistoricalNote(
  db: Db,
  input: { year: number; field: string; note: string },
) {
  if (input.note.trim() === "") {
    await db
      .delete(schema.historicalNotes)
      .where(
        and(
          eq(schema.historicalNotes.year, input.year),
          eq(schema.historicalNotes.field, input.field),
        ),
      );
  } else {
    await db
      .insert(schema.historicalNotes)
      .values({ year: input.year, field: input.field, note: input.note })
      .onConflictDoUpdate({
        target: [schema.historicalNotes.year, schema.historicalNotes.field],
        set: { note: input.note },
      });
  }
}
