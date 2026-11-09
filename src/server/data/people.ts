import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/** Every person, ordered by id. Returns the thenable query builder, for `Promise.all`. */
export function getAllPeople(db: DbOrTx) {
  return db.select().from(schema.people).orderBy(asc(schema.people.id));
}
