/**
 * The lump-sum-targets tag (v0111-lump-sum-targets.ts) as the restore step
 * runs it: a saved lump sum whose stored name and owner name match exactly
 * one account by a stored column gains that account's id and owner beside
 * the names; every other lump sum stays as stored, and a replay writes
 * nothing.
 */
import { describe, it, expect } from "vitest";
import {
  LUMP_SUM_TARGETS_CONVERTER,
  LUMP_SUM_TARGETS_TAG,
} from "@/lib/db/migrate/v0111-lump-sum-targets";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  PEOPLE,
  PERFORMANCE_ACCOUNTS,
  PORTFOLIO_ACCOUNTS,
  SETS,
  SNAPSHOTS,
  WRITTEN,
} from "./lump-sum-targets-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);

const backup = (text = false, accounts = true): Tables => ({
  projection_overrides: SETS.map((c) => ({
    id: c.id,
    override_type: c.type,
    overrides: text ? JSON.stringify(c.before) : structuredClone(c.before),
  })),
  people: PEOPLE.map((p) => ({ ...p })),
  ...(accounts
    ? {
        performance_accounts: PERFORMANCE_ACCOUNTS.map((a) => ({ ...a })),
        portfolio_accounts: PORTFOLIO_ACCOUNTS.map((r) => ({ ...r })),
        portfolio_snapshots: SNAPSHOTS.map((s) => ({ ...s })),
      }
    : {}),
});
const setsOf = (t: Record<string, unknown[]>) =>
  (t["projection_overrides"] ?? []).map((r) => {
    const v = (r as Record<string, unknown>)["overrides"];
    if (typeof v !== "string") return v;
    const parsed: unknown = JSON.parse(v);
    return parsed;
  });

describe("the lump-sum-targets tag", () => {
  it("is the journal's tag after the Roth overlay tag in both dialects, its converter after the SQL", () => {
    expect(TAGS.indexOf(LUMP_SUM_TARGETS_TAG)).toBe(
      TAGS.indexOf("0022_v0111_roth_overlay") + 1,
    );
    expect(sqliteJournal.entries.map((e) => e.tag)).toEqual(TAGS);
    expect(tagConverters(LUMP_SUM_TARGETS_TAG)).toEqual([
      LUMP_SUM_TARGETS_CONVERTER,
    ]);
    expect(LUMP_SUM_TARGETS_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["JSON values", false],
    ["JSON text", true],
  ])(
    "adds the id beside each name that matches one account of the latest snapshot, a null id beside every other name (%s), and a replay writes nothing",
    (_, text) => {
      const tables = expectRestoreReplaySafe(
        LUMP_SUM_TARGETS_CONVERTER,
        backup(text),
      );
      expect(setsOf(tables)).toEqual(SETS.map((c) => c.after));
    },
  );

  it("writes only the saved sets it changes, and its note counts", () => {
    const r = LUMP_SUM_TARGETS_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
    expect(r.notes).toEqual([
      "4 named lump sums gained their account's id; 7 matched no single account and are marked so (null id)",
    ]);
  });

  it("a backup without the account tables is left as it is, never marked unmatched", () => {
    expect(
      LUMP_SUM_TARGETS_CONVERTER.convert(backup(false, false)).updates,
    ).toEqual([]);
  });

  it("a restore from the tag before converts the same", () => {
    const before = TAGS[TAGS.indexOf(LUMP_SUM_TARGETS_TAG) - 1]!;
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      before,
      TAGS.at(-1)!,
    );
    expect(setsOf(tables)).toEqual(SETS.map((c) => c.after));
  });
});
