/**
 * The money tag's budget amounts (v0106-budget-amounts.ts) as the restore
 * step runs it: every case of budget-amounts-cases.ts, JSON text too, the
 * budget's readers read each column as before, a replay writes nothing,
 * and a restore from the tag before ends the same way.
 */
import { describe, it, expect } from "vitest";
import { MONEY_TAG } from "@/lib/db/migrate/v0106-retirement-people";
import { BUDGET_AMOUNTS_CONVERTER } from "@/lib/db/migrate/v0106-budget-amounts";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  ITEMS,
  PROFILES,
  asReadBeforeTag,
  reads,
} from "./budget-amounts-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);
const CURRENT = TAGS.at(-1)!;
const BEFORE = TAGS[TAGS.indexOf(MONEY_TAG) - 1]!;

function backup(text = false): Tables {
  const json = (v: unknown) => (text ? JSON.stringify(v) : structuredClone(v));
  return {
    budget_profiles: PROFILES.map((p) => ({
      ...p,
      column_labels: json(p.column_labels),
    })),
    budget_items: ITEMS.map((c) => ({
      id: c.id,
      profile_id: c.profile_id,
      category: "Invented",
      subcategory: `Item ${c.id}`,
      amounts: json(c.before),
    })),
  };
}
type Read = Record<string, unknown[]>;
const rowsOf = (t: Read) =>
  (t["budget_items"] ?? []).filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
  );
const amountsOf = (t: Read) =>
  rowsOf(t).map((r) =>
    typeof r["amounts"] === "string"
      ? (JSON.parse(r["amounts"]) as unknown[])
      : (r["amounts"] as unknown[]),
  );
const itemsOf = (t: Read) =>
  rowsOf(t).map((r, i) => ({
    profile_id: r["profile_id"] as number,
    amounts: amountsOf(t)[i]!,
  }));

describe("the money tag's budget amounts", () => {
  it("is the tag's second converter, after the tag's SQL", () => {
    expect(tagConverters(MONEY_TAG)[1]).toBe(BUDGET_AMOUNTS_CONVERTER);
    expect(BUDGET_AMOUNTS_CONVERTER.runs).toBe("afterSql");
  });

  it.each([
    ["JSON values", false],
    ["JSON text", true],
  ])(
    "gives every case one number per column (%s), and a replay writes nothing",
    (_, text) => {
      const tables = expectRestoreReplaySafe(
        BUDGET_AMOUNTS_CONVERTER,
        backup(text),
      );
      expect(amountsOf(tables)).toEqual(ITEMS.map((c) => c.after));
    },
  );

  it("the budget reads every column of every item as before", () => {
    const before = backup();
    const after = expectRestoreReplaySafe(BUDGET_AMOUNTS_CONVERTER, backup());
    expect(reads(itemsOf(after))).toEqual(
      reads(asReadBeforeTag(itemsOf(before))),
    );
  });

  it("writes only the items it changes", () => {
    const r = BUDGET_AMOUNTS_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(
      ITEMS.filter(
        (c) => JSON.stringify(c.before) !== JSON.stringify(c.after),
      ).map((c) => c.id),
    );
  });

  it("an item whose profile or amounts can't be read is left alone", () => {
    const tables = backup();
    tables["budget_items"]!.push(
      { id: 90, profile_id: 404, amounts: [1] },
      { id: 91, profile_id: 1, amounts: "not json" },
      { id: 92, profile_id: 1, amounts: { 0: 1 } },
    );
    tables["budget_profiles"]!.push({ id: 5, column_labels: "not json" });
    tables["budget_items"]!.push({ id: 93, profile_id: 5, amounts: [] });
    const r = BUDGET_AMOUNTS_CONVERTER.convert(tables);
    expect(r.updates.map((u) => u.id)).not.toContain(90);
    expect(r.updates.map((u) => u.id).filter((id) => id >= 90)).toEqual([]);
  });

  it("a restore from the tag before ends with the same amounts", () => {
    const { tables } = transformBackupToCurrentSchema(
      backup(),
      BEFORE,
      CURRENT,
    );
    expect(amountsOf(tables as Tables)).toEqual(ITEMS.map((c) => c.after));
  });
});
