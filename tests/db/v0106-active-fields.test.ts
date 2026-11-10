/**
 * The stored-JSON tag's contribution active fields (v0106-active-fields.ts)
 * as the restore step runs it: every root an object, retired keys and keys
 * equal to their account's column gone, every account read as before, a
 * replay writes nothing; anything else refuses, naming ids and fields only.
 */
import { describe, it, expect } from "vitest";
import {
  ACTIVE_FIELDS_CONVERTER,
  ACTIVE_FIELDS_ENTRY_FIELDS,
  DEDUCTION_ENTRY_FIELDS,
} from "@/lib/db/migrate/v0106-active-fields";
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
import { z } from "zod/v4";
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
} from "@/lib/config/enum-values";
import {
  contribAccountActiveFieldsPatchSchema,
  contribAccountActiveFieldsSchema,
  deductionActiveFieldsSchema,
} from "@/lib/db/shapes/json-schemas";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  ACCOUNTS,
  PROFILES,
  REFUSED,
  SECRET_VALUE,
  WRITTEN,
  profileReads,
  profileReadsBeforeTag,
  type ActiveFieldsCase,
} from "./active-fields-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(STORED_JSON_TAG) - 1]!;
const TEXT =
  ACTIVE_FIELDS_CONVERTER.refusals.contribution_active_fields_not_readable;

/** A SQLite export holds JSON text and 1/0; a PostgreSQL one the value. */
const backup = (cases: readonly ActiveFieldsCase[], text = true): Tables => ({
  contribution_accounts: ACCOUNTS.map((a) =>
    text
      ? { ...a, is_payroll_deducted: a.is_payroll_deducted ? 1 : null }
      : { ...a },
  ),
  contribution_profiles: cases.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    contribution_active_fields: text
      ? JSON.stringify(c.before)
      : structuredClone(c.before),
  })),
});
const rootsOf = (t: Record<string, unknown[]>) =>
  (t["contribution_profiles"] ?? []).map((r) => {
    const v = isRow(r) ? r["contribution_active_fields"] : undefined;
    return typeof v === "string" ? parsedJson(v) : v;
  });

/** The refusal a backup holding `cases` meets on restore, in its words. */
function refusalOf(cases: readonly ActiveFieldsCase[]): MigrationRefusal {
  try {
    convertBackup(backup(cases), { t: ACTIVE_FIELDS_CONVERTER }, "t");
  } catch (e) {
    if (e instanceof MigrationRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("the stored-JSON tag's contribution active fields", () => {
  it("runs after the Salary Profile entries, after the tag's SQL", () => {
    expect(tagConverters(STORED_JSON_TAG)[1]).toBe(ACTIVE_FIELDS_CONVERTER);
    expect(ACTIVE_FIELDS_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["JSON text", true],
    ["PostgreSQL values", false],
  ])(
    "converts every root and key (%s), and a replay writes nothing",
    (_, text) => {
      const tables = expectRestoreReplaySafe(
        ACTIVE_FIELDS_CONVERTER,
        backup(PROFILES, text),
      );
      expect(rootsOf(tables)).toEqual(PROFILES.map((c) => c.after));
    },
  );

  it("every account reads as before", () => {
    const tables = expectRestoreReplaySafe(
      ACTIVE_FIELDS_CONVERTER,
      backup(PROFILES),
    );
    expect(rootsOf(tables).map(profileReads)).toEqual(
      PROFILES.map((c) => profileReadsBeforeTag(c.before)),
    );
  });

  it("writes only the profiles it changes", () => {
    const r = ACTIVE_FIELDS_CONVERTER.convert(backup(PROFILES));
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it.each(REFUSED.map((c) => [c.id, c] as const))(
    "refuses profile %i, naming its id and fields, never a value",
    (id, c) => {
      const e = refusalOf([...PROFILES, c]);
      expect(e.refused).toEqual({ contribution_profiles: [id] });
      expect(e.fields).toEqual(c.fields);
      expect(e.message).toContain(TEXT.problem);
      expect(e.message).toContain(TEXT.restoreFix);
      expect(e.message).not.toContain(String(SECRET_VALUE));
      expect(e.message).not.toContain("fortnightly");
      expect(e.message).not.toContain("oldRule");
      expect(e.message).not.toContain("Invented");
    },
  );

  it("names every refused profile at once, by its declared code", () => {
    expect(() =>
      ACTIVE_FIELDS_CONVERTER.convert(backup([...PROFILES, ...REFUSED])),
    ).toThrow(ConverterRefusal);
    const e = refusalOf([...PROFILES, ...REFUSED]);
    expect(e.refused).toEqual({
      contribution_profiles: REFUSED.map((c) => c.id),
    });
  });

  it("a restore from the tag before converts the same, and refuses the same", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(PROFILES),
      BEFORE,
      CURRENT,
    );
    expect(rootsOf(tables)).toEqual(PROFILES.map((c) => c.after));
    expect(() =>
      transformBackupToCurrentSchema(backup(REFUSED), BEFORE, CURRENT),
    ).toThrow(MigrationRefusal);
  });
});

describe("the entry shapes as of the tag", () => {
  it("take every key the live schemas take (their keys only grow)", () => {
    expect(Object.keys(ACTIVE_FIELDS_ENTRY_FIELDS)).toEqual(
      expect.arrayContaining(
        Object.keys(contribAccountActiveFieldsPatchSchema.shape),
      ),
    );
    expect(Object.keys(DEDUCTION_ENTRY_FIELDS)).toEqual(
      expect.arrayContaining(Object.keys(deductionActiveFieldsSchema.shape)),
    );
  });

  it.each([
    { contributionValue: "6", contributionMethod: "percent_of_salary" },
    { contributionValue: 6 },
    { contributionMethod: "fixed_annual" },
    { contributionValue: "6", contributionMethod: "weekly" },
    { employerMatchType: "dollar_match" },
    { employerMatchType: "half" },
    { autoMaximize: "yes" },
    { rothRoute: "backdoor" },
    { rothRoute: "side" },
    { displayNameCustom: 4 },
    { employerMatchRate: null },
    { stray: 1 },
    "not an object",
  ])("take whatever the live schema takes (%#)", (entry) => {
    const root = { contributionAccounts: { "2": entry } };
    const convert = () =>
      ACTIVE_FIELDS_CONVERTER.convert(
        backup([{ id: 1, before: root, after: root }]),
      );
    if (liveEntry.safeParse(entry).success) expect(convert).not.toThrow();
  });
});

/** The live write schema, and the read's closed sets. */
const closedSets = z.object({
  contributionMethod: z.enum(CONTRIBUTION_METHOD_VALUES).optional(),
  employerMatchType: z.enum(EMPLOYER_MATCH_TYPE_VALUES).optional(),
});
const liveEntry = {
  safeParse: (entry: unknown) => ({
    success:
      contribAccountActiveFieldsSchema.safeParse(entry).success &&
      closedSets.safeParse(entry).success,
  }),
};
