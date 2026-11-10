/**
 * The stored-JSON tag's retired limits (v0106-retired-limits.ts) as the
 * restore step runs it: a limit_type Ledgr shipped and retired goes, any
 * other key stays, and a replay deletes nothing more.
 */
import { describe, it, expect } from "vitest";
import { RETIRED_LIMITS_CONVERTER } from "@/lib/db/migrate/v0106-retired-limits";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import { DELETED, KEPT, LIMITS } from "./retired-limits-cases";

const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(STORED_JSON_TAG) - 1]!;

const backup = (): Record<string, Record<string, unknown>[]> => ({
  contribution_limits: LIMITS.map((r) => ({ ...r })),
});
const ids = (tables: Record<string, unknown[]>) =>
  (tables["contribution_limits"] as { id: number }[]).map((r) => r.id);

describe("the stored-JSON tag's retired limits", () => {
  it("runs in the tag, after the tag's SQL, and may only shrink its table", () => {
    expect(tagConverters(STORED_JSON_TAG)).toContain(RETIRED_LIMITS_CONVERTER);
    expect(RETIRED_LIMITS_CONVERTER.runs).toBe("afterSql");
    expect(RETIRED_LIMITS_CONVERTER.rowCounts).toEqual({
      shrinks: ["contribution_limits"],
    });
  });

  it("deletes the retired key in every year, keeps every other, and a replay deletes nothing", () => {
    const tables = expectRestoreReplaySafe(RETIRED_LIMITS_CONVERTER, backup());
    expect(ids(tables)).toEqual(KEPT);
  });

  it("deletes only the retired rows", () => {
    const r = RETIRED_LIMITS_CONVERTER.convert(backup());
    expect(r.deletes.map((d) => d.id)).toEqual(DELETED);
    expect(r.updates).toEqual([]);
  });

  it("a restore from the tag before deletes the same", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      BEFORE,
      CURRENT,
    );
    expect(ids(tables)).toEqual(KEPT);
  });
});
