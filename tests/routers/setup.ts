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
import { randomBytes } from "node:crypto";

// Set a deterministic-per-process ENCRYPTION_KEY before any module that
// imports src/lib/crypto.ts. Required for sync-connections tests that
// encrypt API credentials at rest. Production reads this from container env.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
}
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Session } from "next-auth";
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

const _callerFactory = createCallerFactory(appRouter);
type CallerType = ReturnType<typeof _callerFactory>;

interface TestCaller {
  caller: CallerType;
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
  const caller = _callerFactory({
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
      isActive,
      columnLabels: ["Standard"],
    })
    .returning({ id: sqliteSchema.budgetProfiles.id })
    .get();
  return result.id;
}

/**
 * Seed a job for a person.
 */
export function seedJob(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  overrides: Partial<typeof sqliteSchema.jobs.$inferInsert> = {},
): number {
  const result = db
    .insert(sqliteSchema.jobs)
    .values({
      personId,
      employerName: "TestCo",
      annualSalary: "120000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "MFJ",
      ...overrides,
    })
    .returning({ id: sqliteSchema.jobs.id })
    .get();
  return result.id;
}

/**
 * Seed a budget item into a profile.
 */
export function seedBudgetItem(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  profileId: number,
  overrides: Partial<typeof sqliteSchema.budgetItems.$inferInsert> = {},
): number {
  const result = db
    .insert(sqliteSchema.budgetItems)
    .values({
      profileId,
      category: "Essentials",
      subcategory: "Groceries",
      amounts: [500],
      ...overrides,
    })
    .returning({ id: sqliteSchema.budgetItems.id })
    .get();
  return result.id;
}

/**
 * Seed a savings goal.
 */
export function seedSavingsGoal(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<typeof sqliteSchema.savingsGoals.$inferInsert> = {},
): number {
  const result = db
    .insert(sqliteSchema.savingsGoals)
    .values({
      name: "Emergency Fund",
      targetAmount: "10000",
      monthlyContribution: "500",
      priority: 1,
      isActive: true,
      ...overrides,
    })
    .returning({ id: sqliteSchema.savingsGoals.id })
    .get();
  return result.id;
}

/**
 * Seed a performance account.
 */
export function seedPerformanceAccount(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<typeof sqliteSchema.performanceAccounts.$inferInsert> = {},
): number {
  const name = overrides.name ?? "401k Account";
  const institution = overrides.institution ?? "Fidelity";
  const result = db
    .insert(sqliteSchema.performanceAccounts)
    .values({
      institution,
      accountType: "401k",
      accountLabel: `${institution} ${name}`,
      ownershipType: "individual",
      parentCategory: "Retirement",
      ...overrides,
    })
    .returning({ id: sqliteSchema.performanceAccounts.id })
    .get();
  return result.id;
}

/**
 * Seed a portfolio snapshot with accounts.
 */
export function seedSnapshot(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  date = "2025-01-15",
  accounts: {
    performanceAccountId: number;
    amount: string;
    taxType?: string;
    institution?: string;
    accountType?: string;
  }[] = [],
): number {
  const snap = db
    .insert(sqliteSchema.portfolioSnapshots)
    .values({ snapshotDate: date })
    .returning({ id: sqliteSchema.portfolioSnapshots.id })
    .get();
  for (const a of accounts) {
    db.insert(sqliteSchema.portfolioAccounts)
      .values({
        snapshotId: snap.id,
        performanceAccountId: a.performanceAccountId,
        amount: a.amount,
        taxType: a.taxType ?? "preTax",
        institution: a.institution ?? "Fidelity",
        accountType: a.accountType ?? "401k",
      })
      .run();
  }
  return snap.id;
}

/**
 * Seed an app setting key-value pair.
 */
export function seedAppSetting(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  key: string,
  value: string,
): void {
  db.insert(sqliteSchema.appSettings).values({ key, value }).run();
}

/**
 * Seed a contribution account.
 */
export function seedContributionAccount(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<
    typeof sqliteSchema.contributionAccounts.$inferInsert
  > = {},
): number {
  const result = db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      name: "401k Contribution",
      category: "401k",
      method: "percent_of_salary",
      value: "0.10",
      taxTreatment: "pre_tax",
      isActive: true,
      ...overrides,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get();
  return result.id;
}

/**
 * Seed a contribution profile.
 */
export function seedContributionProfile(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<
    typeof sqliteSchema.contributionProfiles.$inferInsert
  > = {},
): number {
  const result = db
    .insert(sqliteSchema.contributionProfiles)
    .values({
      name: "Default Profile",
      isActive: true,
      ...overrides,
    })
    .returning({ id: sqliteSchema.contributionProfiles.id })
    .get();
  return result.id;
}

/**
 * Seed a full "standard" dataset: person + job + budget profile + items + savings goal + performance account + snapshot.
 * Returns all IDs for use in tests.
 */
export function seedStandardDataset(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
  const personId = db
    .insert(sqliteSchema.people)
    .values({
      name: "Test Person",
      dateOfBirth: "1990-01-01",
      isPrimaryUser: true,
    })
    .returning({ id: sqliteSchema.people.id })
    .get().id;

  const jobId = seedJob(db, personId);

  const profileId = db
    .insert(sqliteSchema.budgetProfiles)
    .values({ name: "Main Budget", isActive: true, columnLabels: ["Standard"] })
    .returning({ id: sqliteSchema.budgetProfiles.id })
    .get().id;

  const itemIds = [
    seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Rent",
      amounts: [2000],
    }),
    seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Groceries",
      amounts: [600],
    }),
    seedBudgetItem(db, profileId, {
      category: "Lifestyle",
      subcategory: "Dining",
      amounts: [200],
    }),
  ];

  const goalId = seedSavingsGoal(db);

  const perfAcctId = seedPerformanceAccount(db);

  const snapId = seedSnapshot(db, "2025-01-15", [
    { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
  ]);

  return { personId, jobId, profileId, itemIds, goalId, perfAcctId, snapId };
}
