/**
 * Router test harness — creates an isolated SQLite database for each test suite,
 * applies migrations, and provides a tRPC caller with admin/viewer sessions.
 *
 * Usage:
 *   const { caller, db, cleanup } = await createTestCaller();
 *   const result = await caller.budget.listProfiles();
 *   cleanup();
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Session } from "next-auth";
// eslint-disable-next-line no-restricted-imports -- test harness needs Permission type
import type { Permission } from "@/server/auth";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

// Import schema for SQLite
import * as sqliteSchema from "@/lib/db/schema-sqlite";

// Import tRPC caller factory
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/routers";

// Type alias — the caller factory expects the PG-typed db, but at runtime we pass SQLite.
// This is the same pattern used in production (schema.ts does `as typeof pg`).
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as pgSchema from "@/lib/db/schema-pg";

type DbType = NodePgDatabase<typeof pgSchema>;

export const adminSession: Session = {
  user: {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@test.local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

export const viewerSession: Session = {
  user: {
    id: "test-viewer",
    name: "Test Viewer",
    email: "viewer@test.local",
    role: "viewer",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

export function createViewerSessionWithPermissions(
  permissions: Permission[],
): Session {
  return {
    user: {
      id: "test-viewer",
      name: "Test Viewer",
      email: "viewer@test.local",
      role: "viewer",
      permissions,
    },
    expires: "2099-12-31T23:59:59.999Z",
  };
}

interface TestCaller {
  caller: ReturnType<ReturnType<typeof createCallerFactory>>;
  db: BetterSQLite3Database<typeof sqliteSchema>;
  rawDb: DbType;
  sqlite: InstanceType<typeof Database>;
  cleanup: () => void;
}

/**
 * Creates an isolated test environment with:
 * - A temp SQLite database with all migrations applied
 * - A tRPC caller bound to an admin session
 * - A cleanup function to close the DB and delete the file
 */
export async function createTestCaller(
  session: Session = adminSession,
): Promise<TestCaller> {
  // Create temp file for SQLite — using a file (not :memory:) because
  // some operations may need multiple connections.
  const tmpDir = path.join(process.cwd(), "tests", ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const dbPath = path.join(
    tmpDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema: sqliteSchema });

  // Apply SQLite migrations
  migrate(db, { migrationsFolder: "./drizzle-sqlite" });

  // Seed essential reference data (contribution limits, tax brackets)
  const seedPath = path.resolve("seed-reference-data.sql");
  if (fs.existsSync(seedPath)) {
    const seedSql = fs.readFileSync(seedPath, "utf-8");
    try {
      sqlite.exec(seedSql);
    } catch {
      // May fail if tables don't exist in SQLite or syntax differs — non-fatal
    }
  }

  // Cast to PG type (same pattern as production schema.ts)
  // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM requires this cast for SQLite-to-PG type compatibility in test harness
  const rawDb = db as unknown as DbType;

  // Create tRPC caller
  const createCaller = createCallerFactory(appRouter);
  const caller = createCaller({
    db: rawDb,
    session,
    demoSchema: null,
  });

  const cleanup = () => {
    try {
      sqlite.close();
    } catch {
      // Already closed
    }
    try {
      fs.unlinkSync(dbPath);
      // Also clean up WAL and SHM files
      try {
        fs.unlinkSync(dbPath + "-wal");
      } catch {
        /* may not exist */
      }
      try {
        fs.unlinkSync(dbPath + "-shm");
      } catch {
        /* may not exist */
      }
    } catch {
      // File already deleted
    }
  };

  return { caller, db, rawDb, sqlite, cleanup };
}

/**
 * Seed a person into the test database (many routers require at least one person).
 */
export async function seedPerson(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  name = "Test Person",
  dateOfBirth = "1990-01-01",
): Promise<number> {
  const result = db
    .insert(sqliteSchema.people)
    .values({ name, dateOfBirth })
    .returning({ id: sqliteSchema.people.id })
    .get();
  return result.id;
}

/**
 * Seed a budget profile with optional items.
 */
export async function seedBudgetProfile(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  name = "Test Budget",
  isActive = true,
): Promise<number> {
  const result = db
    .insert(sqliteSchema.budgetProfiles)
    .values({
      name,
      isActive: isActive ? 1 : 0,
      columnLabels: JSON.stringify(["Standard"]),
    })
    .returning({ id: sqliteSchema.budgetProfiles.id })
    .get();
  return result.id;
}
