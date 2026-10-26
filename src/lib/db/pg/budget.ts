// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type {
  BudgetApiService,
  ApiSyncDirection,
} from "@/lib/config/enum-values";
import { contributionAccounts } from "./contributions";

// ────────────────────────────────────────────────────────────────────────────
// 3. Budget
// ────────────────────────────────────────────────────────────────────────────

export const budgetProfiles = pgTable(
  "budget_profiles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    columnLabels: jsonb("column_labels").$type<string[]>().notNull(),
    columnMonths: jsonb("column_months").$type<number[]>(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("budget_profiles_is_active_idx").on(table.isActive)],
);

export const budgetItems = pgTable(
  "budget_items",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    amounts: jsonb("amounts").$type<number[]>().notNull(),
    apiCategoryName: text("api_category_name"),
    apiCategoryId: text("api_category_id"),
    apiLastSyncedAt: timestamp("api_last_synced_at", { withTimezone: true }),
    apiSyncDirection: text("api_sync_direction")
      .$type<ApiSyncDirection>()
      .default("pull"),
    contributionAccountId: integer("contribution_account_id").references(
      () => contributionAccounts.id,
      { onDelete: "set null" },
    ),
    isEssential: boolean("is_essential").notNull().default(true),
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
export const budgetItemCategoryLinks = pgTable(
  "budget_item_category_links",
  {
    id: serial("id").primaryKey(),
    budgetItemId: integer("budget_item_id")
      .notNull()
      .references(() => budgetItems.id, { onDelete: "cascade" }),
    service: text("service").notNull().$type<BudgetApiService>(),
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
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
