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
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { applyMigrationsIdempotent } from "../helpers/db-harness";
import type { Permission } from "@/server/auth";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

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

  applyMigrationsIdempotent(sqlite);

  // Monkey-patch db.transaction so routers that use async transaction
  // callbacks (e.g. sync-core's C3 atomic write block) can run under the
  // better-sqlite3 test harness. Production uses Postgres which supports
  // async transactions natively; better-sqlite3 rejects them with
  // "Transaction function cannot return a promise". This stub executes
  // the callback against the outer db (no real atomicity) so the logic
  // inside the transaction is still testable — atomicity itself is
  // verified by the PG-backed deploy smoke tests, not the test suite.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).transaction = async (fn: (tx: unknown) => unknown) => fn(db);

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
 * Write this job's entry into whichever Salary Profile is currently
 * globally-active, so every seedJob call keeps producing a job that
 * resolves to a real salary by default — a job carries no salary of its
 * own any more, so SOME Salary Profile has to carry it, and callers that
 * don't care which one get whatever's already active.
 *
 * Migrations always leave a baseline profile active post-migration (e.g.
 * "Every salary follows its job record" — see 0008_kill_live_sentinel),
 * so the active-profile row already exists before any test runs; this
 * merges into THAT row rather than fighting over a separate one. Only a
 * genuinely fresh DB with no active setting at all gets a brand-new
 * profile created and activated here.
 */
function seedDefaultSalaryProfileEntry(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  jobId: number,
  entry: {
    salary: number;
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
  },
): number {
  const settingRow = db
    .select()
    .from(sqliteSchema.appSettings)
    .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
    .get();
  const activeId = settingRow ? Number(settingRow.value) : NaN;
  const activeProfile = Number.isFinite(activeId)
    ? db
        .select()
        .from(sqliteSchema.salaryProfiles)
        .where(eq(sqliteSchema.salaryProfiles.id, activeId))
        .get()
    : undefined;

  if (activeProfile) {
    const salaries = {
      ...(activeProfile.salaries as Record<string, unknown>),
      [String(jobId)]: entry,
    };
    db.update(sqliteSchema.salaryProfiles)
      .set({ salaries })
      .where(eq(sqliteSchema.salaryProfiles.id, activeProfile.id))
      .run();
    return activeProfile.id;
  }

  const created = db
    .insert(sqliteSchema.salaryProfiles)
    .values({
      name: "Test Default Salary Profile",
      salaries: { [String(jobId)]: entry },
    })
    .returning({ id: sqliteSchema.salaryProfiles.id })
    .get();
  if (settingRow) {
    db.update(sqliteSchema.appSettings)
      .set({ value: String(created.id) })
      .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
      .run();
  } else {
    db.insert(sqliteSchema.appSettings)
      .values({
        key: SK_ACTIVE_SALARY_PROFILE_ID,
        value: String(created.id),
      })
      .run();
  }
  return created.id;
}

/**
 * Seed a job for a person.
 *
 * A job carries no salary of its own any more — `annualSalary`/
 * `bonusPercent`/`bonusMultiplier`/`monthsInBonusYear` here are convenience
 * fields (defaulting to the same values this helper always defaulted to),
 * written as a complete entry into the shared default Salary Profile
 * (see seedDefaultSalaryProfileEntry) instead of a job column, so every
 * existing call site keeps working unchanged. See resolveCompensation's
 * docblock (server/helpers/salary.ts) for why a job needs a Salary Profile
 * entry to resolve to anything but $0.
 */
export function seedJob(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  overrides: Partial<typeof sqliteSchema.jobs.$inferInsert> & {
    annualSalary?: string;
    bonusPercent?: string;
    bonusMultiplier?: string;
    monthsInBonusYear?: number;
  } = {},
): number {
  const {
    annualSalary,
    bonusPercent,
    bonusMultiplier,
    monthsInBonusYear,
    ...jobOverrides
  } = overrides;
  const result = db
    .insert(sqliteSchema.jobs)
    .values({
      personId,
      employerName: "TestCo",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "MFJ",
      ...jobOverrides,
    })
    .returning({ id: sqliteSchema.jobs.id })
    .get();
  seedDefaultSalaryProfileEntry(db, result.id, {
    salary: Number(annualSalary ?? "120000"),
    bonusPercent: Number(bonusPercent ?? "0"),
    bonusMultiplier: Number(bonusMultiplier ?? "1"),
    monthsInBonusYear: monthsInBonusYear ?? 12,
  });
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
      priority: 1,
      isActive: true,
      ...overrides,
    })
    .returning({ id: sqliteSchema.savingsGoals.id })
    .get();
  return result.id;
}

/**
 * Seed a goal's funding for one budget profile — funding
 * (allocationPercent/monthlyContribution) lives entirely on
 * savings_goal_profile_allocations, not on the goal itself, so any test
 * that wants a goal to resolve to a nonzero amount must seed this
 * explicitly for the profile it's testing against.
 */
export function seedSavingsGoalAllocation(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  goalId: number,
  profileId: number,
  overrides: Partial<
    typeof sqliteSchema.savingsGoalProfileAllocations.$inferInsert
  > = {},
): number {
  const result = db
    .insert(sqliteSchema.savingsGoalProfileAllocations)
    .values({
      goalId,
      budgetProfileId: profileId,
      allocationPercent: null,
      monthlyContribution: "0",
      ...overrides,
    })
    .returning({ id: sqliteSchema.savingsGoalProfileAllocations.id })
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
 * Seed a salary profile (the independent "what if I earned X" axis).
 */
export function seedSalaryProfile(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<typeof sqliteSchema.salaryProfiles.$inferInsert> = {},
): number {
  const result = db
    .insert(sqliteSchema.salaryProfiles)
    .values({
      name: "Default Salary Profile",
      salaries: {},
      ...overrides,
    })
    .returning({ id: sqliteSchema.salaryProfiles.id })
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
  seedSavingsGoalAllocation(db, goalId, profileId, {
    monthlyContribution: "500",
  });

  const perfAcctId = seedPerformanceAccount(db);

  const snapId = seedSnapshot(db, "2025-01-15", [
    { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
  ]);

  return { personId, jobId, profileId, itemIds, goalId, perfAcctId, snapId };
}
