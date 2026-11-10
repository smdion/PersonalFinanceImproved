/**
 * The credentials tag's joint step on the restore path: a joint
 * contribution account naming a person is cleared of it, other rows are
 * left; replayed over its own output it writes nothing; a joint row with a
 * person, no job and a profile setting it to a percent of salary refuses
 * the restore before any write, naming its id and no name.
 */
import { describe, it, expect } from "vitest";
import { JOINT_PERSON_IDS_CONVERTER } from "@/lib/db/migrate/v0106-joint-person-ids";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import {
  convertBackup,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import { expectNoCellText, expectRestoreReplaySafe } from "./converter-replay";
import {
  ACCOUNT_CASES,
  NAMES,
  PROFILES,
  UNDECIDABLE,
} from "./joint-person-ids-cases";

/** A backup's rows: a SQLite export holds the profile JSON as text. */
const backup = (form: "sqlite" | "postgres", extra: object[] = []) => ({
  contribution_accounts: [
    ...ACCOUNT_CASES.map((c) => ({ ...c.row })),
    ...extra,
  ],
  contribution_profiles: PROFILES.map((p) => ({
    ...p,
    contribution_active_fields:
      form === "sqlite"
        ? JSON.stringify(p.contribution_active_fields)
        : p.contribution_active_fields,
  })),
});

const personIds = (rows: readonly unknown[]) =>
  rows.map((r) => (r as { person_id: number | null }).person_id);

describe("the joint step", () => {
  it("runs third in the credentials tag, after the tag's SQL", () => {
    expect(tagConverters(CREDENTIALS_TAG)[2]).toBe(JOINT_PERSON_IDS_CONVERTER);
    expect(JOINT_PERSON_IDS_CONVERTER.runs).toBe("afterSql");
  });

  it.each(["sqlite", "postgres"] as const)(
    "clears a joint row's person in a %s backup, and a replay writes nothing",
    (form) => {
      const tables = expectRestoreReplaySafe(
        [JOINT_PERSON_IDS_CONVERTER],
        backup(form),
      );
      expect(personIds(tables["contribution_accounts"]!)).toEqual(
        ACCOUNT_CASES.map((c) => c.after),
      );
    },
  );

  it("refuses a restore with an undecidable row before any write, naming its id only", () => {
    const tables = backup("sqlite", [{ ...UNDECIDABLE }]);
    const before = structuredClone(tables);
    let refusal: unknown = null;
    try {
      convertBackup(
        tables,
        { [CREDENTIALS_TAG]: [JOINT_PERSON_IDS_CONVERTER] },
        CREDENTIALS_TAG,
      );
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toBeInstanceOf(MigrationRefusal);
    const message = (refusal as Error).message;
    expect(message).toContain(`rows: contribution_accounts ${UNDECIDABLE.id})`);
    expect(message).toContain("Nothing was restored.");
    expectNoCellText([message], { people: NAMES.map((name) => ({ name })) });
    expect(tables).toEqual(before);
  });
});
