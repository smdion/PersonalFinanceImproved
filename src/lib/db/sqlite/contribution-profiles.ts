// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import type { EntityFieldMap } from "./scenarios";

// ────────────────────────────────────────────────────────────────────────────
// 16. Contribution profiles
// ────────────────────────────────────────────────────────────────────────────

export const contributionProfiles = sqliteTable("contribution_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  contributionActiveFields: text("contribution_active_fields", { mode: "json" })
    .$type<EntityFieldMap>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- Salary profiles (per-job salary entries) ---
// A named set of per-job salary entries, independent of contribution_profiles. Every profile is
// an ordinary row (no isDefault, no id-0 "Live" sentinel); a job has no salary terms of its own.

export const salaryProfiles = sqliteTable("salary_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** jobId → a complete salary entry (every required field; optional `bonusDestination` /
   *  `otherEarnings` absent = budget / none), or no key: the job contributes $0 here. No
   *  partial entries (salaryEntriesSchema). */
  salaries: text("salaries", { mode: "json" })
    .$type<Record<string, SalaryEntry>>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- State versions (full-database versioning) ---
