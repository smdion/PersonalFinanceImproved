/**
 * Generates schema-sqlite.ts from schema-pg.ts by mechanical text transformation.
 * Run with: npx tsx scripts/gen-sqlite-schema.ts
 *
 * Column type mappings:
 *   serial("id").primaryKey()          → integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })
 *   decimal("col", { ... })            → text("col")     (preserves string type for precision)
 *   boolean("col")                     → integer("col", { mode: "boolean" })
 *   date("col")                        → text("col")     (ISO date strings)
 *   timestamp("col", { ... })          → integer("col", { mode: "timestamp" })  (unix seconds → Date)
 *   jsonb("col")                       → text("col", { mode: "json" })
 *   varchar("col", { length: N })      → text("col")
 *   pgTable                            → sqliteTable
 *   .defaultNow()                      → .default(sql`(unixepoch())`)
 */

import * as fs from "fs";
import * as path from "path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/db/schema-pg.ts"),
  "utf-8",
);

let out = src;

// --- Header ---
out = out.replace(
  /\/\/ Drizzle schema — all table definitions for ledgr\.\n\/\/ This file is the single source of truth for the data model\.\n\/\/ See Migration Plan Section 4 for design principles and seed data notes\./,
  "// AUTO-GENERATED from schema-pg.ts — do not edit by hand.\n// Run: npx tsx scripts/gen-sqlite-schema.ts\n// SQLite dialect of the Drizzle schema.",
);

// --- Import statement ---
out = out.replace(
  /import \{\n\s+pgTable,\n\s+serial,\n\s+text,\n\s+integer,\n\s+boolean,\n\s+date,\n\s+timestamp,\n\s+decimal,\n\s+varchar,\n\s+jsonb,\n\s+uniqueIndex,\n\s+index,\n\s+check,\n\} from "drizzle-orm\/pg-core";/,
  `import {\n  sqliteTable,\n  text,\n  integer,\n  uniqueIndex,\n  index,\n  check,\n} from "drizzle-orm/sqlite-core";`,
);

// --- pgTable → sqliteTable ---
out = out.replace(/pgTable\(/g, "sqliteTable(");

// --- serial("id").primaryKey() → integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }) ---
out = out.replace(
  /serial\("id"\)\.primaryKey\(\)/g,
  'integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })',
);

// --- timestamp("col", { withTimezone: true }).notNull().defaultNow() ---
// Must come before generic timestamp replacement
out = out.replace(
  /timestamp\("([^"]+)",\s*\{[^}]*\}\)\.notNull\(\)\.defaultNow\(\)/g,
  'integer("$1", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`)',
);

// --- timestamp("col", { withTimezone: true }) (nullable, no default) ---
out = out.replace(
  /timestamp\("([^"]+)",\s*\{[^}]*\}\)/g,
  'integer("$1", { mode: "timestamp" })',
);

// --- decimal("col", { precision: X, scale: Y }) → text("col") ---
// Handle multi-line decimal declarations
out = out.replace(
  /decimal\("([^"]+)",\s*\{[^}]*\}\)/g,
  'text("$1")',
);

// --- jsonb("col") → text("col", { mode: "json" }) ---
// Single-line form
out = out.replace(
  /jsonb\("([^"]+)"\)/g,
  'text("$1", { mode: "json" })',
);
// Multi-line form: jsonb(\n  "col",\n)
out = out.replace(
  /jsonb\(\s*\n\s*"([^"]+)",?\s*\n\s*\)/g,
  'text(\n      "$1", { mode: "json" },\n    )',
);

// --- boolean("col") → integer("col", { mode: "boolean" }) ---
out = out.replace(
  /boolean\("([^"]+)"\)/g,
  'integer("$1", { mode: "boolean" })',
);

// --- date("col") → text("col") ---
// Only match standalone date() calls, not "updated_at" etc.
out = out.replace(
  /\bdate\("([^"]+)"\)/g,
  'text("$1")',
);

// --- varchar("col", { length: N }) → text("col") ---
out = out.replace(
  /varchar\("([^"]+)",\s*\{[^}]*\}\)/g,
  'text("$1")',
);

// --- .default({}) for json columns needs sql wrapper ---
// jsonb default {} becomes text default — need to stringify
out = out.replace(
  /\.default\(\{\}\)/g,
  ".default(sql`'{}'`)",
);

// --- .defaultNow() remaining (multi-line timestamp patterns) ---
out = out.replace(
  /\.defaultNow\(\)/g,
  ".default(sql`(unixepoch())`)",
);

// --- Write output ---
const outPath = path.resolve(__dirname, "../src/lib/db/schema-sqlite.ts");
fs.writeFileSync(outPath, out, "utf-8");
console.log(`Generated ${outPath}`);
