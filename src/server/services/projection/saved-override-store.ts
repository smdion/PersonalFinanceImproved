/** The stored "Changes by year" and Brokerage sets: one row per kind, read
 *  as stored and written with the entries this version doesn't know kept. */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { firstRow } from "@/lib/utils/first-row";
import type { Db, DbOrTx } from "@/lib/db";
import { lockForTransaction } from "@/server/data/lock-row";
import { withStoredUnknownTypes } from "./saved-override-rows";

export type SavedSetKind = "accumulation" | "decumulation" | "brokerage";

/** One kind's saved set as stored; [] when none. */
export function storedSet(db: DbOrTx, kind: SavedSetKind) {
  return db
    .select({ overrides: schema.projectionOverrides.overrides })
    .from(schema.projectionOverrides)
    .where(eq(schema.projectionOverrides.overrideType, kind))
    .then((r) => r[0]?.overrides ?? []);
}

/** Stores an editor's set as `user`, with the stored entries for account types
 *  this version doesn't know merged back (`withStoredUnknownTypes`), one kind at
 *  a time: the stored row (none when a clear leaves nothing) and the notes. */
export function storeSet(
  db: Db,
  user: string,
  kind: SavedSetKind,
  saved: Record<string, unknown>[],
  clearing = false,
) {
  return db.transaction(async (tx) => {
    // The row may not exist yet: a named lock, not the row's.
    await lockForTransaction(tx, `projection-overrides:${kind}`);
    const { rows, unknownTypeNotes } = withStoredUnknownTypes(
      kind,
      saved,
      await storedSet(tx, kind),
    );
    if (clearing && rows.length === 0) {
      await tx
        .delete(schema.projectionOverrides)
        .where(eq(schema.projectionOverrides.overrideType, kind));
      return { row: undefined, unknownTypeNotes };
    }
    const row = await tx
      .insert(schema.projectionOverrides)
      .values({ overrideType: kind, overrides: rows, createdBy: user })
      .onConflictDoUpdate({
        target: schema.projectionOverrides.overrideType,
        set: { overrides: rows, updatedBy: user },
      })
      .returning()
      .then(firstRow);
    return { row, unknownTypeNotes };
  });
}
