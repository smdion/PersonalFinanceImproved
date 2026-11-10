/**
 * Every row the profile lifecycle writes, pinned for one invented household:
 * create, duplicate, make active and delete for Contribution and Salary
 * Profiles, and duplicate and delete for Retirement Profiles (which have no
 * bare create, and are made active through the app setting). Each step
 * records what the call returned or threw and every row of the tables a
 * profile lives in, so a lifecycle change that writes a different row, picks
 * a different active profile or throws a different error fails here.
 *
 * Covers the refusals as well as the writes: a missing source, the active
 * profile (an explicit setting, an implicit one, a stale one and one stored
 * as a numeric string), the last profile, a profile a Plan uses, a profile
 * that doesn't exist, a name in use, and a joint percent-of-salary account
 * with no job. Retirement duplicates a household where one person has no
 * row in the source profile.
 *
 * The pinned outcomes are what the code did when this was recorded, refusals
 * and all; a step that looks wrong is a finding to report, not to re-pin.
 * Decimal text has one form on both databases, so the pins hold on
 * PostgreSQL too.
 */
import "./setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as s from "@/lib/db/schema-sqlite";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import {
  createTestCaller,
  adminSession,
  seedPerson,
  seedJob,
  seedContributionAccount,
  seedContributionProfile,
  seedSalaryProfile,
} from "./setup";
import EXPECTED from "../fixtures/profile-lifecycle-rows.json";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
type Db = Ctx["db"];
type Step = { step: string; outcome: unknown; rows: unknown };

const ACTIVE_KEYS = new Set<string>([
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
]);

/** Timestamps come from SQLite's clock: kept as a marker, not a value. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return "<timestamp>";
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}

type Kind = "contribution" | "salary" | "retirement";

const TABLES = {
  contributionProfiles: s.contributionProfiles,
  salaryProfiles: s.salaryProfiles,
  retirementProfiles: s.retirementProfiles,
  retirementSettings: s.retirementSettings,
  retirementProfilePeople: s.retirementProfilePeople,
  plans: s.scenarios,
  savingsPlannedTransactions: s.savingsPlannedTransactions,
};
type TableName = keyof typeof TABLES;

/** The tables each kind's lifecycle may write, besides the active setting. */
const KIND_TABLES: Record<Kind, TableName[]> = {
  contribution: ["contributionProfiles", "plans"],
  salary: ["salaryProfiles", "plans", "savingsPlannedTransactions"],
  retirement: [
    "retirementProfiles",
    "retirementSettings",
    "retirementProfilePeople",
    "plans",
  ],
};

function tableRows(db: Db, name: TableName): unknown {
  const table = TABLES[name];
  return plain(db.select().from(table).orderBy(asc(table.id)).all());
}

function rowsOf(db: Db, names: TableName[]): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  for (const name of names) rows[name] = tableRows(db, name);
  rows.activeSettings = plain(
    db
      .select()
      .from(s.appSettings)
      .orderBy(asc(s.appSettings.key))
      .all()
      .filter((r) => ACTIVE_KEYS.has(r.key)),
  );
  return rows;
}

async function outcomeOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return { result: plain(await call()) };
  } catch (e) {
    if (e instanceof TRPCError)
      return { error: { code: e.code, message: e.message } };
    throw e;
  }
}

/**
 * Each step's outcome, and each of the kind's tables after it: in full when
 * the step changed it, else "unchanged". The other tables must not change.
 */
function recorder(db: Db, kind: Kind) {
  const names = KIND_TABLES[kind];
  const others = (Object.keys(TABLES) as TableName[]).filter(
    (n) => !names.includes(n),
  );
  const othersBefore = rowsOf(db, others);
  let last = rowsOf(db, names);
  const steps: Step[] = [{ step: "start", outcome: null, rows: last }];
  return {
    steps,
    async step(name: string, call: () => Promise<unknown>): Promise<void> {
      const outcome = await outcomeOf(call);
      const now = rowsOf(db, names);
      const rows = Object.fromEntries(
        Object.entries(now).map(([k, v]) => [
          k,
          JSON.stringify(v) === JSON.stringify(last[k]) ? "unchanged" : v,
        ]),
      );
      last = now;
      steps.push({ step: name, outcome, rows });
    },
    othersUnchanged(): void {
      const after = rowsOf(db, others);
      delete after.activeSettings;
      const before = { ...othersBefore };
      delete before.activeSettings;
      expect(after).toEqual(before);
    },
  };
}

function setSetting(db: Db, key: string, value: number | string): void {
  db.insert(s.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value } })
    .run();
}

function clearSetting(db: Db, key: string): void {
  db.delete(s.appSettings).where(eq(s.appSettings.key, key)).run();
}

function seedPlan(
  db: Db,
  name: string,
  ids: Partial<typeof s.scenarios.$inferInsert>,
): void {
  db.insert(s.scenarios)
    .values({ name, ...ids })
    .run();
}

function idOf(
  db: Db,
  table:
    | typeof s.contributionProfiles
    | typeof s.salaryProfiles
    | typeof s.retirementProfiles,
  name: string,
): number {
  const [row] = db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.name, name))
    .all();
  if (!row) throw new Error(`no profile named ${name}`);
  return row.id;
}

function idsOf(
  db: Db,
  table:
    | typeof s.contributionProfiles
    | typeof s.salaryProfiles
    | typeof s.retirementProfiles,
): number[] {
  return db
    .select({ id: table.id })
    .from(table)
    .orderBy(asc(table.id))
    .all()
    .map((r) => r.id);
}

function salaryEntry(overrides: Partial<SalaryEntry> = {}): SalaryEntry {
  return { ...BLANK_SALARY_ENTRY, ...overrides };
}

describe("profile lifecycle rows", () => {
  let ctx: Ctx | undefined;

  afterEach(() => {
    ctx?.cleanup();
    ctx = undefined;
    vi.useRealTimers();
  });

  async function start(): Promise<Ctx> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    ctx = await createTestCaller(adminSession);
    return ctx;
  }

  it("Contribution Profiles write the same rows", async () => {
    const { caller, db } = await start();
    const T = s.contributionProfiles;
    const person = await seedPerson(db, "Alex", "1988-03-04");
    const job = seedJob(db, person);
    const own = seedContributionAccount(db, { personId: person, jobId: job });
    const joint = seedContributionAccount(db, {
      ownership: "joint",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
    });
    const jointPct = seedContributionProfile(db, {
      name: "Joint percent",
      description: "a joint account at a percent of salary",
      contributionActiveFields: {
        contributionAccounts: {
          [joint]: { contributionMethod: "percent_of_salary" },
        },
      },
    });
    const r = recorder(db, "contribution");

    await r.step("create", () =>
      caller.contributionProfile.create({
        name: "Max the 401k",
        description: "every dollar the IRS allows",
        contributionActiveFields: {
          contributionAccounts: {
            [own]: {
              contributionMethod: "percent_of_salary",
              contributionValue: "12",
            },
          },
          deductions: {},
        },
      }),
    );
    await r.step("create without a description or fields", () =>
      caller.contributionProfile.create({ name: "Bare" }),
    );
    await r.step("create refuses a joint percent-of-salary account", () =>
      caller.contributionProfile.create({
        name: "Joint",
        contributionActiveFields: {
          contributionAccounts: {
            [joint]: {
              contributionMethod: "percent_of_salary",
              contributionValue: "5",
            },
          },
          deductions: {},
        },
      }),
    );
    const max = idOf(db, T, "Max the 401k");
    const bare = idOf(db, T, "Bare");

    await r.step("duplicate", () =>
      caller.contributionProfile.duplicate({
        sourceProfileId: max,
        name: "Max the 401k (copy)",
      }),
    );
    await r.step("duplicate refuses a missing source", () =>
      caller.contributionProfile.duplicate({
        sourceProfileId: 9999,
        name: "Nothing",
      }),
    );
    await r.step("duplicate refuses a joint percent-of-salary source", () =>
      caller.contributionProfile.duplicate({
        sourceProfileId: jointPct,
        name: "Joint copy",
      }),
    );
    const copy = idOf(db, T, "Max the 401k (copy)");

    await r.step("setActive", () =>
      caller.contributionProfile.setActive({ id: max }),
    );
    await r.step("setActive refuses a missing profile", () =>
      caller.contributionProfile.setActive({ id: 9999 }),
    );
    await r.step("delete refuses the active profile", () =>
      caller.contributionProfile.delete({ id: max }),
    );
    await r.step("delete an inactive profile", () =>
      caller.contributionProfile.delete({ id: copy }),
    );
    await r.step("delete refuses a missing profile", () =>
      caller.contributionProfile.delete({ id: 9999 }),
    );
    seedPlan(db, "Keep Bare", { contributionProfileId: bare });
    await r.step("delete refuses a profile a Plan uses", () =>
      caller.contributionProfile.delete({ id: bare }),
    );
    await r.step("setActive moves to another profile", () =>
      caller.contributionProfile.setActive({ id: bare }),
    );
    await r.step("delete the profile that was active", () =>
      caller.contributionProfile.delete({ id: max }),
    );
    setSetting(db, SK_ACTIVE_CONTRIB_PROFILE_ID, String(jointPct));
    await r.step("delete with the active id stored as a string", () =>
      caller.contributionProfile.delete({ id: jointPct }),
    );
    await r.step("setActive null clears the setting", () =>
      caller.contributionProfile.setActive({ id: null }),
    );
    for (const id of idsOf(db, T).filter((i) => i !== bare))
      await r.step(`delete profile ${id} with no active profile`, () =>
        caller.contributionProfile.delete({ id }),
      );
    db.delete(s.scenarios).run();
    await r.step("delete refuses the last profile", () =>
      caller.contributionProfile.delete({ id: bare }),
    );

    r.othersUnchanged();
    expect(r.steps).toEqual(EXPECTED.contribution);
  });

  it("Salary Profiles write the same rows", async () => {
    const { caller, db } = await start();
    const T = s.salaryProfiles;
    const person = await seedPerson(db, "Sam", "1990-11-30");
    const job = seedJob(db, person);
    const job2 = seedJob(db, person, { employerName: "SecondCo" });
    const routed = seedSalaryProfile(db, {
      name: "Routed",
      description: "extra checks go to savings",
      salaries: {
        [job]: salaryEntry({
          salary: 95000,
          anchorPayDate: "2026-01-02",
          extraPaycheckRouting: {
            rules: [{ from: "2026-01", to: null, splits: [] }],
            overrides: [],
            baseNetPayPerCheck: 2400.5,
            baseYear: 2026,
            yearlyGrowth: {},
          },
        }),
        [job2]: salaryEntry({ salary: 40000 }),
      },
    });
    const r = recorder(db, "salary");

    await r.step("create", () =>
      caller.salaryProfile.create({
        name: "Raise",
        description: "after the promotion",
        salaries: { [job]: salaryEntry({ salary: 110000, bonusPercent: 10 }) },
      }),
    );
    await r.step("create with no entries", () =>
      caller.salaryProfile.create({ name: "Empty" }),
    );
    // This year's brackets hold no head-of-household rows on this install.
    db.delete(s.taxBrackets).where(eq(s.taxBrackets.filingStatus, "HOH")).run();
    await r.step("create refuses a filing status with no brackets", () =>
      caller.salaryProfile.create({
        name: "No brackets",
        salaries: {
          [job]: salaryEntry({
            salary: 1,
            w4FilingStatus: "HOH",
            w4Box2cChecked: true,
          }),
        },
      }),
    );
    const raise = idOf(db, T, "Raise");
    const empty = idOf(db, T, "Empty");

    await r.step("duplicate clears extra-paycheck routing", () =>
      caller.salaryProfile.duplicate({
        sourceProfileId: routed,
        name: "Routed (copy)",
      }),
    );
    await r.step("duplicate refuses a missing source", () =>
      caller.salaryProfile.duplicate({ sourceProfileId: 9999, name: "No" }),
    );
    const copy = idOf(db, T, "Routed (copy)");

    await r.step("setActive", () =>
      caller.salaryProfile.setActive({ id: routed }),
    );
    await r.step("setActive refuses a missing profile", () =>
      caller.salaryProfile.setActive({ id: 9999 }),
    );
    await r.step("delete refuses the active profile", () =>
      caller.salaryProfile.delete({ id: routed }),
    );
    await r.step("delete an inactive profile", () =>
      caller.salaryProfile.delete({ id: copy }),
    );
    await r.step("delete refuses a missing profile", () =>
      caller.salaryProfile.delete({ id: 9999 }),
    );
    seedPlan(db, "Keep Raise", { salaryProfileId: raise });
    await r.step("delete refuses a profile a Plan uses", () =>
      caller.salaryProfile.delete({ id: raise }),
    );
    await r.step("setActive moves to another profile", () =>
      caller.salaryProfile.setActive({ id: raise }),
    );
    await r.step("delete the profile that was active", () =>
      caller.salaryProfile.delete({ id: routed }),
    );
    setSetting(db, SK_ACTIVE_SALARY_PROFILE_ID, String(empty));
    await r.step("delete with the active id stored as a string", () =>
      caller.salaryProfile.delete({ id: empty }),
    );
    await r.step("setActive null clears the setting", () =>
      caller.salaryProfile.setActive({ id: null }),
    );
    for (const id of idsOf(db, T).filter((i) => i !== raise))
      await r.step(`delete profile ${id} with no active profile`, () =>
        caller.salaryProfile.delete({ id }),
      );
    db.delete(s.scenarios).run();
    await r.step("delete refuses the last profile", () =>
      caller.salaryProfile.delete({ id: raise }),
    );

    r.othersUnchanged();
    expect(r.steps).toEqual(EXPECTED.salary);
  });

  it("Retirement Profiles write the same rows", async () => {
    const { caller, db } = await start();
    const T = s.retirementProfiles;
    const alex = await seedPerson(db, "Alex", "1988-03-04");
    await seedPerson(db, "Sam", "1990-11-30");
    const r = recorder(db, "retirement");

    // The first save makes the first profile (adoptFirstRetirementProfile),
    // with a row for Sam cloned from Alex's.
    await r.step("first settings save makes the first profile", () =>
      caller.retirement.retirementSettings.upsert({
        personId: alex,
        retirementAge: 62,
        endAge: 95,
        returnAfterRetirement: "0.05",
        annualInflation: "0.025",
        salaryAnnualIncrease: "0.03",
      }),
    );
    const [first] = idsOf(db, T);
    // Sam's rows in the source go, as on an install where Sam joined later
    // and a write failed: duplicate falls back to the primary's row.
    const sam = db
      .select({ id: s.people.id })
      .from(s.people)
      .where(eq(s.people.name, "Sam"))
      .all()[0]!.id;
    db.delete(s.retirementSettings)
      .where(eq(s.retirementSettings.personId, sam))
      .run();
    db.delete(s.retirementProfilePeople)
      .where(eq(s.retirementProfilePeople.personId, sam))
      .run();

    await r.step("duplicate", () =>
      caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: first!,
        name: "Retire at 60",
        description: "both stop early",
      }),
    );
    await r.step("duplicate without a description", () =>
      caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: first!,
        name: "Later",
      }),
    );
    await r.step("duplicate refuses a source with no settings", () =>
      caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: 9999,
        name: "Nothing",
      }),
    );
    const early = idOf(db, T, "Retire at 60");
    const later = idOf(db, T, "Later");

    clearSetting(db, SK_ACTIVE_RETIREMENT_PROFILE_ID);
    await r.step("delete refuses the implicitly active (lowest id) one", () =>
      caller.retirement.retirementProfiles.delete({ id: first! }),
    );
    await r.step("make a profile active through the app setting", () =>
      caller.settings.appSettings.upsert({
        key: SK_ACTIVE_RETIREMENT_PROFILE_ID,
        value: early,
      }),
    );
    await r.step("delete refuses the active profile", () =>
      caller.retirement.retirementProfiles.delete({ id: early }),
    );
    await r.step("delete an inactive profile and its rows", () =>
      caller.retirement.retirementProfiles.delete({ id: later }),
    );
    await r.step("delete refuses a missing profile", () =>
      caller.retirement.retirementProfiles.delete({ id: 9999 }),
    );
    seedPlan(db, "Keep first", { retirementProfileId: first! });
    await r.step("delete refuses a profile a Plan uses", () =>
      caller.retirement.retirementProfiles.delete({ id: first! }),
    );
    db.delete(s.scenarios).run();
    setSetting(db, SK_ACTIVE_RETIREMENT_PROFILE_ID, String(first!));
    await r.step("delete with the active id stored as a string", () =>
      caller.retirement.retirementProfiles.delete({ id: first! }),
    );
    setSetting(db, SK_ACTIVE_RETIREMENT_PROFILE_ID, 9999);
    await r.step("delete with a stale active id", () =>
      caller.retirement.retirementProfiles.delete({ id: first! }),
    );
    setSetting(db, SK_ACTIVE_RETIREMENT_PROFILE_ID, early);
    await r.step("delete the profile that was implicitly active", () =>
      caller.retirement.retirementProfiles.delete({ id: first! }),
    );
    await r.step("delete refuses the last profile", () =>
      caller.retirement.retirementProfiles.delete({ id: early }),
    );

    r.othersUnchanged();
    expect(r.steps).toEqual(EXPECTED.retirement);
  });
});
