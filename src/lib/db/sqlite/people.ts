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
// 1. People & Jobs
// ────────────────────────────────────────────────────────────────────────────

export const people = sqliteTable("people", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  isPrimaryUser: integer("is_primary_user", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    employerName: text("employer_name").notNull(),
    title: text("title"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    /** A permanent placeholder job that Salary Profiles use for what-if scenarios, never a real
     *  one: endDate is always null, but "active job" lookups skip it (findActiveJob /
     *  filterActiveJobs in lib/pure/household/profiles.ts). */
    isSpeculative: integer("is_speculative", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("jobs_person_id_idx").on(table.personId),
    index("jobs_is_speculative_idx").on(table.isSpeculative),
    // Exactly one speculative job per person — a DB-enforced invariant, not
    // just an app convention.
    uniqueIndex("jobs_one_speculative_per_person_idx")
      .on(table.personId)
      .where(sql`${table.isSpeculative} = true`),
  ],
);
