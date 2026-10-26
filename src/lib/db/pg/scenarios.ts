// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { RelocationScenarioParams } from "./app-config";
import { budgetProfiles } from "./budget";
import { contributionProfiles, salaryProfiles } from "./contribution-profiles";
import { retirementProfiles } from "./retirement";

// ────────────────────────────────────────────────────────────────────────────
// 14. Scenarios (relocation, generic)
// ────────────────────────────────────────────────────────────────────────────

export const relocationScenarios = pgTable("relocation_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  params: jsonb("params").$type<RelocationScenarioParams>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Nested field map: { entityType: { recordId: { field: value } } } — a
 *  Contribution Profile's active fields. */
export type EntityFieldMap = Record<
  string,
  Record<string, Record<string, unknown>>
>;

/** A Plan: a named set of profiles, one of each kind. */
export const scenarios = pgTable(
  "scenarios",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** The Plan's Budget Profile — applying the Plan makes it the active
     *  one (settings.scenarios.activate). Null only on a Plan made before
     *  v0.8.9; applying one leaves that kind's active profile alone. */
    budgetProfileId: integer("budget_profile_id").references(
      () => budgetProfiles.id,
      { onDelete: "set null" },
    ),
    /** The Plan's Contribution Profile — see budgetProfileId. */
    contributionProfileId: integer("contribution_profile_id").references(
      () => contributionProfiles.id,
      { onDelete: "set null" },
    ),
    /** The Plan's Salary Profile — see budgetProfileId. */
    salaryProfileId: integer("salary_profile_id").references(
      () => salaryProfiles.id,
      { onDelete: "set null" },
    ),
    /** The Plan's Retirement Profile — see budgetProfileId. Never backfill
     *  a null to a real id: that would turn "leaves it alone" into "sets
     *  profile 1" for every older Plan. */
    retirementProfileId: integer("retirement_profile_id").references(
      () => retirementProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Plan names are unique (migration 0009 renames duplicates first).
    uniqueIndex("scenarios_name_unique").on(table.name),
    index("scenarios_budget_profile_id_idx").on(table.budgetProfileId),
    index("scenarios_contribution_profile_id_idx").on(
      table.contributionProfileId,
    ),
    index("scenarios_salary_profile_id_idx").on(table.salaryProfileId),
    index("scenarios_retirement_profile_id_idx").on(table.retirementProfileId),
  ],
);

// --- Monte Carlo: Asset class parameters and glide path ---
