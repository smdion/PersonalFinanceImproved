/**
 * The v0.8.10 profile-sets conversion (migration 0009 and restoring an older
 * backup): Plan salaries → Salary Profiles, bonus destinations → entries,
 * bonus switches → each payroll account's fromBonus, unique Plan names.
 * Fictional household.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import {
  convertV0810ProfileSets,
  type V0810Tables,
} from "@/lib/db/v0810-profile-sets";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import { applyV0810ProfileSetsSqlite, V0810_TAG } from "../../db-migrate";

const entry = (over: Record<string, unknown> = {}) => ({
  salary: 90_000,
  bonusPercent: 0.1,
  bonusMultiplier: 1,
  monthsInBonusYear: 12,
  bonusOverride: null,
  payPeriod: "biweekly",
  payWeek: "na",
  anchorPayDate: null,
  budgetPeriodsPerMonth: null,
  w4FilingStatus: "MFJ",
  w4Box2cChecked: false,
  additionalFedWithholding: 0,
  bonusMonth: null,
  bonusDayOfMonth: null,
  extraPaycheckRouting: null,
  ...over,
});

/** A v0.8.9 household: two people, one current job each, one IRA. */
function oldTables(): V0810Tables {
  return {
    jobs: [
      { id: 10, person_id: 1, end_date: null, is_speculative: false },
      { id: 11, person_id: 1, end_date: "2020-01-01", is_speculative: false },
      { id: 20, person_id: 2, end_date: null, is_speculative: false },
    ],
    contribution_accounts: [
      { id: 100, job_id: 10, person_id: 1, is_payroll_deducted: null },
      { id: 101, job_id: 10, person_id: 1, is_payroll_deducted: null },
      { id: 200, job_id: 20, person_id: 2, is_payroll_deducted: null },
      { id: 300, job_id: null, person_id: 1, is_payroll_deducted: null },
    ],
    salary_profiles: [
      {
        id: 1,
        name: "Current",
        created_at: "2026-01-01T00:00:00Z",
        salaries: {
          "10": entry({ include401kInBonus: true }),
          "20": entry({
            salary: 70_000,
            include401kInBonus: false,
            includeBonusInContributions: false,
          }),
        },
      },
      {
        id: 2,
        name: "Raise",
        created_at: "2026-01-01T00:00:00Z",
        salaries: {
          "10": entry({ salary: 99_000, includeBonusInContributions: false }),
        },
      },
    ],
    contribution_profiles: [
      {
        id: 1,
        contribution_active_fields: {
          contributionAccounts: {
            "100": {
              contributionValue: "6",
              contributionMethod: "percent_of_salary",
            },
            "101": { isActive: false },
            "200": {
              contributionValue: "5",
              contributionMethod: "percent_of_salary",
            },
            "300": {
              contributionValue: "500",
              contributionMethod: "fixed_monthly",
            },
          },
          deductions: {},
        },
      },
      { id: 2, contribution_active_fields: { contributionAccounts: {} } },
    ],
    scenarios: [
      {
        id: 1,
        name: "Lean",
        salary_profile_id: 1,
        overrides: { people: { "2": { salary: 60_000 } } },
        is_baseline: false,
      },
      { id: 2, name: "Lean", salary_profile_id: 2, overrides: {} },
      { id: 3, name: "Lean (2)", salary_profile_id: null, overrides: {} },
    ],
    app_settings: [
      { key: "active_salary_profile_id", value: 1 },
      { key: "bonus_destinations", value: { "2": "spending", "1": "budget" } },
    ],
  };
}

const salaries = (t: V0810Tables, id: number) =>
  t["salary_profiles"]!.find((p) => p["id"] === id)!["salaries"] as Record<
    string,
    Record<string, unknown>
  >;
const accountFields = (t: V0810Tables, id: number) =>
  (
    t["contribution_profiles"]!.find((p) => p["id"] === id)![
      "contribution_active_fields"
    ] as { contributionAccounts: Record<string, Record<string, unknown>> }
  ).contributionAccounts;

describe("convertV0810ProfileSets", () => {
  it("a Plan's stored salaries become its own Salary Profile", () => {
    const t = oldTables();
    const r = convertV0810ProfileSets(t);
    expect(r.newSalaryProfiles).toHaveLength(1);
    const made = r.newSalaryProfiles[0]!;
    expect(made).toMatchObject({ id: 3, name: "Lean salary" });
    const s = made["salaries"] as Record<string, Record<string, unknown>>;
    expect(s["20"]!["salary"]).toBe(60_000);
    expect(s["10"]!["salary"]).toBe(90_000);
    // The Plan uses it; its old profile is untouched.
    expect(t["scenarios"]![0]!["salary_profile_id"]).toBe(3);
    expect(salaries(t, 1)["20"]!["salary"]).toBe(70_000);
  });

  it("bonus destinations move into the entries of that person's jobs", () => {
    const t = oldTables();
    const r = convertV0810ProfileSets(t);
    expect(salaries(t, 1)["20"]!["bonusDestination"]).toBe("spending");
    // "budget" is the default — never written.
    expect(salaries(t, 1)["10"]!["bonusDestination"]).toBeUndefined();
    const made = r.newSalaryProfiles[0]!["salaries"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(made["20"]!["bonusDestination"]).toBe("spending");
    expect(r.deletedSettings).toEqual(["bonus_destinations"]);
  });

  it("the active Salary Profile's bonus switches become each payroll account's fromBonus", () => {
    const t = oldTables();
    const r = convertV0810ProfileSets(t);
    const fields = accountFields(t, 1);
    // Job 10's switch is on in the active profile (off in "Raise" — noted).
    expect(fields["100"]!["fromBonus"]).toBe(true);
    expect(fields["101"]).toEqual({ isActive: false, fromBonus: true });
    // Job 20's is off: nothing written.
    expect(fields["200"]!["fromBonus"]).toBeUndefined();
    // Not paid through payroll: never taken from a bonus check.
    expect(fields["300"]!["fromBonus"]).toBeUndefined();
    // A profile with no entry for an account gets none.
    expect(accountFields(t, 2)).toEqual({});
    expect(r.notes.some((n) => n.includes("disagreed"))).toBe(true);
    // The switches are gone from every entry, the new profile's included.
    for (const p of [...t["salary_profiles"]!, ...r.newSalaryProfiles])
      for (const e of Object.values(
        p["salaries"] as Record<string, Record<string, unknown>>,
      )) {
        expect(e).not.toHaveProperty("include401kInBonus");
        expect(e).not.toHaveProperty("includeBonusInContributions");
      }
  });

  it("a Contribution Profile its Plans pair with one Salary Profile follows that profile's switch", () => {
    const t = oldTables();
    // Contribution Profile 2 has an entry for account 100, and its only Plan
    // pairs it with "Raise", whose switch for job 10 is off.
    accountFields(t, 2)["100"] = {
      contributionValue: "6",
      contributionMethod: "percent_of_salary",
    };
    t["scenarios"]!.push({
      id: 4,
      name: "Raise plan",
      contribution_profile_id: 2,
      salary_profile_id: 2,
      overrides: {},
    });
    const r = convertV0810ProfileSets(t);
    expect(accountFields(t, 2)["100"]!["fromBonus"]).toBeUndefined();
    // Profile 1 has no Plan of its own: the active Salary Profile's switch.
    expect(accountFields(t, 1)["100"]!["fromBonus"]).toBe(true);
    expect(
      r.notes.some(
        (n) => n.startsWith("Contribution Profile 2") && n.includes('"Raise"'),
      ),
    ).toBe(true);
  });

  it("notes Budget profiles whose columns had their own profiles", () => {
    const t = oldTables();
    t["budget_profiles"] = [
      { id: 7, column_contribution_profile_ids: "[null, 2]" },
      { id: 8, column_contribution_profile_ids: null },
    ];
    const r = convertV0810ProfileSets(t);
    expect(r.notes.filter((n) => n.startsWith("Budget profile"))).toEqual([
      "Budget profile 7: its columns' own profiles are gone; every column now uses the active Salary and Contribution profiles",
    ]);
  });

  it("duplicate Plan names get a free number", () => {
    const t = oldTables();
    convertV0810ProfileSets(t);
    // "Lean (2)" is taken by Plan 3, so the second "Lean" is "Lean (3)".
    expect(t["scenarios"]!.map((p) => p["name"])).toEqual([
      "Lean",
      "Lean (3)",
      "Lean (2)",
    ]);
  });

  it("reads JSON stored as text (SQLite) the same as objects", () => {
    const asText = oldTables();
    for (const table of [
      "salary_profiles",
      "contribution_profiles",
      "scenarios",
      "app_settings",
    ])
      for (const row of asText[table]!)
        for (const col of [
          "salaries",
          "contribution_active_fields",
          "overrides",
          "value",
        ])
          if (col in row) row[col] = JSON.stringify(row[col]);
    const objects = oldTables();
    const a = convertV0810ProfileSets(asText);
    const b = convertV0810ProfileSets(objects);
    expect(a.newSalaryProfiles).toEqual(b.newSalaryProfiles);
    expect(salaries(asText, 1)).toEqual(salaries(objects, 1));
    expect(accountFields(asText, 1)).toEqual(accountFields(objects, 1));
  });

  it("running it again changes nothing", () => {
    const t = oldTables();
    const first = convertV0810ProfileSets(t);
    // As the database would hold it afterwards.
    t["salary_profiles"]!.push(...first.newSalaryProfiles);
    t["app_settings"] = t["app_settings"]!.filter(
      (s) => !first.deletedSettings.includes(String(s["key"])),
    );
    for (const p of t["scenarios"]!) delete p["overrides"];
    const again = convertV0810ProfileSets(t);
    expect(again.newSalaryProfiles).toEqual([]);
    expect(again.changed.salary_profiles.size).toBe(0);
    expect(again.changed.contribution_profiles.size).toBe(0);
    expect(again.changed.scenarios.size).toBe(0);
    expect(again.deletedSettings).toEqual([]);
  });
});

describe("db-migrate.ts keeps an identical copy of the conversion", () => {
  it("the BEGIN/END blocks match", () => {
    const block = (file: string) => {
      const s = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      return s.slice(
        s.indexOf("// BEGIN v0810-profile-sets"),
        s.indexOf("// END v0810-profile-sets"),
      );
    };
    const src = block("src/lib/db/v0810-profile-sets.ts");
    expect(src.length).toBeGreaterThan(1000);
    expect(block("db-migrate.ts")).toBe(src);
  });
});

describe("restoring a pre-v0.8.10 backup", () => {
  it("converts it and drops the removed columns", () => {
    const t = oldTables();
    t["budget_profiles"] = [
      {
        id: 1,
        name: "Base",
        column_contribution_profile_ids: [1, null],
        column_salary_profile_ids: null,
      },
    ];
    const { tables } = transformBackupToCurrentSchema(
      t as Record<string, unknown[]>,
      "0008_v088_paycheck_earnings",
      V0810_TAG,
    );
    const rows = tables as Record<string, Record<string, unknown>[]>;
    expect(rows["salary_profiles"]!.map((p) => p["name"])).toEqual([
      "Current",
      "Raise",
      "Lean salary",
    ]);
    // A restore inserts every column its rows carry.
    expect(rows["salary_profiles"]![2]!["created_at"]).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(rows["app_settings"]!.map((s) => s["key"])).toEqual([
      "active_salary_profile_id",
    ]);
    expect(rows["scenarios"]![0]).not.toHaveProperty("overrides");
    expect(rows["scenarios"]![0]).not.toHaveProperty("is_baseline");
    expect(rows["budget_profiles"]![0]).toEqual({ id: 1, name: "Base" });
  });
});

describe("migration 0009 on SQLite", () => {
  function dbAt0008() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync("drizzle-sqlite/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) {
      if (tag === V0810_TAG) break;
      const sql = fs.readFileSync(`drizzle-sqlite/${tag}.sql`, "utf8");
      for (const stmt of sql.split("--> statement-breakpoint"))
        if (stmt.trim()) db.exec(stmt);
    }
    return db;
  }
  function apply0009(db: Database.Database) {
    const sql = fs.readFileSync(`drizzle-sqlite/${V0810_TAG}.sql`, "utf8");
    db.transaction(() => {
      applyV0810ProfileSetsSqlite(db);
      for (const stmt of sql.split("--> statement-breakpoint"))
        if (stmt.trim()) db.exec(stmt);
    })();
  }

  it("converts the data, then drops the columns without losing Budget items", () => {
    const db = dbAt0008();
    db.exec(`
      INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alex', '1990-01-01');
      INSERT INTO jobs (id, person_id, employer_name, start_date) VALUES (10, 1, 'Acme', '2020-01-01');
      INSERT INTO contribution_accounts (id, job_id, person_id, account_type, tax_treatment, employer_match_type)
        VALUES (100, 10, 1, '401k', 'pre_tax', 'none');
      INSERT INTO budget_profiles (id, name, column_labels, column_contribution_profile_ids, is_active)
        VALUES (5, 'Base', '["Standard"]', '[1]', 1);
      INSERT INTO budget_items (profile_id, category, subcategory, amounts)
        VALUES (5, 'Home', 'Rent', '[1000]');
      INSERT INTO scenarios (id, name, overrides, salary_profile_id) VALUES (1, 'Lean', '{"people":{"1":{"salary":80000}}}', 1);
      INSERT INTO scenarios (id, name, overrides) VALUES (2, 'Lean', '{}');
      INSERT INTO app_settings (key, value) VALUES ('bonus_destinations', '{"1":"spending"}');
    `);
    const entryJson = JSON.stringify({
      "10": entry({ include401kInBonus: true }),
    });
    db.prepare("UPDATE salary_profiles SET salaries = ? WHERE id = 1").run(
      entryJson,
    );
    db.prepare(
      "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE id = 1",
    ).run(
      JSON.stringify({
        contributionAccounts: {
          "100": {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
          },
        },
        deductions: {},
      }),
    );

    apply0009(db);

    const plans = db
      .prepare("SELECT * FROM scenarios ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(plans.map((p) => p["name"])).toEqual(["Lean", "Lean (2)"]);
    expect(plans[0]).not.toHaveProperty("overrides");
    const made = db
      .prepare("SELECT * FROM salary_profiles WHERE id = ?")
      .get(plans[0]!["salary_profile_id"]) as {
      name: string;
      salaries: string;
    };
    expect(made.name).toBe("Lean salary");
    const madeEntry = JSON.parse(made.salaries)["10"];
    expect(madeEntry.salary).toBe(80_000);
    expect(madeEntry.bonusDestination).toBe("spending");
    expect(madeEntry).not.toHaveProperty("include401kInBonus");
    const cp = db
      .prepare(
        "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE id = 1",
      )
      .get() as { f: string };
    expect(JSON.parse(cp.f).contributionAccounts["100"].fromBonus).toBe(true);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM app_settings WHERE key = 'bonus_destinations'",
        )
        .get(),
    ).toEqual({ n: 0 });
    // DROP COLUMN only — the budget profile and its items are still there.
    expect(
      db
        .prepare("SELECT count(*) AS n FROM budget_items WHERE profile_id = 5")
        .get(),
    ).toEqual({ n: 1 });
    const bp = db.prepare("SELECT * FROM budget_profiles WHERE id = 5").get();
    expect(bp).not.toHaveProperty("column_contribution_profile_ids");
    // Plan names are unique now.
    expect(() =>
      db.prepare("INSERT INTO scenarios (name) VALUES ('Lean')").run(),
    ).toThrow(/UNIQUE/);
  });
});
