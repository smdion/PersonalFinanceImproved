import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../schema";
import { countRows, queryRaw } from "../compat";
import {
  LOGIN_TABLES,
  VERSION_TABLE_NAMES,
  tablesFromBackup,
} from "./version-tables";
import { REBUILT_ON_RESTORE } from "./backup-transforms";

/** Versioned tables the backup lacks (it predates them) that hold rows now:
 *  a restore empties them, and synced history can't be fetched again. A
 *  table empty in the backup existed then, so it isn't listed. */
export async function tablesLostOnRestore(
  database: NodePgDatabase<typeof schema>,
  backupTableNames: Iterable<string>,
  by: { asAdmin: boolean },
): Promise<{ tableName: string; currentRows: number }[]> {
  const present = new Set(backupTableNames);
  const lost: { tableName: string; currentRows: number }[] = [];
  for (const tableName of tablesFromBackup(VERSION_TABLE_NAMES, by)) {
    // Present, or (logins) kept from today when the backup lacks them.
    if (present.has(tableName) || LOGIN_TABLES.includes(tableName)) continue;
    // Rebuilt by the restore from a table the backup does carry.
    const source = REBUILT_ON_RESTORE[tableName];
    if (source && present.has(source)) continue;
    let currentRows = 0;
    try {
      const rows = await queryRaw<{ count: number | string }>(
        database,
        sql.raw(`SELECT COUNT(*) AS count FROM "${tableName}"`),
      );
      currentRows = countRows(rows);
    } catch {
      continue; // table doesn't exist yet (migration pending)
    }
    if (currentRows > 0) lost.push({ tableName, currentRows });
  }
  return lost;
}
