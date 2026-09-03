import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "./transforms";

/**
 * Every person, ordered by id — the household roster.
 *
 * Replaces ~11 verbatim
 * `db.select().from(people).orderBy(asc(people.id))` copies scattered
 * across the routers and payload builders. Returns the query
 * builder (thenable), so it drops into a `Promise.all([...])` array
 * exactly where the inline expression used to sit.
 */
export function getAllPeople(db: Db) {
  return db.select().from(schema.people).orderBy(asc(schema.people.id));
}
