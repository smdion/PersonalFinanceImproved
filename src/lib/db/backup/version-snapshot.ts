/** Every versioned table read from one snapshot, for an export or a version: a child row
 *  never comes without its parent, which a restore's foreign-key check would refuse. */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../schema";
import { listTablesSQL, queryRaw } from "../compat";
import { VERSION_TABLE_NAMES } from "./version-tables";

type Tx = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

/** PostgreSQL: one snapshot for every read in the transaction (SQLite is serial anyway). */
export const ONE_SNAPSHOT = { isolationLevel: "repeatable read" } as const;

/** Each versioned table's rows, read in `tx`; one not created yet (a migration pending)
 *  is empty, listed first so no failed read aborts the transaction. */
export async function readVersionTables(
  tx: Tx,
): Promise<Record<string, unknown[]>> {
  const existing = new Set(
    (await queryRaw<{ tablename: string }>(tx, listTablesSQL())).map(
      (r) => r.tablename,
    ),
  );
  const tables: Record<string, unknown[]> = {};
  for (const name of VERSION_TABLE_NAMES)
    tables[name] = existing.has(name)
      ? await queryRaw(tx, sql.raw(`SELECT * FROM "${name}"`))
      : [];
  return tables;
}
