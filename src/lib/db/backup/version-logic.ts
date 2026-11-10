/**
 * Version create, restore, export and import, each in a transaction (PG restore: SERIALIZABLE
 * on its own client; SQLite: single writer). Versions share the live database, so they are no
 * substitute for external backups.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { sql, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { isPostgres } from "../dialect";
import { encodeJsonbForPgImport } from "./jsonb-import";
import {
  jsonColumnsFor,
  jsonbColumnsOnClient,
  missingJsonb,
  restoredValue,
} from "./restored-values";
import {
  truncateTables,
  resetSequences,
  tablesWithIdColumn,
  validateColumns,
  queryRaw,
  execRaw,
} from "../compat";
import { reconcileReferenceData } from "../migrate/reference-data";
import {
  VERSION_TABLE_NAMES,
  VERSION_TABLES,
  tablesFromBackup,
} from "./version-tables";
import { withInstallationRows } from "./installation-rows";
import { checkImportedValues, checkRestoredValues } from "./closed-set-columns";
import { log } from "@/lib/logger";
import { transformFromSource } from "./restore-source";
import { writeStamp } from "@/lib/utils/clock";

/** An INSERT's columns: the union of every row's keys, since a backup transform can append a
 *  row with other keys (rows[0] alone would drop columns or NULL a NOT NULL one). */
function unionColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) seen.add(k);
  }
  return [...seen];
}

/**
 * Derive CURRENT_SCHEMA_VERSION from the drizzle journal automatically.
 * This reads drizzle/meta/_journal.json and picks the tag of the last entry,
 * so the version stays in sync with migrations without manual updates.
 */
function readSchemaVersion(): string {
  try {
    const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: { tag: string }[];
    };
    const entries = journal.entries; // parsed from disk, cast: kept guarded
    if (!entries || entries.length === 0) {
      throw new Error("No entries in drizzle journal");
    }
    return entries[entries.length - 1]!.tag;
  } catch (err) {
    // During build or if journal is missing, fall back to a safe default
    log("warn", "schema_version_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "unknown";
  }
}

/** Latest migration tag — derived from drizzle/meta/_journal.json at startup. */
const CURRENT_SCHEMA_VERSION = readSchemaVersion();

type CreateVersionInput = {
  name: string;
  description?: string;
  type: "auto" | "manual";
  createdBy: string;
};

type VersionResult = {
  id: number;
  name: string;
  versionType: string;
  tableCount: number;
  totalRows: number;
  sizeEstimateBytes: number | null;
  createdAt: Date;
};

export async function createVersion(
  database: NodePgDatabase<typeof schema>,
  input: CreateVersionInput,
): Promise<VersionResult> {
  // Read all tables + write version in a single transaction for consistency
  const result = await database.transaction(async (tx) => {
    const tableData: {
      tableName: string;
      rows: unknown[];
      rowCount: number;
    }[] = [];

    for (const tableName of VERSION_TABLE_NAMES) {
      try {
        const rows = await queryRaw(
          tx,
          sql.raw(`SELECT * FROM "${tableName}"`),
        );
        tableData.push({
          tableName,
          rows,
          rowCount: rows.length,
        });
      } catch {
        // Table doesn't exist yet (migration pending) — skip
        tableData.push({ tableName, rows: [], rowCount: 0 });
      }
    }

    const totalRows = tableData.reduce((sum, t) => sum + t.rowCount, 0);
    const jsonStr = JSON.stringify(tableData.map((t) => t.rows));
    const sizeEstimate = Buffer.byteLength(jsonStr, "utf8");

    // Insert version metadata
    const rows = await tx
      .insert(schema.stateVersions)
      .values({
        name: input.name,
        description: input.description ?? null,
        versionType: input.type,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tableCount: tableData.length,
        totalRows,
        sizeEstimateBytes: sizeEstimate,
        createdBy: input.createdBy,
      })
      .returning();

    const version = rows[0]!;

    // Insert per-table data
    for (const td of tableData) {
      await tx.insert(schema.stateVersionTables).values({
        versionId: version.id,
        tableName: td.tableName,
        rowCount: td.rowCount,
        data: td.rows as unknown[],
      });
    }

    return version;
  });

  // Post-commit: clean up old auto versions beyond retention
  await cleanupAutoVersions(database);

  return {
    id: result.id,
    name: result.name,
    versionType: result.versionType,
    tableCount: result.tableCount,
    totalRows: result.totalRows,
    sizeEstimateBytes: result.sizeEstimateBytes,
    createdAt: result.createdAt,
  };
}

async function cleanupAutoVersions(database: NodePgDatabase<typeof schema>) {
  try {
    const settings = await database.select().from(schema.appSettings);
    const retentionSetting = settings.find(
      (s) => s.key === "version_retention_count",
    );
    const retention =
      typeof retentionSetting?.value === "number" ? retentionSetting.value : 30;

    // Count auto versions
    const autoVersions = await database
      .select({ id: schema.stateVersions.id })
      .from(schema.stateVersions)
      .where(eq(schema.stateVersions.versionType, "auto"))
      .orderBy(sql`${schema.stateVersions.createdAt} DESC`);

    if (autoVersions.length > retention) {
      const toDelete = autoVersions.slice(retention);
      for (const v of toDelete) {
        await database
          .delete(schema.stateVersions)
          .where(eq(schema.stateVersions.id, v.id));
      }
    }
  } catch (err) {
    log("warn", "cleanup_auto_versions_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Inserts one table's rows, 500 to a statement; returns how many. */
async function insertRows(
  tx: Parameters<typeof execRaw>[0],
  tableName: string,
  rows: Record<string, unknown>[],
  sourceDialect?: "postgres" | "sqlite",
): Promise<number> {
  const columns = unionColumns(rows);
  validateColumns(tableName, columns);
  const jsonb = await jsonColumnsFor(tx, tableName, sourceDialect);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const valueClauses = batch.map((row) => {
      const values = columns.map((col) =>
        restoredValue(row[col], jsonb.get(col)),
      );
      return sql`(${sql.join(values, sql.raw(", "))})`;
    });
    await execRaw(
      tx,
      sql`INSERT INTO ${sql.raw(`"${tableName}"`)} (${sql.raw(colList)}) VALUES ${sql.join(valueClauses, sql.raw(", "))}`,
    );
  }
  return rows.length;
}

export async function restoreVersion(
  database: NodePgDatabase<typeof schema>,
  versionId: number,
  by: { asAdmin: boolean },
) {
  // Load version metadata
  const [version] = await database
    .select()
    .from(schema.stateVersions)
    .where(eq(schema.stateVersions.id, versionId));

  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  // Load all table data
  const tableDatas = await database
    .select()
    .from(schema.stateVersionTables)
    .where(eq(schema.stateVersionTables.versionId, versionId));

  // Transform version-row data if it was created at an older schema version
  const rawTableMap: Record<string, unknown[]> = {};
  for (const t of tableDatas)
    if (Array.isArray(t.data) && t.data.length > 0)
      rawTableMap[t.tableName] = t.data;

  const { tables: transformedMap } = transformFromSource(
    rawTableMap,
    { from: version.schemaVersion, to: CURRENT_SCHEMA_VERSION },
    isPostgres() ? "postgres" : "sqlite",
  );

  // Rebuild the table data map with transformed data — including tables the
  // transform rebuilt that the version itself doesn't carry (e.g. links a
  // newer schema keeps in a table of its own).
  const tableDataMap = new Map<string, { data: unknown }>(
    tableDatas.map((t) => [t.tableName, { data: t.data }]),
  );
  const fenced = checkRestoredValues(
    await withInstallationRows(database, transformedMap, by),
  );
  for (const [tableName, data] of Object.entries(fenced.tables))
    tableDataMap.set(tableName, { data });

  // Wrap in a transaction so truncate + inserts are atomic.
  // If anything fails, the database rolls back to its pre-restore state.
  let restoredRows = 0;

  await database.transaction(async (tx) => {
    // Truncate all user tables
    await truncateTables(tx, VERSION_TABLE_NAMES);

    // Insert rows per table in tier order (0 → 1 → 2)
    const sortedTables = [...VERSION_TABLES].sort((a, b) => a.tier - b.tier);

    for (const tableEntry of sortedTables) {
      const tableData = tableDataMap.get(tableEntry.name);
      if (
        !tableData ||
        !Array.isArray(tableData.data) ||
        tableData.data.length === 0
      ) {
        continue;
      }

      const rows = tableData.data as Record<string, unknown>[];
      restoredRows += await insertRows(tx, tableEntry.name, rows);
    }

    // Reset serial sequences for all tables (PG only — SQLite autoincrement is automatic)
    await resetSequences(tx, VERSION_TABLE_NAMES);

    // Log restore action
    try {
      await tx.insert(schema.changeLog).values({
        tableName: "state_versions",
        recordId: versionId,
        fieldName: "restore",
        oldValue: null,
        // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM jsonb column requires unknown type
        newValue: { action: "restore", versionName: version.name } as unknown,
        changedBy: version.createdBy,
      });
    } catch {
      // Non-critical
    }
  });

  // The version's reference rows replaced today's: re-add any the seed has
  // that it lacks (a newer tax year), as the next start would.
  await reconcileReferenceData(database);

  const names = tableDatas.map((t) => t.tableName);
  const restoredTables = tablesFromBackup(names, by).length;
  return { restoredTables, restoredRows, valueNotes: fenced.valueNotes };
}

export type BackupData = {
  schemaVersion: string;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  // The dialect the export ran against; absent is treated as "postgres" on import.
  sourceDialect?: "postgres" | "sqlite";
};

export async function exportBackup(
  database: NodePgDatabase<typeof schema>,
): Promise<BackupData> {
  const tables: Record<string, unknown[]> = {};

  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      tables[tableName] = await queryRaw(
        database,
        sql.raw(`SELECT * FROM "${tableName}"`),
      );
    } catch {
      // Table doesn't exist yet (migration pending) — export empty
      tables[tableName] = [];
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: writeStamp().toISOString(),
    tables,
    sourceDialect: isPostgres() ? "postgres" : "sqlite",
  };
}

export async function importBackup(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
  by: { asAdmin: boolean },
) {
  // Transform the backup to the current schema if needed.
  const { tables: transformedTables, transformed } = transformFromSource(
    backup.tables,
    { from: backup.schemaVersion, to: CURRENT_SCHEMA_VERSION },
    backup.sourceDialect,
  );

  if (transformed) {
    log("info", "backup_import_transformed", {
      from: backup.schemaVersion,
      to: CURRENT_SCHEMA_VERSION,
    });
  }

  const checked = checkImportedValues(
    await withInstallationRows(database, transformedTables, by),
  );
  const transformedBackup: BackupData = {
    ...backup,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tables: checked.tables,
  };

  // Validate structure — tables present in backup must be arrays
  for (const tableName of VERSION_TABLE_NAMES) {
    if (
      transformedBackup.tables[tableName] !== undefined &&
      !Array.isArray(transformedBackup.tables[tableName])
    ) {
      throw new Error(`Backup table ${tableName} data must be an array`);
    }
  }

  const result = isPostgres()
    ? await importBackupPg(database, transformedBackup)
    : await importBackupSqlite(database, transformedBackup);
  // The backup's reference rows replaced today's (see restoreVersion).
  await reconcileReferenceData(database);
  return { ...result, valueNotes: checked.valueNotes };
}

async function importBackupPg(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
): Promise<{ restoredTables: number; restoredRows: number }> {
  // Use a dedicated connection so TRUNCATE, SET session_replication_role,
  // and all INSERTs run on the same connection in a single transaction.
  const { pool } = await import("../index");
  if (!pool)
    throw new Error(
      "PG pool not available — importBackupPg requires PostgreSQL",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET session_replication_role = 'replica'");

    // Truncate all tables
    const allTableNames = VERSION_TABLE_NAMES.map((n) => `"${n}"`).join(", ");
    await client.query(`TRUNCATE ${allTableNames} CASCADE`);

    let restoredRows = 0;
    const sortedTables = [...VERSION_TABLES].sort((a, b) => a.tier - b.tier);

    const jsonbCols = await jsonbColumnsOnClient(
      client,
      sortedTables.map((t) => t.name),
    );

    for (const tableEntry of sortedTables) {
      const rows = backup.tables[tableEntry.name] as Record<string, unknown>[]; // an older backup lacks newer tables
      if (!rows || rows.length === 0) continue;

      const tableJsonbCols = jsonbCols.get(tableEntry.name) ?? new Map();
      const columns = unionColumns(rows);
      validateColumns(tableEntry.name, columns);
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const BATCH_SIZE = 500;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const params: unknown[] = [];
        const valueClauses = batch.map((row) => {
          const placeholders = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined)
              return missingJsonb(tableJsonbCols.get(col));
            if (tableJsonbCols.has(col)) {
              params.push(encodeJsonbForPgImport(val, backup.sourceDialect));
              return `$${params.length}::jsonb`;
            }
            params.push(val);
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await client.query(
          `INSERT INTO "${tableEntry.name}" (${colList}) VALUES ${valueClauses.join(", ")}`,
          params,
        );
        restoredRows += batch.length;
      }
    }

    // Reset serial sequences
    for (const tableName of tablesWithIdColumn(VERSION_TABLE_NAMES)) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1, false)`,
      );
    }

    await client.query("SET session_replication_role = 'origin'");
    await client.query("COMMIT");

    // Log import (non-critical)
    try {
      await database.insert(schema.changeLog).values({
        tableName: "state_versions",
        recordId: 0,
        fieldName: "import",
        oldValue: null,
        newValue: {
          action: "import",
          exportedAt: backup.exportedAt,
          // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM jsonb column requires unknown type
        } as unknown,
        changedBy: "system",
      });
    } catch {
      // Non-critical
    }

    return { restoredTables: sortedTables.length, restoredRows };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await client
      .query("SET session_replication_role = 'origin'")
      .catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function importBackupSqlite(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
): Promise<{ restoredTables: number; restoredRows: number }> {
  const source = backup.sourceDialect;
  let restoredRows = 0;
  const sortedTables = [...VERSION_TABLES].sort((a, b) => a.tier - b.tier);

  await database.transaction(async (tx) => {
    await truncateTables(tx, VERSION_TABLE_NAMES);

    for (const tableEntry of sortedTables) {
      const rows = backup.tables[tableEntry.name] as Record<string, unknown>[]; // an older backup lacks newer tables
      if (!rows || rows.length === 0) continue;

      restoredRows += await insertRows(tx, tableEntry.name, rows, source);
    }

    // Log import (non-critical)
    try {
      await tx.insert(schema.changeLog).values({
        tableName: "state_versions",
        recordId: 0,
        fieldName: "import",
        oldValue: null,
        newValue: {
          action: "import",
          exportedAt: backup.exportedAt,
          // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM jsonb column requires unknown type
        } as unknown,
        changedBy: "system",
      });
    } catch {
      // Non-critical
    }
  });

  return { restoredTables: sortedTables.length, restoredRows };
}
