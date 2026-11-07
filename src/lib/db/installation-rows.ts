/**
 * The rows a non-admin's restore or import writes to the installation's
 * tables: today's credentials, with the backup's links and sync state.
 */
import { sql } from "drizzle-orm";
import { queryRaw } from "./compat";
import { VERSION_TABLES } from "./version-tables";

type Row = Record<string, unknown>;

/** Each installation table's columns, every one on exactly one side: kept
 *  from today (`key` matches a today row to the backup's), or taken from the
 *  backup with the household rows they name or follow (null when it lacks the row). */
export const INSTALLATION_COLUMNS: Record<
  string,
  { key: string; kept: readonly string[]; fromBackup: readonly string[] }
> = {
  api_connections: {
    key: "service",
    kept: ["id", "service", "config", "server_knowledge"],
    fromBackup: [
      "account_mappings",
      "skipped_category_ids",
      "linked_profile_id",
      "linked_column_index",
      // SimpleFIN's next fetch starts here: it follows the restored history.
      "last_synced_at",
    ],
  },
};

/** Today's rows, each with the backup's `fromBackup` columns for its key, or
 *  null ones when the backup has no such row. A row only the backup has isn't
 *  added: only an admin creates a connection. */
function withBackupColumns(
  today: Row[],
  backup: unknown[],
  { key, fromBackup }: (typeof INSTALLATION_COLUMNS)[string],
): Row[] {
  const rows = backup.filter(
    (b): b is Row => typeof b === "object" && b !== null,
  );
  return today.map((row) => {
    const theirs = rows.find((b) => b[key] === row[key]);
    const taken = fromBackup.map((c) => [c, theirs?.[c] ?? null]);
    return { ...row, ...Object.fromEntries(taken) };
  });
}

/** The backup's tables as a restore or import writes them: whole for an
 *  admin; for anyone else, each installation table holds today's rows with
 *  the backup's columns, read as a version stores them. */
export async function withInstallationRows(
  database: Parameters<typeof queryRaw>[0],
  tables: Record<string, unknown[]>,
  by: { asAdmin: boolean },
): Promise<Record<string, unknown[]>> {
  if (by.asAdmin) return tables;
  const out = { ...tables };
  for (const { name, scope } of VERSION_TABLES) {
    if (scope !== "installation") continue;
    const columns = INSTALLATION_COLUMNS[name];
    if (!columns) throw new Error(`${name}: no installation columns listed`);
    const read = await queryRaw(database, sql.raw(`SELECT * FROM "${name}"`));
    const today: Row[] = JSON.parse(JSON.stringify(read));
    const backup = Array.isArray(tables[name]) ? tables[name] : [];
    out[name] = withBackupColumns(today, backup, columns);
  }
  return out;
}
