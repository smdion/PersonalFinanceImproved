/**
 * Migration 0016's converter (employer_match_rate / employerMatchRate) as
 * the restore step runs it: every shared case, on backups of every age, and
 * a second pass changes nothing. The live migration runs the same cases in
 * migration-0016.test.ts (SQLite) and migration-0016-postgres.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  MATCH_RATE_CONVERTER,
  MATCH_RATE_TAG,
} from "@/lib/db/v0102-match-rate";
import { MATCH_VALUE_TAG } from "@/lib/db/v0102-match-value";
import { effectiveMatchType, rateFromPercent } from "@/lib/utils/match-rate";
import { entryWithMatchRate } from "@/lib/pure/contributions/match-writes";
import {
  MIGRATION_CONVERTERS,
  convertBackup,
} from "@/lib/db/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import { contribAccountActiveFieldsSchema } from "@/lib/db/shapes/json-schemas";
import pgJournal from "../../drizzle/meta/_journal.json";
import { ACCOUNT_CASES, PROFILE_CASES, NOT_JSON } from "./match-rate-cases";

const CURRENT = pgJournal.entries.at(-1)!.tag;

function backup() {
  return {
    contribution_accounts: ACCOUNT_CASES.map((c) => ({
      id: c.id,
      account_type: "401k",
      sub_type: c.subType ?? null,
      employer_match_type: c.type,
      employer_match_value: c.value,
      ...(c.rate === undefined ? {} : { employer_match_rate: c.rate }),
    })),
    contribution_profiles: PROFILE_CASES.map((c, i) => ({
      id: i + 1,
      name: `Invented ${i}`,
      contribution_active_fields: structuredClone(c.before),
    })),
  };
}
type Tables = Record<string, Record<string, unknown>[]>;
const rates = (t: Tables) =>
  t["contribution_accounts"]!.map((r) => r["employer_match_rate"] ?? null);
const fields = (t: Tables) =>
  t["contribution_profiles"]!.map((r) => r["contribution_active_fields"]);

describe("rateFromPercent", () => {
  it.each([
    ["50", "0.5"],
    ["50.00", "0.5"],
    ["3.5", "0.035"],
    ["0.5", "0.005"],
    [".5", "0.005"],
    ["5.", "0.05"],
    ["0700", "7"],
    ["+5", "0.05"],
    ["-0", "0"],
    ["0", "0"],
    [50, "0.5"],
    [0.1, "0.001"],
    ["999999", "9999.99"],
    // What parseFloat reads, exactly (today's readers).
    ["1e2", "1"],
    ["5E1", "0.5"],
    ["2.5e-1", "0.0025"],
    ["50%", "0.5"],
    [" 50abc", "0.5"],
    ["50.5.5", "0.505"],
    ["1,000", "0.01"],
    ["0x32", "0"],
    ["1e-400", "0"],
    [1e-7, "0.000000001"],
    [0.1 + 0.2, "0.0030000000000000004"],
  ])("%s → %s", (stored, rate) => expect(rateFromPercent(stored)).toBe(rate));

  it.each(
    [["", "-", ".", "abc", "e2", "Infinity", "1e400", "123456789"]].flat(),
  )("%s → null", (stored) => expect(rateFromPercent(stored)).toBeNull());
  it.each([null, undefined, true, {}, Number.NaN, 1e21])("%s → null", (v) =>
    expect(rateFromPercent(v)).toBeNull(),
  );
});

describe("effectiveMatchType", () => {
  it("is the entry's own when it has the key (null included), else the account's", () => {
    expect(effectiveMatchType({}, "dollar_match")).toBe("dollar_match");
    expect(effectiveMatchType({ employerMatchType: "none" }, "x")).toBe("none");
    expect(effectiveMatchType({ employerMatchType: null }, "x")).toBeNull();
  });
});

describe("migration 0016's converter on the restore ladder", () => {
  it("is registered for its tag, after the tag's SQL", () => {
    expect(MIGRATION_CONVERTERS[MATCH_RATE_TAG]).toBe(MATCH_RATE_CONVERTER);
    expect(MATCH_RATE_CONVERTER.runs).toBe("afterSql");
    expect(pgJournal.entries.map((e) => e.tag)).toContain(MATCH_RATE_TAG);
  });

  it("gives every shared case its converted form, and a second pass changes nothing", () => {
    const tables: Tables = backup();
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_RATE_TAG);
    expect(rates(tables)).toEqual(ACCOUNT_CASES.map((c) => c.after));
    expect(fields(tables)).toEqual(PROFILE_CASES.map((c) => c.after));
    const once = structuredClone(tables);
    expect(
      convertBackup(tables, MIGRATION_CONVERTERS, MATCH_RATE_TAG)?.updates,
    ).toBe(0);
    expect(tables).toEqual(once);
  });

  it("leaves employer_match_value and every other column as they were", () => {
    const tables: Tables = backup();
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_RATE_TAG);
    const strip = (t: Tables) =>
      t["contribution_accounts"]!.map(({ employer_match_rate: _, ...r }) => r);
    expect(strip(tables)).toEqual(strip(backup()));
  });

  it("reads JSON text (SQLite) as well as objects, and leaves text that isn't JSON", () => {
    const tables: Tables = backup();
    for (const p of tables["contribution_profiles"]!)
      p["contribution_active_fields"] = JSON.stringify(
        p["contribution_active_fields"],
      );
    tables["contribution_profiles"]!.push(
      ...NOT_JSON.map((text, i) => ({
        id: 100 + i,
        contribution_active_fields: text,
      })),
    );
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_RATE_TAG);
    const got = fields(tables).map((f) =>
      typeof f === "string" && !NOT_JSON.includes(f) ? JSON.parse(f) : f,
    );
    expect(got).toEqual([...PROFILE_CASES.map((c) => c.after), ...NOT_JSON]);
  });

  it("notes what it filled and names what it left without a rate", () => {
    const r = convertBackup(backup(), MIGRATION_CONVERTERS, MATCH_RATE_TAG)!;
    expect(r.notes[0]).toBe("14 account rates, 10 entry rates");
    expect(r.notes[1]).toMatch(/account 17, account 18, account 20,/);
    expect(r.notes[1]).toMatch(/profile 13 entry 4, profile 14 entry 2$/);
  });

  it.each([
    "0015_v0102_dead_data", // v0.10.2 before 0016
    "0013_v097_loan_feed", // v0.10.1
    "0008_v088_paycheck_earnings", // before v0.8.10's profile sets
  ])("runs for a backup at %s, after the older steps", (from) => {
    const input = backup();
    const before = structuredClone(input);
    const { tables } = transformBackupToCurrentSchema(input, from, CURRENT);
    const t = tables as Tables;
    expect(rates(t)).toEqual(ACCOUNT_CASES.map((c) => c.after));
    // 0017 runs after it in the same loop (v0102-match-value.test.ts).
    const expected: Tables = backup();
    convertBackup(expected, MIGRATION_CONVERTERS, MATCH_RATE_TAG);
    expect(fields(expected)).toEqual(PROFILE_CASES.map((c) => c.after));
    convertBackup(expected, MIGRATION_CONVERTERS, MATCH_VALUE_TAG);
    expect(fields(t)).toEqual(fields(expected));
    expect(input).toEqual(before);
  });

  it("doesn't run for a backup already at the current schema", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      CURRENT,
      CURRENT,
    );
    expect(rates(tables as Tables)[0]).toBeNull();
  });

  it("every converted entry passes the strict entry schema", () => {
    let checked = 0;
    for (const c of PROFILE_CASES) {
      const stored = (c.after as { contributionAccounts?: unknown } | null)
        ?.contributionAccounts;
      if (typeof stored !== "object" || stored === null) continue;
      for (const entry of Object.values(stored)) {
        if (typeof entry !== "object" || entry === null) continue;
        if (!("employerMatchRate" in entry)) continue;
        if (entry.employerMatchRate === null) continue;
        expect(contribAccountActiveFieldsSchema.safeParse(entry).success).toBe(
          true,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

function withoutRatedValue(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const e = entry as Record<string, unknown>;
  if (e["employerMatchRate"] == null) return entry;
  const { employerMatchValue: _value, ...rest } = e;
  return rest;
}

describe("the writer agrees with the converter", () => {
  const byId = new Map(
    ACCOUNT_CASES.map((c) => [String(c.id), { type: c.type, value: c.value }]),
  );
  const entriesOf = (v: unknown) =>
    (v as { contributionAccounts?: Record<string, unknown> } | null)
      ?.contributionAccounts;
  it.each(PROFILE_CASES)("$name", ({ before, after }) => {
    const b = entriesOf(before);
    const a = entriesOf(after);
    if (!b || typeof b !== "object" || Array.isArray(b)) return;
    for (const [id, entry] of Object.entries(b)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      // The converter keeps a rate already stored; the writer recomputes it.
      if (e["employerMatchRate"] != null) continue;
      // The writer stores 0017's end state: a set rate's value goes.
      expect(entryWithMatchRate(e, byId.get(id), false)).toEqual(
        withoutRatedValue(a?.[id]),
      );
    }
  });
});
