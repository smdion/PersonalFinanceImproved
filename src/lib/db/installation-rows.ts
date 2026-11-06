/**
 * The rows a non-admin's restore or import writes to the installation's
 * tables: today's credentials and sync state, with the backup's links.
 */
import { sql } from "drizzle-orm";
import { queryRaw } from "./compat";
import { VERSION_TABLES } from "./version-tables";

type Row = Record<string, unknown>;

/** api_connections' columns that name the household's own rows by id. */
const CONNECTION_LINKS = [
  "account_mappings",
  "skipped_category_ids",
  "linked_profile_id",
  "linked_column_index",
] as const;

/** Today's connections, each with its service's links from the backup, or
 *  none when the backup has no such service. A service only the backup has
 *  isn't added: only an admin creates a connection. */
export function connectionsWithBackupLinks(
  today: Row[],
  backup: unknown[],
): Row[] {
  const rows = backup.filter(
    (b): b is Row => typeof b === "object" && b !== null,
  );
  return today.map((row) => {
    const theirs = rows.find((b) => b["service"] === row["service"]);
    const links = CONNECTION_LINKS.map((c) => [c, theirs?.[c] ?? null]);
    return { ...row, ...Object.fromEntries(links) };
  });
}

/** The backup's tables as a restore or import writes them: whole for an
 *  admin; for anyone else, each installation table holds today's rows
 *  (api_connections with the backup's links), read as a version stores them. */
export async function withInstallationRows(
  database: Parameters<typeof queryRaw>[0],
  tables: Record<string, unknown[]>,
  by: { asAdmin: boolean },
): Promise<Record<string, unknown[]>> {
  if (by.asAdmin) return tables;
  const out = { ...tables };
  for (const { name, scope } of VERSION_TABLES) {
    if (scope !== "installation") continue;
    const read = await queryRaw(database, sql.raw(`SELECT * FROM "${name}"`));
    const today: Row[] = JSON.parse(JSON.stringify(read));
    const backup = Array.isArray(tables[name]) ? tables[name] : [];
    out[name] =
      name === "api_connections"
        ? connectionsWithBackupLinks(today, backup)
        : today;
  }
  return out;
}
