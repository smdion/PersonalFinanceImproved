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

import type {
  BudgetApiService,
  ApiSyncDirection,
} from "@/lib/config/enum-values";
import { contributionAccounts } from "./contributions";

// ────────────────────────────────────────────────────────────────────────────
// 3. Budget
// ────────────────────────────────────────────────────────────────────────────

export const budgetProfiles = sqliteTable(
  "budget_profiles",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    description: text("description"),
    columnLabels: text("column_labels", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    columnMonths: text("column_months", { mode: "json" }).$type<number[]>(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("budget_profiles_is_active_idx").on(table.isActive)],
);

export const budgetItems = sqliteTable(
  "budget_items",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    amounts: text("amounts", { mode: "json" }).$type<number[]>().notNull(),
    apiCategoryName: text("api_category_name"),
    apiCategoryId: text("api_category_id"),
    apiLastSyncedAt: integer("api_last_synced_at", { mode: "timestamp" }),
    apiSyncDirection: text("api_sync_direction")
      .$type<ApiSyncDirection>()
      .default("pull"),
    contributionAccountId: integer("contribution_account_id").references(
      () => contributionAccounts.id,
      { onDelete: "set null" },
    ),
    isEssential: integer("is_essential", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("budget_items_profile_id_idx").on(table.profileId),
    index("budget_items_contribution_account_id_idx").on(
      table.contributionAccountId,
    ),
    uniqueIndex("budget_items_profile_cat_sub_idx").on(
      table.profileId,
      table.category,
      table.subcategory,
    ),
  ],
);

// One row per (budget item, service) — replaces the old single-slot
// apiCategoryId/apiCategoryName/apiLastSyncedAt/apiSyncDirection columns on
// budgetItems, which could only hold ONE service's link at a time and
// silently clobbered it when a household linked the same item to a second
// service (YNAB + Actual both connected). Those columns stay on budgetItems,
// dead-but-present for now; cleanup deferred to a future schema
// squash (see retirement_settings.person_id's precedent).
export const budgetItemCategoryLinks = sqliteTable(
  "budget_item_category_links",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    budgetItemId: integer("budget_item_id")
      .notNull()
      .references(() => budgetItems.id, { onDelete: "cascade" }),
    service: text("service").notNull().$type<BudgetApiService>(),
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    syncDirection: text("sync_direction").$type<ApiSyncDirection>(),
  },
  (table) => [
    index("budget_item_category_links_budget_item_id_idx").on(
      table.budgetItemId,
    ),
    uniqueIndex("budget_item_category_links_item_service_idx").on(
      table.budgetItemId,
      table.service,
    ),
  ],
);
