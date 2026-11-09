// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { jsonb } from "../pg-jsonb";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import type { EntityFieldMap } from "./scenarios";

// ────────────────────────────────────────────────────────────────────────────
// 16. Contribution profiles
// ────────────────────────────────────────────────────────────────────────────

export const contributionProfiles = pgTable("contribution_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  contributionActiveFields: jsonb("contribution_active_fields")
    .$type<EntityFieldMap>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Salary profiles (per-job salary entries) ---
// A named set of per-job salary entries, independent of contribution_profiles. Every profile is
// an ordinary row (no isDefault, no id-0 "Live" sentinel); a job has no salary terms of its own.

export const salaryProfiles = pgTable("salary_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** jobId → a complete salary entry (every required field; optional `bonusDestination` /
   *  `otherEarnings` absent = budget / none), or no key: the job contributes $0 here. No
   *  partial entries (salaryEntriesSchema). */
  salaries: jsonb("salaries")
    .$type<Record<string, SalaryEntry>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- State versions (full-database versioning) ---
