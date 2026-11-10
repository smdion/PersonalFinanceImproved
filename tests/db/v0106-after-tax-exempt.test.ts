/**
 * The stored-JSON tag's after-tax deductions (v0106-after-tax-exempt.ts)
 * as the restore step runs it: an after-tax deduction flagged FICA-exempt
 * loses the flag, so the flag alone says what the paycheck math applied
 * (flagged and pre-tax); a replay writes nothing.
 */
import { describe, it, expect } from "vitest";
import { AFTER_TAX_EXEMPT_CONVERTER } from "@/lib/db/migrate/v0106-after-tax-exempt";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { asBool } from "@/lib/db/migrate/converter-rows";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import { DEDUCTIONS, WRITTEN, deductionRows } from "./after-tax-exempt-cases";

const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(STORED_JSON_TAG) - 1]!;

/** A SQLite export holds 1/0; a PostgreSQL one booleans. */
const backup = (sqlite = true): Record<string, Record<string, unknown>[]> => ({
  paycheck_deductions: deductionRows().map((d) =>
    sqlite
      ? {
          ...d,
          is_pretax: Number(d.is_pretax),
          fica_exempt: Number(d.fica_exempt),
        }
      : d,
  ),
});
const flags = (tables: Record<string, unknown[]>) =>
  (tables["paycheck_deductions"] as Record<string, unknown>[]).map((d) =>
    asBool(d["fica_exempt"]),
  );

describe("the stored-JSON tag's after-tax deductions", () => {
  it("runs in the tag, after the tag's SQL", () => {
    expect(tagConverters(STORED_JSON_TAG)).toContain(
      AFTER_TAX_EXEMPT_CONVERTER,
    );
    expect(AFTER_TAX_EXEMPT_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["SQLite's 1/0", true],
    ["PostgreSQL's booleans", false],
  ])(
    "clears the flag on after-tax rows only (%s), and a replay writes nothing",
    (_, sqlite) => {
      const tables = expectRestoreReplaySafe(
        AFTER_TAX_EXEMPT_CONVERTER,
        backup(sqlite),
      );
      expect(flags(tables)).toEqual(DEDUCTIONS.map((d) => d.after));
    },
  );

  it("leaves the flag saying what the paycheck math applied: flagged and pre-tax", () => {
    expect(DEDUCTIONS.map((d) => d.after)).toEqual(
      DEDUCTIONS.map((d) => d.exempt && d.pretax),
    );
  });

  it("writes only the rows it changes", () => {
    const r = AFTER_TAX_EXEMPT_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it("a restore from the tag before converts the same", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      BEFORE,
      CURRENT,
    );
    expect(flags(tables)).toEqual(DEDUCTIONS.map((d) => d.after));
  });
});
