/**
 * The job-entries tag (v0110-job-entries.ts) as the restore step runs it:
 * a Salary Profile entry for a job id the backup's jobs table lacks goes,
 * every other entry stays as stored, and a replay writes nothing.
 */
import { describe, it, expect } from "vitest";
import {
  JOB_ENTRIES_CONVERTER,
  JOB_ENTRIES_TAG,
} from "@/lib/db/migrate/v0110-job-entries";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import { JOBS, PROFILES, WRITTEN } from "./job-entries-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);

const backup = (text = false, jobs = true): Tables => ({
  salary_profiles: PROFILES.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    salaries: text ? JSON.stringify(c.before) : structuredClone(c.before),
  })),
  ...(jobs ? { jobs: JOBS.map((j) => ({ ...j, is_speculative: false })) } : {}),
});
const salariesOf = (t: Record<string, unknown[]>) =>
  (t["salary_profiles"] ?? []).map((r) => {
    const v = (r as Record<string, unknown>)["salaries"];
    if (typeof v !== "string") return v;
    const parsed: unknown = JSON.parse(v);
    return parsed;
  });

describe("the job-entries tag", () => {
  it("is the journal's tag after the stored-JSON tag in both dialects, its converter after the SQL", () => {
    expect(TAGS.indexOf(JOB_ENTRIES_TAG)).toBe(
      TAGS.indexOf("0020_v0106_stored_json") + 1,
    );
    expect(sqliteJournal.entries.map((e) => e.tag)).toEqual(TAGS);
    expect(tagConverters(JOB_ENTRIES_TAG)).toEqual([JOB_ENTRIES_CONVERTER]);
    expect(JOB_ENTRIES_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["JSON values", false],
    ["JSON text", true],
  ])(
    "drops each entry for a job the backup lacks (%s), and a replay writes nothing",
    (_, text) => {
      const tables = expectRestoreReplaySafe(
        JOB_ENTRIES_CONVERTER,
        backup(text),
      );
      expect(salariesOf(tables)).toEqual(PROFILES.map((c) => c.after));
    },
  );

  it("writes only the profiles it changes", () => {
    const r = JOB_ENTRIES_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it("a backup without a jobs table is left as it is", () => {
    expect(JOB_ENTRIES_CONVERTER.convert(backup(false, false)).updates).toEqual(
      [],
    );
  });

  it("a restore from the tag before converts the same", () => {
    const before = TAGS[TAGS.indexOf(JOB_ENTRIES_TAG) - 1]!;
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      before,
      TAGS.at(-1)!,
    );
    expect(salariesOf(tables)).toEqual(PROFILES.map((c) => c.after));
  });
});
