/**
 * Validate that all Drizzle migrations apply cleanly to a fresh SQLite database.
 * Catches broken migrations, syntax errors, and ordering issues.
 *
 * Run: tsx scripts/check-migrations.ts
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

// Use SQLite migrations for validation (CI runs against fresh SQLite DB)
const migrationsDir = path.join(process.cwd(), "drizzle-sqlite");
const metaDir = path.join(migrationsDir, "meta");

if (!fs.existsSync(migrationsDir) || !fs.existsSync(metaDir)) {
  console.log("No drizzle/meta/ directory found — skipping migration check.");
  process.exit(0);
}

// Read journal to get ordered migration list
const journalPath = path.join(metaDir, "_journal.json");
if (!fs.existsSync(journalPath)) {
  console.error("ERROR: drizzle/meta/_journal.json not found");
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entries: { tag: string }[] = journal.entries ?? [];

if (entries.length === 0) {
  console.log("No migrations found in journal.");
  process.exit(0);
}

// Create in-memory SQLite database
const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create drizzle migration tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at NUMERIC
  );
`);

let applied = 0;
let errors = 0;
const dangerousPatterns = [
  { pattern: /DROP\s+TABLE/i, label: "DROP TABLE" },
  { pattern: /DROP\s+COLUMN/i, label: "DROP COLUMN" },
  { pattern: /ALTER\s+COLUMN.*TYPE/i, label: "ALTER COLUMN TYPE" },
];

console.log(
  `Checking ${entries.length} migrations against fresh SQLite DB...\n`,
);

for (const entry of entries) {
  const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlFile)) {
    console.error(`  ERROR: Migration file not found: ${entry.tag}.sql`);
    errors++;
    continue;
  }

  const sql = fs.readFileSync(sqlFile, "utf8");

  // Check for dangerous operations
  const warnings: string[] = [];
  for (const { pattern, label } of dangerousPatterns) {
    if (pattern.test(sql)) {
      warnings.push(label);
    }
  }

  try {
    // SQLite: execute each statement individually
    // Drizzle uses "--> statement-breakpoint" as separator in generated migrations
    const statements = sql
      .split(/-->\s*statement-breakpoint\s*|;\s*\n/)
      .map((s) => s.trim())
      // Strip leading SQL comment lines so a file-level header that lands in
      // the same chunk as the first real statement is not mistaken for a
      // comment-only chunk and silently dropped.
      .map((s) => s.replace(/^(--[^\n]*\n\s*)*/g, "").trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      // Skip PostgreSQL-specific syntax that SQLite can't handle
      if (
        /CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt) &&
        /CONCURRENTLY/i.test(stmt)
      ) {
        // Strip CONCURRENTLY for SQLite
        db.exec(stmt.replace(/CONCURRENTLY\s+/i, ""));
      } else if (/DO\s+\$\$/i.test(stmt)) {
        // Skip PL/pgSQL blocks
        continue;
      } else if (/ALTER\s+TABLE.*ALTER\s+COLUMN/i.test(stmt)) {
        // SQLite doesn't support ALTER COLUMN — skip but log
        continue;
      } else if (/CREATE\s+TYPE/i.test(stmt) || /DROP\s+TYPE/i.test(stmt)) {
        // Skip enum type operations (PostgreSQL-only)
        continue;
      } else {
        db.exec(stmt);
      }
    }

    const warningStr =
      warnings.length > 0 ? ` [WARN: ${warnings.join(", ")}]` : "";
    console.log(`  OK  ${entry.tag}${warningStr}`);
    applied++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL ${entry.tag}: ${msg}`);
    errors++;
  }
}

db.close();

console.log(
  `\n${applied} applied, ${errors} failed out of ${entries.length} total.`,
);

if (errors > 0) {
  console.log("Migration safety check FAILED.");
  process.exit(1);
} else {
  console.log("Migration safety check PASSED.");
}
