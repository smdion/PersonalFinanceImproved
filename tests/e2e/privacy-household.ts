import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";

/**
 * One invented household for the privacy spec, so CI's empty database has
 * amounts to hide (a page with no amounts passes a leak scan trivially):
 * one person, a job, a 401k with a balance, a budget, retirement settings
 * and a return rate, enough for the Retirement page's projection and full report.
 *
 * Written straight into the SQLite file: CI's E2E server runs DEMO_ONLY,
 * which refuses every write procedure over HTTP. The rows are the ones the
 * write procedures leave (people.create's speculative job, the retirement
 * profile with a row per person, the active-profile settings), the same
 * shape tests/baseline/seed.ts writes through the router. Idempotent: an
 * install that already has people is left alone. The household stays for
 * the rest of the run; the other specs accept data or an empty state.
 */
const PRIVACY_HOUSEHOLD_PERSON = "Rowan Example";

/** The db or a transaction on it: what the seeder uses of either. */
type Db = Pick<
  BetterSQLite3Database<typeof schema>,
  "select" | "insert" | "update"
>;

export function seedPrivacyHousehold(sqlitePath: string): void {
  const sqlite = new Database(sqlitePath);
  try {
    sqlite.pragma("busy_timeout = 10000");
    seedPrivacyHouseholdInto(sqlite);
  } finally {
    sqlite.close();
  }
}

/** The same, into an open connection (one transaction). */
export function seedPrivacyHouseholdInto(sqlite: Database.Database): void {
  drizzle(sqlite, { schema }).transaction((tx) => seed(tx));
}

function setting(db: Db, key: string): string | undefined {
  const row = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get();
  return row == null ? undefined : String(row.value);
}

function upsertSetting(db: Db, key: string, value: unknown): void {
  if (setting(db, key) === undefined)
    db.insert(schema.appSettings).values({ key, value }).run();
  else
    db.update(schema.appSettings)
      .set({ value })
      .where(eq(schema.appSettings.key, key))
      .run();
}

function seed(db: Db): void {
  if (db.select().from(schema.people).all().length > 0) return;

  const person = db
    .insert(schema.people)
    .values({
      name: PRIVACY_HOUSEHOLD_PERSON,
      dateOfBirth: "1984-06-15",
      isPrimaryUser: true,
    })
    .returning()
    .get();
  // people.create provisions the what-if peg with every person.
  db.insert(schema.jobs)
    .values({
      personId: person.id,
      employerName: "Speculative (What-If Planning)",
      startDate: "2026-01-01",
      isSpeculative: true,
    })
    .run();
  const job = db
    .insert(schema.jobs)
    .values({
      personId: person.id,
      employerName: "Example Works",
      startDate: "2015-03-01",
    })
    .returning()
    .get();

  // Pay terms live in the active Salary Profile (the install makes one).
  const salaryProfileId = Number(setting(db, "active_salary_profile_id"));
  const salaryProfile =
    db
      .select()
      .from(schema.salaryProfiles)
      .where(eq(schema.salaryProfiles.id, salaryProfileId))
      .get() ?? db.select().from(schema.salaryProfiles).get();
  if (salaryProfile == null) throw new Error("seed: no salary profile");
  db.update(schema.salaryProfiles)
    .set({
      salaries: {
        ...salaryProfile.salaries,
        [String(job.id)]: {
          ...BLANK_SALARY_ENTRY,
          salary: 91000,
          payPeriod: "biweekly",
          payWeek: "even",
          anchorPayDate: "2026-01-09",
          w4FilingStatus: "Single",
        },
      },
    })
    .where(eq(schema.salaryProfiles.id, salaryProfile.id))
    .run();

  const account = db
    .insert(schema.performanceAccounts)
    .values({
      institution: "Example Brokerage",
      accountType: "401k",
      accountLabel: `${PRIVACY_HOUSEHOLD_PERSON} 401k (Example Brokerage)`,
      ownerPersonId: person.id,
      ownershipType: "individual",
      parentCategory: "Retirement",
    })
    .returning()
    .get();
  const snapshot = db
    .insert(schema.portfolioSnapshots)
    .values({ snapshotDate: "2026-03-01" })
    .returning()
    .get();
  db.insert(schema.portfolioAccounts)
    .values({
      snapshotId: snapshot.id,
      institution: "Example Brokerage",
      taxType: "preTax",
      amount: "184000",
      accountType: "401k",
      parentCategory: "Retirement",
      ownerPersonId: person.id,
      performanceAccountId: account.id,
    })
    .run();

  const profile = db
    .insert(schema.retirementProfiles)
    .values({ name: "Current Retirement" })
    .returning()
    .get();
  db.insert(schema.retirementProfilePeople)
    .values({
      profileId: profile.id,
      personId: person.id,
      retirementAge: 62,
      endAge: 92,
      socialSecurityMonthly: "2300",
      ssStartAge: 67,
    })
    .run();
  db.insert(schema.retirementSettings)
    .values({
      personId: person.id,
      profileId: profile.id,
      retirementAge: 62,
      endAge: 92,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "2300",
      ssStartAge: 67,
      filingStatus: "Single",
    })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 0, rateOfReturn: "0.07" })
    .run();

  // Spending, so the plan has something to fund.
  const budget = db
    .insert(schema.budgetProfiles)
    .values({
      name: "Household budget",
      columnLabels: ["Standard"],
      isActive: true,
    })
    .returning()
    .get();
  const lines: [string, string, number, boolean][] = [
    ["Housing", "Rent", 1900, true],
    ["Food", "Groceries", 600, true],
    ["Transportation", "Car and gas", 350, true],
    ["Lifestyle", "Misc", 300, false],
  ];
  lines.forEach(([category, subcategory, monthly, isEssential], sortOrder) =>
    db
      .insert(schema.budgetItems)
      .values({
        profileId: budget.id,
        category,
        subcategory,
        amounts: [monthly],
        isEssential,
        sortOrder,
      })
      .run(),
  );

  upsertSetting(db, "active_retirement_profile_id", profile.id);
  upsertSetting(db, "onboarding_completed", true);
}
