/**
 * The money tag's extra-paycheck snapshots (v0106-net-pay-snapshot.ts) as
 * the restore step runs it: a rule's saved net pay goes where nothing
 * reads it, every routing reads as before, a replay writes nothing; a
 * Savings-mode routing without a base pay refuses, naming ids only.
 */
import { describe, it, expect, vi } from "vitest";
import { MONEY_TAG } from "@/lib/db/migrate/v0106-retirement-people";
import { NET_PAY_SNAPSHOT_CONVERTER } from "@/lib/db/migrate/v0106-net-pay-snapshot";
import {
  ConverterRefusal,
  MigrationRefusal,
} from "@/lib/db/migrate/converter-refusal";
import {
  convertBackup,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  JOBS,
  PROFILES,
  REFUSED,
  SPECULATIVE_JOB,
  REFUSED_IDS,
  SECRET_VALUE,
  profileReads,
  type ProfileCase,
} from "./net-pay-snapshot-cases";

// These cases hold entries for jobs the install doesn't have, which the
// stored-JSON tag drops by design (tested there): the restore here runs the
// converters before it.
vi.mock("@/lib/db/migrate/v0106-stored-json", async (original) => ({
  ...(await original<typeof import("@/lib/db/migrate/v0106-stored-json")>()),
  STORED_JSON_CONVERTERS: {},
}));

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(MONEY_TAG) - 1]!;

const backup = (cases: readonly ProfileCase[], text = false): Tables => ({
  salary_profiles: cases.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    salaries: text ? JSON.stringify(c.before) : structuredClone(c.before),
  })),
  jobs: [...JOBS, SPECULATIVE_JOB].map((j) => ({ ...j })),
});
const salariesOf = (t: Record<string, unknown[]>) =>
  (t["salary_profiles"] ?? []).map((r) => {
    const v = (r as Record<string, unknown>)["salaries"];
    if (typeof v !== "string") return v;
    const parsed: unknown = JSON.parse(v);
    return parsed;
  });

function refusalOf<T extends Error>(
  kind: new (...args: never[]) => T,
  run: () => unknown,
): T {
  try {
    run();
  } catch (e) {
    if (e instanceof kind) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

const TEXT =
  NET_PAY_SNAPSHOT_CONVERTER.refusals.net_pay_snapshot_in_savings_mode;

describe("the money tag's extra-paycheck snapshots", () => {
  it("is the tag's third converter, after the tag's SQL", () => {
    expect(tagConverters(MONEY_TAG)[2]).toBe(NET_PAY_SNAPSHOT_CONVERTER);
    expect(NET_PAY_SNAPSHOT_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["JSON values", false],
    ["JSON text", true],
  ])(
    "drops every unread snapshot (%s), and a replay writes nothing",
    (_, text) => {
      const tables = expectRestoreReplaySafe(
        NET_PAY_SNAPSHOT_CONVERTER,
        backup(PROFILES, text),
      );
      expect(salariesOf(tables)).toEqual(PROFILES.map((c) => c.after));
    },
  );

  it("every routing reads as before: mode, base pay, growth, each month's pay", () => {
    const after = expectRestoreReplaySafe(
      NET_PAY_SNAPSHOT_CONVERTER,
      backup(PROFILES),
    );
    expect(salariesOf(after).map(profileReads)).toEqual(
      PROFILES.map((c) => profileReads(c.before)),
    );
  });

  it("writes only the profiles it changes", () => {
    const r = NET_PAY_SNAPSHOT_CONVERTER.convert(backup(PROFILES));
    expect(r.updates.map((u) => u.id)).toEqual([101]);
  });

  it("refuses a Savings-mode routing without a base pay, naming ids by its declared code", () => {
    const e = refusalOf(ConverterRefusal, () =>
      NET_PAY_SNAPSHOT_CONVERTER.convert(backup([...PROFILES, ...REFUSED])),
    );
    expect(e.code).toBe("net_pay_snapshot_in_savings_mode");
    expect(e.refused).toEqual(REFUSED_IDS);
  });

  it("on restore, the refusal says what's wrong and the way out, and never a value", () => {
    const tables = backup([...PROFILES, ...REFUSED]);
    const e = refusalOf(MigrationRefusal, () =>
      convertBackup(tables, { t: NET_PAY_SNAPSHOT_CONVERTER }, "t"),
    );
    expect(e.refused).toEqual(REFUSED_IDS);
    expect(e.message).toContain("This backup can't be restored as it is");
    expect(e.message).toContain(TEXT.problem);
    expect(e.message).toContain(TEXT.restoreFix);
    expect(e.message).toContain(
      "salary_profiles 107, 108, 109; jobs 21, 22, 31",
    );
    expect(e.message).not.toContain(SECRET_VALUE);
    expect(e.message).not.toContain("Invented");
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
