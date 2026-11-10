/** The rows a restore or import writes to the tables of access and credentials:
 *  `version` manages household data, not access (RULES § Known Gaps), so anyone
 *  but an admin keeps today's, with the backup's links and sync state. */
import { sql } from "drizzle-orm";
import { queryRaw } from "../compat";
import { VERSION_TABLES } from "./version-tables";
import {
  RBAC_ADMIN_GROUP_KEY,
  RBAC_SETTINGS_PREFIX,
} from "@/lib/config/permissions";

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

/** An app_settings key that grants access: the Authentik group mapping. */
export function isAccessSettingKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    (key === RBAC_ADMIN_GROUP_KEY || key.startsWith(RBAC_SETTINGS_PREFIX))
  );
}

const rowsOf = (rows: unknown): Row[] =>
  Array.isArray(rows)
    ? rows.filter((r): r is Row => typeof r === "object" && r !== null)
    : [];

/** Today's rows, each with the backup's `fromBackup` columns for its key, or
 *  null ones when the backup has no such row. A row only the backup has isn't
 *  added: only an admin creates a connection. */
function withBackupColumns(
  today: Row[],
  backup: unknown,
  { key, fromBackup }: (typeof INSTALLATION_COLUMNS)[string],
): Row[] {
  const rows = rowsOf(backup);
  return today.map((row) => {
    const theirs = rows.find((b) => b[key] === row[key]);
    const taken = fromBackup.map((c) => [c, theirs?.[c] ?? null]);
    return { ...row, ...Object.fromEntries(taken) };
  });
}

/** Who restores, and whether the backup is a household-only export (made by
 *  someone who isn't an admin: no logins, access settings or credentials). */
export type RestoreScope = { asAdmin: boolean; householdOnly?: boolean };

/** The backup's tables as a restore or import writes them: whole for an admin's
 *  full backup, but one with no local admin keeps today's (the first-admin gate
 *  never reopens through a backup); otherwise today's access and credentials. */
export async function withInstallationRows(
  database: Parameters<typeof queryRaw>[0],
  tables: Record<string, unknown[]>,
  by: RestoreScope,
): Promise<Record<string, unknown[]>> {
  const keepAccess = !by.asAdmin || by.householdOnly === true;
  const today = async (name: string): Promise<Row[]> =>
    JSON.parse(
      JSON.stringify(
        await queryRaw(database, sql.raw(`SELECT * FROM "${name}"`)),
      ),
    );
  const out = { ...tables };
  for (const { name, scope } of VERSION_TABLES) {
    if (scope === "logins" && (keepAccess || rowsOf(tables[name]).length === 0))
      out[name] = await today(name);
    if (scope !== "installation" || !keepAccess) continue;
    const columns = INSTALLATION_COLUMNS[name];
    if (!columns) throw new Error(`${name}: no installation columns listed`);
    out[name] = withBackupColumns(await today(name), tables[name], columns);
  }
  if (keepAccess)
    out["app_settings"] = [
      ...rowsOf(tables["app_settings"]).filter(
        (r) => !isAccessSettingKey(r.key),
      ),
      ...(await today("app_settings")).filter((r) => isAccessSettingKey(r.key)),
    ];
  return out;
}

/** An export for someone who isn't an admin: no logins or access settings,
 *  and each installation table only its `key` and `fromBackup` columns. */
export function householdOnlyTables(
  tables: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const { name, scope } of VERSION_TABLES) {
    if (!(name in tables) || scope === "logins") continue;
    if (scope === "household") {
      out[name] = tables[name]!;
      continue;
    }
    const columns = INSTALLATION_COLUMNS[name];
    if (!columns) throw new Error(`${name}: no installation columns listed`);
    const shown = [columns.key, ...columns.fromBackup];
    out[name] = rowsOf(tables[name]).map((row) =>
      Object.fromEntries(shown.map((c) => [c, row[c]])),
    );
  }
  out["app_settings"] = rowsOf(tables["app_settings"]).filter(
    (r) => !isAccessSettingKey(r.key),
  );
  return out;
}
