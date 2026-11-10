/** The rows a restore or import writes to the tables of access and credentials:
 *  `version` manages household data, not access (RULES § Permission & Security
 *  Gates, rule 4): a non-admin keeps today's, and today's links where they hold. */
import { sql } from "drizzle-orm";
import { queryRaw } from "../compat";
import { VERSION_TABLES } from "./version-tables";
import { isPostgres } from "../dialect";
import { rowsInSourceForm } from "./restored-values";
import { SK_ONBOARDING_COMPLETED } from "@/lib/constants/settings-keys";
import { onboardingClosesGate } from "../onboarding-gate";
import {
  MATCHED_LINK_COLUMNS,
  matchedLinks,
  targetRows,
  type TargetRows,
} from "./connection-links";
import {
  RBAC_ADMIN_GROUP_KEY,
  RBAC_SETTINGS_PREFIX,
} from "@/lib/config/permissions";

type Row = Record<string, unknown>;

/** Each installation table's columns, every one on exactly one list: kept from
 *  today (`key` matches a today row to the backup's), matched (today's where they
 *  name the same restored row: connection-links.ts), or taken from the backup. */
type ColumnLists = Readonly<
  Record<
    string,
    Readonly<{
      key: string;
      kept: readonly string[];
      matched: readonly string[];
      fromBackup: readonly string[];
    }>
  >
>;

export const INSTALLATION_COLUMNS: ColumnLists = {
  api_connections: {
    key: "service",
    kept: ["id", "service", "config", "server_knowledge"],
    matched: MATCHED_LINK_COLUMNS,
    fromBackup: [
      // The budget service's own category ids: no restored row to match.
      "skipped_category_ids",
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

/** Today's rows, each with its matched links and the backup's `fromBackup`
 *  columns for its key (null when the backup has no such row). A row only the
 *  backup has isn't added: only an admin creates a connection. */
function withBackupColumns(
  today: Row[],
  backup: unknown,
  { key, fromBackup }: ColumnLists[string],
  targets: { today: TargetRows; restored: TargetRows },
): Row[] {
  const rows = rowsOf(backup);
  return today.map((row) => {
    const theirs = rows.find((b) => b[key] === row[key]);
    const taken = fromBackup.map((c) => [c, theirs?.[c] ?? null]);
    const links = matchedLinks(row, theirs, targets.today, targets.restored);
    return { ...row, ...links, ...Object.fromEntries(taken) };
  });
}

/** Who restores; whether the backup is a household-only export (no logins,
 *  access settings or credentials); the dialect a backup was exported from. */
export type RestoreScope = {
  asAdmin: boolean;
  householdOnly?: boolean;
  sourceDialect?: "postgres" | "sqlite";
};

/** A settings row's onboarding flag; jsonb as read: parsed (PostgreSQL) or
 *  JSON text (SQLite). */
function onboardingFlagIn(settings: Row[]): boolean | null {
  const value = settings.find((r) => r.key === SK_ONBOARDING_COMPLETED)?.value;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

/** A true onboarding flag row when onboarding keeps the first-admin gate
 *  closed today but wouldn't with the backup's rows; else null. */
async function finishedOnboarding(
  settings: Row[],
  tables: Record<string, unknown[]>,
  today: (name: string) => Promise<Row[]>,
  sourceDialect: RestoreScope["sourceDialect"],
): Promise<Row | null> {
  const flag = onboardingFlagIn(settings);
  const people = flag === null && (await today("people")).length > 0;
  if (!onboardingClosesGate(flag, people)) return null;
  const theirFlag = onboardingFlagIn(rowsOf(tables["app_settings"]));
  const theirPeople = rowsOf(tables["people"]).length > 0;
  if (onboardingClosesGate(theirFlag, theirPeople)) return null;
  // The backup's form: JSON text for a SQLite source, parsed for PostgreSQL's.
  const asText = isPostgres()
    ? sourceDialect === "sqlite"
    : sourceDialect !== "postgres";
  return { key: SK_ONBOARDING_COMPLETED, value: asText ? "true" : true };
}

/** The backup's settings with today's `kept` rows in place of theirs by key,
 *  each kept row on a fresh id past the backup's (ids name nothing else). */
function withTodaySettings(backup: Row[], kept: Row[]): Row[] {
  const keys = new Set(kept.map((r) => r.key));
  const rest = backup.filter((r) => !keys.has(r.key));
  const top = Math.max(0, ...rest.map((r) => Number(r["id"]) || 0));
  return [...rest, ...kept.map((r, i) => ({ ...r, id: top + i + 1 }))];
}

/** Today's rows of `name` in the form the backup's rows have: they merge
 *  with the backup's and are written by its dialect's rule. */
async function todayRows(
  database: Parameters<typeof queryRaw>[0],
  name: string,
  sourceDialect: RestoreScope["sourceDialect"],
): Promise<Row[]> {
  const read = await queryRaw(database, sql.raw(`SELECT * FROM "${name}"`));
  const rows: Row[] = JSON.parse(JSON.stringify(read));
  return rowsInSourceForm(database, name, rows, sourceDialect);
}

/** The backup's tables as a restore or import writes them: whole for an admin's
 *  full backup, else with today's access and credentials; either way today's local
 *  admins when it has none and a finished onboarding (the first-admin gate holds). */
export async function withInstallationRows(
  database: Parameters<typeof queryRaw>[0],
  tables: Record<string, unknown[]>,
  by: RestoreScope,
  lists: ColumnLists = INSTALLATION_COLUMNS, // a test passes its own
): Promise<Record<string, unknown[]>> {
  const keepAccess = !by.asAdmin || by.householdOnly === true;
  const today = (name: string) => todayRows(database, name, by.sourceDialect);
  const out = { ...tables };
  for (const { name, scope } of VERSION_TABLES) {
    if (scope === "logins" && (keepAccess || rowsOf(tables[name]).length === 0))
      out[name] = await today(name);
    if (scope !== "installation" || !keepAccess) continue;
    const columns = lists[name];
    if (!columns) throw new Error(`${name}: no installation columns listed`);
    const targets = {
      today: await targetRows(today),
      restored: await targetRows(async (t) => rowsOf(tables[t])),
    };
    out[name] = withBackupColumns(
      await today(name),
      tables[name],
      columns,
      targets,
    );
  }
  const settings = await today("app_settings");
  const kept = keepAccess
    ? settings.filter((r) => isAccessSettingKey(r.key))
    : [];
  // A gate onboarding closes today stays closed for every caller, the CLI
  // included, which settles no gate: it never reopens through a backup.
  const finished = await finishedOnboarding(
    settings,
    tables,
    today,
    by.sourceDialect,
  );
  if (finished) kept.push(finished);
  out["app_settings"] = withTodaySettings(
    rowsOf(tables["app_settings"]).filter(
      (r) => !(keepAccess && isAccessSettingKey(r.key)),
    ),
    kept,
  );
  return out;
}

/** An export for someone who isn't an admin: no logins or access settings,
 *  and each installation table only its `key`, matched and `fromBackup` columns. */
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
    const shown = [columns.key, ...columns.matched, ...columns.fromBackup];
    out[name] = rowsOf(tables[name]).map((row) =>
      Object.fromEntries(shown.map((c) => [c, row[c]])),
    );
  }
  out["app_settings"] = rowsOf(tables["app_settings"]).filter(
    (r) => !isAccessSettingKey(r.key),
  );
  return out;
}
