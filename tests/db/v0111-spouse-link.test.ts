/**
 * The spouse-link tag (0024) as the restore step sees it: a nullable column
 * with no converter, so a backup from before the tag (no column) restores
 * with no link stored, and a backup with a pair keeps it as saved.
 */
import { describe, it, expect } from "vitest";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";

const TAG = "0024_v0111_spouse_link";
const TAGS = pgJournal.entries.map((e) => e.tag);

/** Three invented adults: two spouses and a third adult. */
const PEOPLE = [
  { id: 71, name: "Invented Ann", date_of_birth: "1960-05-01" },
  { id: 72, name: "Invented Ben", date_of_birth: "1962-08-15" },
  { id: 73, name: "Invented Cal", date_of_birth: "1990-02-10" },
];

describe("the spouse-link tag", () => {
  it("is the journal's tag after the lump-sum tag in both dialects, with no converter", () => {
    expect(TAGS.indexOf(TAG)).toBe(
      TAGS.indexOf("0023_v0111_lump_sum_targets") + 1,
    );
    expect(sqliteJournal.entries.map((e) => e.tag)).toEqual(TAGS);
    expect(tagConverters(TAG)).toEqual([]);
  });

  it("a backup from before the tag, with no link column, restores with no link stored", () => {
    const before = TAGS[TAGS.indexOf(TAG) - 1]!;
    const { tables } = transformBackupToCurrentSchema(
      { people: PEOPLE.map((p) => ({ ...p })) },
      before,
      TAGS.at(-1)!,
    );
    const rows = tables["people"] as Record<string, unknown>[];
    expect(rows.map((r) => r["id"])).toEqual([71, 72, 73]);
    expect(rows.map((r) => r["spouse_person_id"] ?? null)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("a backup with a stored pair keeps it as saved", () => {
    const linked = PEOPLE.map((p) => ({
      ...p,
      spouse_person_id: p.id === 71 ? 72 : p.id === 72 ? 71 : null,
    }));
    const { tables } = transformBackupToCurrentSchema(
      { people: structuredClone(linked) },
      TAGS[TAGS.indexOf(TAG) - 1]!,
      TAGS.at(-1)!,
    );
    expect(tables["people"]).toEqual(linked);
  });
});
