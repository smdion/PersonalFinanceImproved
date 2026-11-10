/**
 * The credentials tag's cached-months step over a converter's tables:
 * every cached month of the active service gives its linked active goals a
 * savings month savings_monthly doesn't hold, read as the sync's tolerant
 * reader read it; every cached month is purged; replayed over its own
 * output it writes nothing; with no active service nothing is harvested.
 */
import { describe, it, expect } from "vitest";
import { CACHED_MONTHS_CONVERTER } from "@/lib/db/migrate/v0106-cached-months";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  CACHE,
  GOALS,
  HARVESTED,
  HELD,
  KEPT_CACHE_IDS,
  LINKS,
  SETTINGS,
} from "./cached-months-cases";

/** The tables as one dialect reads them: SQLite holds JSON as text and a
 *  boolean as 1/0. */
const tables = (form: "sqlite" | "postgres") => {
  const json = (v: unknown) => (form === "sqlite" ? JSON.stringify(v) : v);
  return {
    app_settings: SETTINGS.map((s) => ({ ...s, value: json(s.value) })),
    savings_goals: GOALS.map((g) => ({
      ...g,
      is_active: form === "sqlite" ? Number(g.is_active) : g.is_active,
    })),
    savings_goal_category_links: LINKS.map((l) => ({ ...l })),
    savings_monthly: HELD.map((h) => ({ ...h })),
    budget_api_cache: CACHE.map((c) => ({ ...c, data: json(c.data) })),
  };
};

const added = (rows: readonly unknown[]) =>
  rows
    .map((r) => r as Record<string, unknown>)
    .filter((r) => !HELD.some((h) => h.id === r["id"]))
    .map(({ goal_id, month_date, balance }) => ({
      goal_id,
      month_date,
      balance,
    }));

describe("the cached-months step", () => {
  it("runs fourth in the credentials tag and declares the tables it grows and shrinks", () => {
    expect(tagConverters(CREDENTIALS_TAG)[3]).toBe(CACHED_MONTHS_CONVERTER);
    expect(CACHED_MONTHS_CONVERTER.rowCounts).toEqual({
      grows: ["savings_monthly"],
      shrinks: ["budget_api_cache"],
    });
  });

  it.each(["sqlite", "postgres"] as const)(
    "harvests each month once and purges every month (%s rows), and a replay writes nothing",
    (form) => {
      const t = expectRestoreReplaySafe(
        [CACHED_MONTHS_CONVERTER],
        tables(form),
      );
      expect(added(t["savings_monthly"]!)).toEqual(HARVESTED);
      expect(t["savings_monthly"]).toContainEqual(HELD[0]);
      expect(
        t["budget_api_cache"]!.map((r) => (r as { id: number }).id),
      ).toEqual(KEPT_CACHE_IDS);
    },
  );

  it("names every column but id in each insert, and notes counts only", () => {
    const result = CACHED_MONTHS_CONVERTER.convert(tables("postgres"));
    for (const i of result.inserts)
      expect(Object.keys(i.row).sort()).toEqual([
        "balance",
        "deposit_or_withdrawal",
        "goal_id",
        "month_date",
        "notes",
      ]);
    expect(result.notes).toEqual([
      "2 savings months harvested from 2 cached budget months; 3 more purged with nothing harvested",
    ]);
  });

  it("harvests nothing with no active service, and still purges every month", () => {
    const result = CACHED_MONTHS_CONVERTER.convert({
      ...tables("postgres"),
      app_settings: [],
    });
    expect(result.inserts).toEqual([]);
    expect(result.deletes).toHaveLength(5);
  });
});
