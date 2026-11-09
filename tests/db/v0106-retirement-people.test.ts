/**
 * The money tag's per-person retirement rows (v0106-retirement-people.ts)
 * as the restore step runs it: it adds exactly the rows of
 * retirement-people-cases.ts, every reader reads each person in each
 * profile as it did before, a replay adds nothing, and a restore from the
 * previous tag ends the same way.
 */
import { describe, it, expect } from "vitest";
import {
  MONEY_TAG,
  RETIREMENT_PEOPLE_CONVERTER,
} from "@/lib/db/migrate/v0106-retirement-people";
import {
  MIGRATION_CONVERTERS,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  ADDED,
  BACKUP_ONLY_SETTINGS,
  HELD,
  PEOPLE,
  PROFILES,
  SETTINGS,
  reads,
  settingsBeforeTag,
  type PersonRow,
} from "./retirement-people-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(MONEY_TAG) - 1]!;

function backup(): Tables {
  return structuredClone({
    people: PEOPLE,
    retirement_profiles: PROFILES,
    retirement_settings: [...SETTINGS, ...BACKUP_ONLY_SETTINGS],
    retirement_profile_people: HELD,
  });
}
const asCases = (t: Record<string, unknown[]>) =>
  // eslint-disable-next-line no-restricted-syntax -- the backup's tables, as the cases typed them
  t as unknown as Parameters<typeof reads>[0] & {
    retirement_profile_people: PersonRow[];
  };

describe("the money tag's per-person retirement rows", () => {
  it("is the tag's first converter, after 0017 in the journal, after the tag's SQL", () => {
    expect(tagConverters(MONEY_TAG)[0]).toBe(RETIREMENT_PEOPLE_CONVERTER);
    expect(RETIREMENT_PEOPLE_CONVERTER.runs).toBe("afterSql");
    expect(RETIREMENT_PEOPLE_CONVERTER.rowCounts.grows).toEqual([
      "retirement_profile_people",
    ]);
    expect(BEFORE).toBe("0017_v0102_match_value");
    expect(Object.keys(MIGRATION_CONVERTERS).at(-1)).toBe(MONEY_TAG);
  });

  it("adds a row for each settings row without one, with what it read, and a replay adds none", () => {
    const tables = expectRestoreReplaySafe(
      RETIREMENT_PEOPLE_CONVERTER,
      backup(),
    );
    expect(tables["retirement_profile_people"]).toEqual([
      ...HELD,
      ...ADDED.map((r, i) => ({ ...r, id: HELD.length + 1 + i })),
    ]);
  });

  it("reads every person in every profile exactly as before", () => {
    const before = backup();
    const after = expectRestoreReplaySafe(
      RETIREMENT_PEOPLE_CONVERTER,
      backup(),
    );
    const was = reads(asCases(before), settingsBeforeTag);
    expect(was.length).toBe(PROFILES.length * PEOPLE.length);
    expect(reads(asCases(after))).toEqual(was);
  });

  it("leaves a person with neither row in a profile without one", () => {
    const after = expectRestoreReplaySafe(
      RETIREMENT_PEOPLE_CONVERTER,
      backup(),
    );
    const rows = asCases(after).retirement_profile_people;
    expect(rows.some((r) => r.profile_id === 12 && r.person_id === 2)).toBe(
      false,
    );
    expect(rows.some((r) => r.profile_id === 99)).toBe(false);
  });

  it("a SQLite-made backup's 0/1 booleans copy as booleans", () => {
    const tables = backup();
    tables["retirement_settings"] = tables["retirement_settings"]!.map((s) => ({
      ...s,
      rule_of_55_override: s["rule_of_55_override"] ? 1 : 0,
    }));
    expectRestoreReplaySafe(RETIREMENT_PEOPLE_CONVERTER, tables);
    const added = tables["retirement_profile_people"]!.slice(HELD.length);
    expect(added.map((r) => r["rule_of_55_override"])).toEqual(
      ADDED.map((r) => r.rule_of_55_override),
    );
  });

  it("a restore from the tag before ends with the same rows", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      BEFORE,
      CURRENT,
    );
    const rows = (tables as Tables)["retirement_profile_people"]!;
    expect(rows.slice(HELD.length).map(({ id: _id, ...r }) => r)).toEqual(
      ADDED,
    );
  });
});
