/**
 * The stored-JSON tag's Salary Profile entries (v0106-salary-entries.ts)
 * as the restore step runs it: every root an object, retired keys gone,
 * every entry read as before, a replay writes nothing; an entry the entry
 * schema refuses refuses, naming ids and field names only.
 */
import { describe, it, expect } from "vitest";
import {
  SALARY_ENTRY_FIELDS,
  SALARY_ENTRIES_CONVERTER,
  refusedFields,
} from "@/lib/db/migrate/v0106-salary-entries";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import {
  ConverterRefusal,
  MigrationRefusal,
} from "@/lib/db/migrate/converter-refusal";
import { isRow, parsedJson } from "@/lib/db/migrate/converter-rows";
import {
  convertBackup,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import { salaryEntrySchema } from "@/lib/db/shapes/json-schemas";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  PROFILES,
  REFUSED,
  REFUSED_FIELDS,
  SECRET_VALUE,
  JOBS,
  WRITTEN,
  complete,
  profileReads,
  profileReadsBeforeTag,
  type SalaryCase,
} from "./salary-entries-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(STORED_JSON_TAG) - 1]!;

/** A SQLite export holds JSON text; a PostgreSQL one the value. */
const backup = (cases: readonly SalaryCase[], text = true): Tables => ({
  jobs: JOBS.map((j) => ({ ...j })),
  salary_profiles: cases.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    salaries: text ? JSON.stringify(c.before) : structuredClone(c.before),
  })),
});
const salariesOf = (t: Record<string, unknown[]>) =>
  (t["salary_profiles"] ?? []).map((r) => {
    const v = isRow(r) ? r["salaries"] : undefined;
    return typeof v === "string" ? parsedJson(v) : v;
  });

const TEXT = SALARY_ENTRIES_CONVERTER.refusals.salary_entry_not_readable;

/** The refusal a backup holding `cases` meets on restore, in its words. */
function refusalOf(cases: readonly SalaryCase[]): MigrationRefusal {
  try {
    convertBackup(backup(cases), { t: SALARY_ENTRIES_CONVERTER }, "t");
  } catch (e) {
    if (e instanceof MigrationRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("the stored-JSON tag's Salary Profile entries", () => {
  it("is the tag's first converter, after the tag's SQL", () => {
    expect(tagConverters(STORED_JSON_TAG)[0]).toBe(SALARY_ENTRIES_CONVERTER);
    expect(SALARY_ENTRIES_CONVERTER.runs).toBe("afterSql");
  });

  it("converts every root and retired key (JSON text), and a replay writes nothing", () => {
    const tables = expectRestoreReplaySafe(
      SALARY_ENTRIES_CONVERTER,
      backup(PROFILES),
    );
    expect(salariesOf(tables)).toEqual(PROFILES.map((c) => c.after));
  });

  it("a PostgreSQL export's object and null roots convert the same", () => {
    const cases = PROFILES.filter((c) => typeof c.before !== "string");
    const tables = expectRestoreReplaySafe(
      SALARY_ENTRIES_CONVERTER,
      backup(cases, false),
    );
    expect(salariesOf(tables)).toEqual(cases.map((c) => c.after));
  });

  it("every entry reads as before, but the string root, which read as no salaries", () => {
    const tables = expectRestoreReplaySafe(
      SALARY_ENTRIES_CONVERTER,
      backup(PROFILES),
    );
    const kept = PROFILES.map(
      (c, i) => [c, salariesOf(tables)[i]] as const,
    ).filter(([c]) => typeof c.before !== "string");
    expect(kept.map(([, after]) => profileReads(after))).toEqual(
      kept.map(([c]) => profileReadsBeforeTag(c.before)),
    );
  });

  it("leaves a backup row without the column to its default", () => {
    const tables = { salary_profiles: [{ id: 1, name: "Invented 1" }] };
    expect(SALARY_ENTRIES_CONVERTER.convert(tables).updates).toEqual([]);
  });

  it("writes only the profiles it changes", () => {
    const r = SALARY_ENTRIES_CONVERTER.convert(backup(PROFILES));
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it.each(REFUSED.map((c) => [c.id, c] as const))(
    "refuses profile %i, naming its id and never a value",
    (id, c) => {
      const e = refusalOf([...PROFILES, c]);
      expect(e.refused).toEqual({ salary_profiles: [id] });
      expect(e.message).toContain(TEXT.problem);
      expect(e.message).toContain(TEXT.restoreFix);
      expect(e.message).toContain("Nothing was restored");
      expect(e.message).not.toContain(String(SECRET_VALUE));
      expect(e.message).not.toContain("fortnightly");
      expect(e.message).not.toContain("oldBonusRule");
      expect(e.message).not.toContain("Invented");
    },
  );

  it("throws its declared code", () => {
    expect(() =>
      SALARY_ENTRIES_CONVERTER.convert(backup([...PROFILES, ...REFUSED])),
    ).toThrow(ConverterRefusal);
  });

  it("leaves every entry when the jobs weren't read", () => {
    const tables = backup(PROFILES);
    delete tables["jobs"];
    const r = SALARY_ENTRIES_CONVERTER.convert(tables);
    const kept = r.updates.find((u) => u.id === 207);
    expect(kept).toBeUndefined();
  });

  it("names every refused profile and field at once", () => {
    const e = refusalOf([...PROFILES, ...REFUSED]);
    expect(e.refused).toEqual({ salary_profiles: REFUSED.map((c) => c.id) });
    expect(e.fields).toEqual(expect.arrayContaining(REFUSED_FIELDS));
    expect(e.fields).toContain("bonusMultiplier"); // missing from 307
  });

  it("a restore from the tag before converts the same, and refuses the same", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(PROFILES),
      BEFORE,
      CURRENT,
    );
    expect(salariesOf(tables)).toEqual(PROFILES.map((c) => c.after));
    expect(() =>
      transformBackupToCurrentSchema(backup(REFUSED), BEFORE, CURRENT),
    ).toThrow(MigrationRefusal);
  });
});

describe("the entry shape as of the tag", () => {
  it("takes every key the live schema takes (its keys only grow)", () => {
    expect(Object.keys(SALARY_ENTRY_FIELDS)).toEqual(
      expect.arrayContaining(Object.keys(salaryEntrySchema.shape)),
    );
  });

  it.each([
    ...PROFILES.flatMap((c) =>
      typeof c.after === "object" && c.after !== null
        ? Object.values(c.after)
        : [],
    ),
    ...REFUSED.flatMap((c) =>
      typeof c.before === "object" &&
      c.before !== null &&
      !Array.isArray(c.before)
        ? Object.values(c.before)
        : [],
    ),
    complete({ anchorPayDate: "2026-02-30" }),
    complete({ monthsInBonusYear: 13 }),
    complete({ extraPaycheckRouting: { rules: [], stray: 1 } }),
    complete({
      extraPaycheckRouting: { rules: [{ from: "2026-01", to: null }] },
    }),
    complete({
      extraPaycheckRouting: {
        rules: [{ from: "2026-01", to: null, splits: [], note: "kept" }],
        yearlyGrowth: { 2027: { type: "pct", value: 2 } },
        payPeriod: "weekly",
      },
    }),
    complete({
      extraPaycheckRouting: {
        rules: [],
        yearlyGrowth: { 1: { type: "x", value: 1 } },
      },
    }),
    complete({ extraPaycheckRouting: { rules: [], payPeriod: "daily" } }),
    complete({ salary: -1 }),
    complete({ bonusOverride: -1 }),
    complete({ bonusOverride: 500 }),
    complete({ payWeek: "third" }),
    complete({ w4FilingStatus: "MFS" }),
    complete({ w4Box2cChecked: "yes" }),
    complete({ budgetPeriodsPerMonth: 0 }),
    complete({ budgetPeriodsPerMonth: 2.5 }),
    complete({ bonusMonth: 1.5 }),
    complete({ bonusMonth: 12 }),
    complete({ bonusDayOfMonth: 32 }),
    complete({ bonusDestination: "other" }),
    complete({ otherEarnings: { a: 1 } }),
    complete({ otherEarnings: { "1": -1 } }),
    complete({ otherEarnings: { "1": 0 } }),
    complete({ anchorPayDate: "2026-1-09" }),
    "an entry that isn't an object",
  ])("takes whatever the live schema takes (%#)", (entry) => {
    if (salaryEntrySchema.safeParse(entry).success)
      expect(refusedFields({ "1": entry })).toEqual([]);
  });
});
