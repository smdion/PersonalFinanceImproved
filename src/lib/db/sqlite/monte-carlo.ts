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
import { decimalText } from "../sqlite-decimal";

import type { CompositionBucket } from "@/lib/config/enum-values";

// ────────────────────────────────────────────────────────────────────────────
// 15. Monte Carlo (asset classes + presets + glide paths)
// ────────────────────────────────────────────────────────────────────────────

export const assetClassParams = sqliteTable(
  "asset_class_params",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    meanReturn: decimalText("mean_return").notNull(),
    stdDev: decimalText("std_dev").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("asset_class_params_is_active_idx").on(table.isActive)],
);

/**
 * The asset class each holdings-composition bucket counts toward (one per bucket; a class may
 * take several). No row = left out of the mix-vs-target comparison.
 */
export const assetClassBuckets = sqliteTable(
  "asset_class_buckets",
  {
    bucket: text("bucket").$type<CompositionBucket>().primaryKey(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
  },
  (table) => [index("asset_class_buckets_class_idx").on(table.assetClassId)],
);

export const assetClassCorrelations = sqliteTable(
  "asset_class_correlations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    classAId: integer("class_a_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    classBId: integer("class_b_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    correlation: decimalText("correlation").notNull(),
  },
  (table) => [
    uniqueIndex("asset_class_correlations_pair_idx").on(
      table.classAId,
      table.classBId,
    ),
    index("asset_class_correlations_class_a_idx").on(table.classAId),
    index("asset_class_correlations_class_b_idx").on(table.classBId),
  ],
);

export const glidePathAllocations = sqliteTable(
  "glide_path_allocations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimalText("allocation").notNull(),
  },
  (table) => [
    uniqueIndex("glide_path_age_class_idx").on(table.age, table.assetClassId),
    index("glide_path_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: Presets (DB-driven, replaces hardcoded MC_PRESETS) ---

export const simulationPresets = sqliteTable(
  "mc_presets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(), // 'aggressive', 'default', 'conservative'
    label: text("label").notNull(),
    description: text("description").notNull(),
    returnMultiplier: decimalText("return_multiplier")
      .notNull()
      .default("1.000000"),
    volMultiplier: decimalText("vol_multiplier").notNull().default("1.000000"),
    inflationMean: decimalText("inflation_mean").notNull().default("0.025000"),
    inflationStdDev: decimalText("inflation_std_dev")
      .notNull()
      .default("0.012000"),
    defaultTrials: integer("default_trials").notNull().default(5000),
    returnClampMin: decimalText("return_clamp_min")
      .notNull()
      .default("-0.500000"),
    returnClampMax: decimalText("return_clamp_max")
      .notNull()
      .default("1.000000"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("mc_presets_is_active_idx").on(table.isActive)],
);

export const simulationPresetGlidePaths = sqliteTable(
  "mc_preset_glide_paths",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    presetId: integer("preset_id")
      .notNull()
      .references(() => simulationPresets.id, { onDelete: "cascade" }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimalText("allocation").notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_gp_idx").on(
      table.presetId,
      table.age,
      table.assetClassId,
    ),
    index("mc_preset_gp_preset_idx").on(table.presetId),
    index("mc_preset_gp_asset_class_idx").on(table.assetClassId),
  ],
);

export const simulationPresetReturnOverrides = sqliteTable(
  "mc_preset_return_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    presetId: integer("preset_id")
      .notNull()
      .references(() => simulationPresets.id, { onDelete: "cascade" }),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    meanReturn: decimalText("mean_return").notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_ro_idx").on(table.presetId, table.assetClassId),
    index("mc_preset_ro_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: User-created simulation presets ---

export const simulationUserPresets = sqliteTable("mc_user_presets", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  simulations: integer("simulations").notNull().default(1000),
  returnMean: decimalText("return_mean").notNull(),
  returnStdDev: decimalText("return_std_dev").notNull(),
  inflationMean: decimalText("inflation_mean").notNull(),
  inflationStdDev: decimalText("inflation_std_dev").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- Contribution profiles (what-if contribution overrides) ---
