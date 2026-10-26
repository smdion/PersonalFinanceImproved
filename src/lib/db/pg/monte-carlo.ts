// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { CompositionBucket } from "@/lib/config/enum-values";

// ────────────────────────────────────────────────────────────────────────────
// 15. Monte Carlo (asset classes + presets + glide paths)
// ────────────────────────────────────────────────────────────────────────────

export const assetClassParams = pgTable(
  "asset_class_params",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    meanReturn: decimal("mean_return", { precision: 12, scale: 6 }).notNull(),
    stdDev: decimal("std_dev", { precision: 12, scale: 6 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("asset_class_params_is_active_idx").on(table.isActive)],
);

/**
 * Which asset class each composition bucket of a fund's holdings counts
 * toward (a bucket feeds at most one class; a class can take several — e.g.
 * US and international bonds into one bonds class). No row = left out of
 * the mix-vs-target comparison.
 */
export const assetClassBuckets = pgTable(
  "asset_class_buckets",
  {
    bucket: text("bucket").$type<CompositionBucket>().primaryKey(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
  },
  (table) => [index("asset_class_buckets_class_idx").on(table.assetClassId)],
);

export const assetClassCorrelations = pgTable(
  "asset_class_correlations",
  {
    id: serial("id").primaryKey(),
    classAId: integer("class_a_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    classBId: integer("class_b_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    correlation: decimal("correlation", { precision: 12, scale: 6 }).notNull(),
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

export const glidePathAllocations = pgTable(
  "glide_path_allocations",
  {
    id: serial("id").primaryKey(),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimal("allocation", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("glide_path_age_class_idx").on(table.age, table.assetClassId),
    index("glide_path_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: Presets (DB-driven, replaces hardcoded MC_PRESETS) ---

export const mcPresets = pgTable(
  "mc_presets",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(), // 'aggressive', 'default', 'conservative'
    label: text("label").notNull(),
    description: text("description").notNull(),
    returnMultiplier: decimal("return_multiplier", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    volMultiplier: decimal("vol_multiplier", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    inflationMean: decimal("inflation_mean", { precision: 12, scale: 6 })
      .notNull()
      .default("0.025000"),
    inflationStdDev: decimal("inflation_std_dev", { precision: 12, scale: 6 })
      .notNull()
      .default("0.012000"),
    defaultTrials: integer("default_trials").notNull().default(5000),
    returnClampMin: decimal("return_clamp_min", { precision: 12, scale: 6 })
      .notNull()
      .default("-0.500000"),
    returnClampMax: decimal("return_clamp_max", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("mc_presets_is_active_idx").on(table.isActive)],
);

export const mcPresetGlidePaths = pgTable(
  "mc_preset_glide_paths",
  {
    id: serial("id").primaryKey(),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimal("allocation", { precision: 12, scale: 6 }).notNull(),
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

export const mcPresetReturnOverrides = pgTable(
  "mc_preset_return_overrides",
  {
    id: serial("id").primaryKey(),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    meanReturn: decimal("mean_return", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_ro_idx").on(table.presetId, table.assetClassId),
    index("mc_preset_ro_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: User-created simulation presets ---

export const mcUserPresets = pgTable("mc_user_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  simulations: integer("simulations").notNull().default(1000),
  returnMean: decimal("return_mean", { precision: 12, scale: 6 }).notNull(),
  returnStdDev: decimal("return_std_dev", {
    precision: 12,
    scale: 6,
  }).notNull(),
  inflationMean: decimal("inflation_mean", {
    precision: 12,
    scale: 6,
  }).notNull(),
  inflationStdDev: decimal("inflation_std_dev", {
    precision: 12,
    scale: 6,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Contribution profiles (what-if contribution overrides) ---
