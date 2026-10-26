// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────────
// 17. State versions (backup / restore)
// ────────────────────────────────────────────────────────────────────────────

export const stateVersions = sqliteTable(
  "state_versions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    versionType: text("version_type").notNull(), // 'auto' | 'manual'
    schemaVersion: text("schema_version").notNull(),
    tableCount: integer("table_count").notNull(),
    totalRows: integer("total_rows").notNull(),
    sizeEstimateBytes: integer("size_estimate_bytes"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("state_versions_created_at_idx").on(table.createdAt)],
);

export const stateVersionTables = sqliteTable(
  "state_version_tables",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => stateVersions.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    rowCount: integer("row_count").notNull(),
    data: text("data", { mode: "json" }).$type<unknown[]>().notNull(),
  },
  (table) => [
    index("state_version_tables_version_id_idx").on(table.versionId),
    uniqueIndex("state_version_tables_version_table_idx").on(
      table.versionId,
      table.tableName,
    ),
  ],
);

// --- Change log ---

export const changeLog = sqliteTable(
  "change_log",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(),
    recordId: integer("record_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value", { mode: "json" }),
    newValue: text("new_value", { mode: "json" }),
    changedBy: text("changed_by").notNull(),
    changedAt: integer("changed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("change_log_table_record_idx").on(table.tableName, table.recordId),
    index("change_log_changed_at_idx").on(table.changedAt),
  ],
);
