import { asc, eq, or } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/** Every person, ordered by id. Returns the thenable query builder, for `Promise.all`. */
export function getAllPeople(db: DbOrTx) {
  return db.select().from(schema.people).orderBy(asc(schema.people.id));
}

/** Stores a person's spouse on the joint return (one pair per household: linking clears every
 *  other link, then each row names the other), or with null unlinks them and whoever named
 *  them. The caller checks both people exist and differ. */
export async function setSpouse(
  db: DbOrTx,
  personId: number,
  spouseId: number | null,
): Promise<void> {
  if (spouseId === null) {
    await db
      .update(schema.people)
      .set({ spousePersonId: null })
      .where(
        or(
          eq(schema.people.id, personId),
          eq(schema.people.spousePersonId, personId),
        ),
      );
    return;
  }
  // Every row, no WHERE on the link: a concurrent link's rows wait here and are cleared too.
  await db.update(schema.people).set({ spousePersonId: null });
  for (const [id, other] of [
    [personId, spouseId],
    [spouseId, personId],
  ] as const)
    await db
      .update(schema.people)
      .set({ spousePersonId: other })
      .where(eq(schema.people.id, id));
}
