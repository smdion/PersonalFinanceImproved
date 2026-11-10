/** The restore step's data converters (migration-converters.ts), with the
 *  schema's foreign keys, so a converter delete that would orphan a
 *  backup's rows is refused as it is on a live database. */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema-pg";
import { log } from "@/lib/logger";
import { convertBackupInOrder } from "../migrate/migration-converters";
import type { Reference } from "../migrate/converter-writes";

/** Every single-column foreign key in the schema. */
export const SCHEMA_REFERENCES: readonly Reference[] = Object.values<unknown>(
  schema,
)
  .filter((t) => is(t, PgTable))
  .flatMap((t) => {
    const table = getTableConfig(t);
    return table.foreignKeys.map((fk) => {
      const r = fk.reference();
      return {
        child: table.name,
        column: r.columns[0]!.name,
        parent: getTableConfig(r.foreignTable).name,
      };
    });
  });

/** Every registered converter over a restored backup, in registry order. */
export function convertRestoredBackup(tables: Record<string, unknown[]>) {
  for (const { tag, run } of convertBackupInOrder(
    tables,
    undefined,
    SCHEMA_REFERENCES,
  ))
    log("info", "backup_conversion", { tag, ...run });
}
