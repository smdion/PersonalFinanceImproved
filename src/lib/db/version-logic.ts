/**
 * Core version logic: create, restore, export, import.
 *
 * All operations use transactions for consistency.
 * PG restore uses a dedicated client connection for SERIALIZABLE isolation.
 * SQLite restore relies on single-writer semantics (WAL mode).
 *
 * IMPORTANT: All state versions live in the same database. Database-level
 * corruption (disk failure, unrecoverable WAL) would lose both live data and all
 * snapshots. For disaster recovery, pair this with external backups (pg_dump cron,
 * WAL archiving, volume-level snapshots, or SQLite file copies). See homelab-docs
 * backup-definitions for the container's backup schedule. (Review item H15)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { sql, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { isPostgres } from "./dialect";
import { truncateTables, resetSequences, jsonbLiteral, validateColumns } from "./compat";
import { VERSION_TABLE_NAMES, VERSION_TABLES } from "./version-tables";
import { log } from "@/lib/logger";

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
    const entries = journal.entries;
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
    const tableData: { tableName: string; rows: unknown[]; rowCount: number }[] =
      [];

    for (const tableName of VERSION_TABLE_NAMES) {
      try {
        const rows = await tx.execute(
          sql.raw(`SELECT * FROM "${tableName}"`),
        );
        tableData.push({
          tableName,
          rows: rows.rows as unknown[],
          rowCount: rows.rows.length,
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
    // Read retention setting
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
  } catch {
    // Cleanup failures are non-critical
  }
}

export async function restoreVersion(
  database: NodePgDatabase<typeof schema>,
  versionId: number,
): Promise<{ restoredTables: number; restoredRows: number }> {
  // Load version metadata
  const [version] = await database
    .select()
    .from(schema.stateVersions)
    .where(eq(schema.stateVersions.id, versionId));

  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  // Schema drift check
  if (version.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Schema mismatch: version was created at ${version.schemaVersion}, current is ${CURRENT_SCHEMA_VERSION}. Run migrations first.`,
    );
  }

  // Load all table data
  const tableDatas = await database
    .select()
    .from(schema.stateVersionTables)
    .where(eq(schema.stateVersionTables.versionId, versionId));

  const tableDataMap = new Map(tableDatas.map((t) => [t.tableName, t]));

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
      const columns = Object.keys(rows[0]!);
      validateColumns(tableEntry.name, columns);
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const BATCH_SIZE = 500;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const valueClauses = batch.map((row) => {
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
            if (typeof val === "number") return String(val);
            if (typeof val === "object")
              return jsonbLiteral(val);
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          return `(${values.join(", ")})`;
        });
        await tx.execute(
          sql.raw(
            `INSERT INTO "${tableEntry.name}" (${colList}) VALUES ${valueClauses.join(", ")}`,
          ),
        );
        restoredRows += batch.length;
      }
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
        newValue: { action: "restore", versionName: version.name } as unknown,
        changedBy: version.createdBy,
      });
    } catch {
      // Non-critical
    }
  });

  return { restoredTables: tableDatas.length, restoredRows };
}

export type BackupData = {
  schemaVersion: string;
  exportedAt: string;
  tables: Record<string, unknown[]>;
};

export async function exportBackup(
  database: NodePgDatabase<typeof schema>,
): Promise<BackupData> {
  const tables: Record<string, unknown[]> = {};

  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      const result = await database.execute(
        sql.raw(`SELECT * FROM "${tableName}"`),
      );
      tables[tableName] = result.rows as unknown[];
    } catch {
      // Table doesn't exist yet (migration pending) — export empty
      tables[tableName] = [];
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export async function importBackup(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
): Promise<{ restoredTables: number; restoredRows: number }> {
  // Validate schema version
  if (backup.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Schema mismatch: backup was created at ${backup.schemaVersion}, current is ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  // Validate structure — tables present in backup must be arrays
  for (const tableName of VERSION_TABLE_NAMES) {
    if (
      backup.tables[tableName] !== undefined &&
      !Array.isArray(backup.tables[tableName])
    ) {
      throw new Error(`Backup table ${tableName} data must be an array`);
    }
  }

  if (isPostgres()) {
    return importBackupPg(database, backup);
  }
  return importBackupSqlite(database, backup);
}

async function importBackupPg(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
): Promise<{ restoredTables: number; restoredRows: number }> {
  // Use a dedicated connection so TRUNCATE, SET session_replication_role,
  // and all INSERTs run on the same connection in a single transaction.
  const { pool } = await import("./index");
  if (!pool) throw new Error("PG pool not available — importBackupPg requires PostgreSQL");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET session_replication_role = 'replica'");

    // Truncate all tables
    const allTableNames = VERSION_TABLE_NAMES.map((n) => `"${n}"`).join(", ");
    await client.query(`TRUNCATE ${allTableNames} CASCADE`);

    let restoredRows = 0;
    const sortedTables = [...VERSION_TABLES].sort((a, b) => a.tier - b.tier);

    // Cache jsonb column sets per table
    const jsonbCols = new Map<string, Set<string>>();
    for (const t of sortedTables) {
      const { rows: colRows } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'jsonb'`,
        [t.name],
      );
      jsonbCols.set(t.name, new Set(colRows.map((r: { column_name: string }) => r.column_name)));
    }

    for (const tableEntry of sortedTables) {
      const rows = backup.tables[tableEntry.name] as Record<string, unknown>[];
      if (!rows || rows.length === 0) continue;

      const tableJsonbCols = jsonbCols.get(tableEntry.name) ?? new Set();
      const columns = Object.keys(rows[0]!);
      validateColumns(tableEntry.name, columns);
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const BATCH_SIZE = 500;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const params: unknown[] = [];
        const valueClauses = batch.map((row) => {
          const placeholders = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (tableJsonbCols.has(col)) {
              params.push(JSON.stringify(val));
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
    for (const tableName of VERSION_TABLE_NAMES) {
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
        newValue: { action: "import", exportedAt: backup.exportedAt } as unknown,
        changedBy: "system",
      });
    } catch {
      // Non-critical
    }

    return { restoredTables: sortedTables.length, restoredRows };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("SET session_replication_role = 'origin'").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function importBackupSqlite(
  database: NodePgDatabase<typeof schema>,
  backup: BackupData,
): Promise<{ restoredTables: number; restoredRows: number }> {
  let restoredRows = 0;
  const sortedTables = [...VERSION_TABLES].sort((a, b) => a.tier - b.tier);

  await database.transaction(async (tx) => {
    await truncateTables(tx, VERSION_TABLE_NAMES);

    for (const tableEntry of sortedTables) {
      const rows = backup.tables[tableEntry.name] as Record<string, unknown>[];
      if (!rows || rows.length === 0) continue;

      const columns = Object.keys(rows[0]!);
      validateColumns(tableEntry.name, columns);
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const BATCH_SIZE = 500;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const valueClauses = batch.map((row) => {
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "boolean") return val ? "1" : "0";
            if (typeof val === "number") return String(val);
            if (typeof val === "object") return jsonbLiteral(val);
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          return `(${values.join(", ")})`;
        });
        await tx.execute(
          sql.raw(
            `INSERT INTO "${tableEntry.name}" (${colList}) VALUES ${valueClauses.join(", ")}`,
          ),
        );
        restoredRows += batch.length;
      }
    }

    // Log import (non-critical)
    try {
      await tx.insert(schema.changeLog).values({
        tableName: "state_versions",
        recordId: 0,
        fieldName: "import",
        oldValue: null,
        newValue: { action: "import", exportedAt: backup.exportedAt } as unknown,
        changedBy: "system",
      });
    } catch {
      // Non-critical
    }
  });

  return { restoredTables: sortedTables.length, restoredRows };
}
