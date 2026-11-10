/**
 * The stored-JSON tag's account-year categories (v0106-performance-
 * category.ts) as the restore step runs it: each account_performance row
 * takes its performance account's parent_category, a replay writes nothing.
 */
import { describe, it, expect } from "vitest";
import { PERFORMANCE_CATEGORY_CONVERTER } from "@/lib/db/migrate/v0106-performance-category";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  PERFORMANCE_ACCOUNTS,
  WRITTEN,
  YEARS,
  yearRows,
} from "./performance-category-cases";

const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(STORED_JSON_TAG) - 1]!;

const backup = (): Record<string, Record<string, unknown>[]> => ({
  performance_accounts: PERFORMANCE_ACCOUNTS.map((a) => ({ ...a })),
  account_performance: yearRows(),
});
const categories = (tables: Record<string, unknown[]>) =>
  (tables["account_performance"] as Record<string, unknown>[]).map(
    (r) => r["parent_category"],
  );

describe("the stored-JSON tag's account-year categories", () => {
  it("runs in the tag, after the tag's SQL", () => {
    expect(tagConverters(STORED_JSON_TAG)).toContain(
      PERFORMANCE_CATEGORY_CONVERTER,
    );
    expect(PERFORMANCE_CATEGORY_CONVERTER.runs).toBe("afterSql");
  });

  it("gives every row its account's category, and a replay writes nothing", () => {
    const tables = expectRestoreReplaySafe(
      PERFORMANCE_CATEGORY_CONVERTER,
      backup(),
    );
    expect(categories(tables)).toEqual(YEARS.map((y) => y.after));
  });

  it("writes only the rows that disagree", () => {
    const r = PERFORMANCE_CATEGORY_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it("leaves a row whose account isn't there", () => {
    const tables = backup();
    tables["performance_accounts"] = [];
    expect(PERFORMANCE_CATEGORY_CONVERTER.convert(tables).updates).toEqual([]);
  });

  it("a restore from the tag before converts the same", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      BEFORE,
      CURRENT,
    );
    expect(categories(tables)).toEqual(YEARS.map((y) => y.after));
  });
});
