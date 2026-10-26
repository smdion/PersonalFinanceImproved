// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────────
// 1. People & Jobs
// ────────────────────────────────────────────────────────────────────────────

export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  isPrimaryUser: boolean("is_primary_user").notNull().default(false),
});

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    employerName: text("employer_name").notNull(),
    title: text("title"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** A permanent, auto-provisioned peg for Salary Profiles to pin what-if
     *  scenarios against (e.g. "moving to Chicago in 5 years") — never a
     *  real job. Always has endDate: null (it never "ends") but must be
     *  excluded everywhere "active job" means "this person's real job" —
     *  see findActiveJob/filterActiveJobs in lib/pure/profiles.ts, the
     *  single source of truth for that exclusion. */
    isSpeculative: boolean("is_speculative").notNull().default(false),
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
