/** The household's joint-return spouse pair, stored in one transaction. */
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { getAllPeople, setSpouse } from "@/server/data/people";

/** Stores (or with null clears) person `id`'s spouse (`setSpouse`), after
 *  refusing a self-link and a person who isn't in the household. Returns
 *  everyone. */
export function storeSpousePair(
  db: Db,
  id: number,
  spousePersonId: number | null,
) {
  return db.transaction(async (tx) => {
    if (spousePersonId === id)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A person can't be their own spouse",
      });
    const ids = new Set(
      (await tx.select({ id: schema.people.id }).from(schema.people)).map(
        (p) => p.id,
      ),
    );
    if (!ids.has(id) || (spousePersonId !== null && !ids.has(spousePersonId)))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No such person in this household",
      });
    await setSpouse(tx, id, spousePersonId);
    return getAllPeople(tx);
  });
}
