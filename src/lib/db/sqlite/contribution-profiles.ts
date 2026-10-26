// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import type {
  PayPeriod,
  PayWeek,
  W4FilingStatus,
  BonusDestination,
} from "@/lib/config/enum-values";
import type { EntityFieldMap } from "./scenarios";
import type { ExtraPaycheckRoutingData } from "./shared";

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
//
// A first-class sibling of Budget Profile / Contribution Profile: a named set
// of per-job salary ENTRIES that any page can preview under. Deliberately
// separate from contribution_profiles so "what if I earned X" and "what if I
// contributed Y" are two independent axes rather than one coupled entity.
//
// Every profile is an ordinary row — there is no `isDefault` column and no
// synthetic id-0 "Live" row. An id either resolves to a real row or is an
// error; it is never a sentinel.
//
// A job carries no salary or bonus terms of its own. `salaries` is a jobId →
// COMPLETE entry map — see the docblock on the column below.

export const salaryProfiles = sqliteTable("salary_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** jobId → complete salary entry. A job either has every required field
   *  (plus the optional `bonusDestination`/`otherEarnings`, absent = budget /
   *  none) — a real, complete number/election for this profile — or no key at all
   *  (this profile says nothing about that job — contributes $0, not a
   *  fallback to some other value). No partial entries — see
   *  salaryEntriesSchema in json-schemas.ts. */
  salaries: text("salaries", { mode: "json" })
    .$type<
      Record<
        string,
        {
          salary: number;
          bonusPercent: number;
          bonusMultiplier: number;
          monthsInBonusYear: number;
          bonusOverride: number | null;
          payPeriod: PayPeriod;
          payWeek: PayWeek;
          anchorPayDate: string | null;
          budgetPeriodsPerMonth: number | null;
          w4FilingStatus: W4FilingStatus;
          w4Box2cChecked: boolean;
          additionalFedWithholding: number;
          bonusMonth: number | null;
          bonusDayOfMonth: number | null;
          extraPaycheckRouting: ExtraPaycheckRoutingData | null;
          /** Where the bonus goes; absent = the budget. */
          bonusDestination?: BonusDestination;
          /** Other pay per check, by paycheck_earnings id; absent = none. */
          otherEarnings?: Record<string, number>;
        }
      >
    >()
    .notNull()
    .default(sql`'{}'`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- State versions (full-database versioning) ---
