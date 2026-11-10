/**
 * Backups written by released versions, restored through today's ladder.
 *
 * tests/fixtures/frozen-backups/<version>.json.gz is the backup each
 * release wrote for the dual-income-family demo household (invented data):
 * that release's own demo seed, into a database its own migrations built,
 * exported by its own exportBackup, on SQLite, with the clock at
 * 2026-06-15. They are frozen: never regenerated, never edited. A new
 * release adds its file.
 *
 * Each must import (transform ladder, restore, reference reconcile)
 * without an error, keep every household row it held by id, and leave a
 * household the main pages compute without an error or a NaN, to the
 * figures `frozen-backups/figures.json` pins for it (numbers only, as the
 * router baseline pins them: tests/baseline/numbers.ts), each procedure's
 * as one digest to keep the file small. A ladder step that moves a
 * restored figure fails here by release and procedure. A release with no
 * entry prints its digests (FROZEN_FIGURES) to record.
 *
 * The household is the same in every release but where the demo itself
 * changed (DEMO_CHANGES), so every backup must restore to the rows the
 * newest one restores to: an old shape the ladder leaves unconverted (a
 * match value with no rate, say) shows up here even where a fallback keeps
 * the figures.
 */
import "../routers/setup-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createTestCaller } from "../routers/setup";
import { flatten, numberTree } from "../baseline/numbers";
import {
  exportBackup,
  importBackup,
  type BackupData,
} from "@/lib/db/backup/version-logic";
import { KNOWN_SCHEMA_VERSIONS } from "@/lib/db/backup/backup-transforms";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";

const DIR = path.resolve("tests/fixtures/frozen-backups");

/** The released versions, oldest first. */
function byVersion(a: string, b: string): number {
  const n = (v: string) => v.slice(1).split(".").map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

const RELEASES = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".json.gz"))
  .map((f) => f.replace(/\.json\.gz$/, ""))
  .sort(byVersion);

/** Release → procedure → digest of its numbers. */
const FIGURES = JSON.parse(
  fs.readFileSync(path.join(DIR, "figures.json"), "utf8"),
) as Record<string, Record<string, string>>;

/** A digest of a result's numbers, path by path. */
const digestOf = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(flatten(numberTree(value))))
    .digest("hex")
    .slice(0, 16);

function frozen(release: string): BackupData {
  const gz = fs.readFileSync(path.join(DIR, `${release}.json.gz`));
  return JSON.parse(gunzipSync(gz).toString("utf8")) as BackupData;
}

/** The household's own tables: every row comes back with its id. */
const HOUSEHOLD_TABLES = [
  "people",
  "jobs",
  "budget_profiles",
  "budget_items",
  "savings_goals",
  "savings_goal_profile_allocations",
  "savings_monthly",
  "salary_profiles",
  "contribution_profiles",
  "contribution_accounts",
  "retirement_settings",
  "performance_accounts",
  "account_performance",
  "annual_performance",
  "portfolio_snapshots",
  "portfolio_accounts",
  "mortgage_loans",
  "net_worth_annual",
  "other_asset_items",
  "home_improvement_items",
  "property_taxes",
] as const;

/** Where the demo household itself changed, not its shape: these
 *  columns (every one, for "*") of releases before `before` differ from the
 *  newest restore's. */
const DEMO_CHANGES: {
  before: string;
  table: (typeof HOUSEHOLD_TABLES)[number];
  columns: string[] | "*";
  why: string;
}[] = [
  {
    before: "v0.9.8",
    table: "contribution_accounts",
    columns: ["employer_max_match_pct", "job_id"],
    why: "the demo seeded match caps as whole percents, with no job (e498b31d)",
  },
  {
    before: "v0.9.9",
    table: "retirement_settings",
    columns: "*",
    why: "the demo seeded one settings row, not one per person (a1152570)",
  },
];

type Row = Record<string, unknown>;
/** Release → its restored household tables. */
const restored = new Map<string, Record<string, unknown[]>>();

/** A table's rows without timestamps (the old seeds wrote the generating
 *  clock) and without the columns the demo changed for this release. */
function comparable(release: string, table: string, rows: unknown[]) {
  const changed = DEMO_CHANGES.filter(
    (c) => c.table === table && byVersion(release, c.before) < 0,
  );
  if (changed.some((c) => c.columns === "*")) return "demo changed";
  const dropped = new Set(changed.flatMap((c) => c.columns));
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r as Row).filter(
        ([k]) => !k.endsWith("_at") && !dropped.has(k),
      ),
    ),
  );
}

const ids = (rows: unknown[] | undefined) =>
  (rows ?? []).map((r) => Number((r as Row)["id"])).sort((a, b) => a - b);

/** Paths to every NaN in a result: a figure no page can show. */
function nanPaths(value: unknown, at = "$"): string[] {
  if (typeof value === "number") return Number.isNaN(value) ? [at] : [];
  if (Array.isArray(value))
    return value.flatMap((item, i) => nanPaths(item, `${at}[${i}]`));
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.entries(value).flatMap(([k, v]) => nanPaths(v, `${at}.${k}`));
  return [];
}

type Caller = Awaited<ReturnType<typeof createTestCaller>>["caller"];

/** Each main page's first read. */
const READS: [string, (c: Caller) => Promise<unknown>][] = [
  ["paycheck.computeSummary", (c) => c.paycheck.computeSummary()],
  ["contribution.computeSummary", (c) => c.contribution.computeSummary()],
  ["budget.computeActiveSummary", (c) => c.budget.computeActiveSummary()],
  ["savings.computeSummary", (c) => c.savings.computeSummary()],
  ["networth.computeSummary", (c) => c.networth.computeSummary()],
  ["performance.computeSummary", (c) => c.performance.computeSummary()],
  ["mortgage.computeActiveSummary", (c) => c.mortgage.computeActiveSummary()],
  ["projection.computeProjection", (c) => c.projection.computeProjection({})],
];

describe("frozen backups from released versions", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-06-15T12:00:00.000Z"),
      toFake: ["Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds one backup per release from v0.8.15 on, each labelled with a schema the ladder knows", () => {
    expect(RELEASES[0]).toBe("v0.8.15");
    expect(RELEASES.length).toBeGreaterThanOrEqual(17);
    const known = new Set<string>([
      ...KNOWN_SCHEMA_VERSIONS,
      ...sqliteJournal.entries.map((e) => e.tag),
    ]);
    for (const release of RELEASES) {
      const { schemaVersion, sourceDialect } = frozen(release);
      expect([release, sourceDialect]).toEqual([release, "sqlite"]);
      expect([release, known.has(schemaVersion)]).toEqual([release, true]);
    }
  });

  it.each(RELEASES)(
    "%s restores, keeps every household row, and the pages compute",
    async (release) => {
      const backup = frozen(release);
      const { caller, rawDb, cleanup } = await createTestCaller();
      try {
        const result = await importBackup(rawDb, structuredClone(backup), {
          asAdmin: true,
          user: "Admin",
        });
        expect(result.restoredRows).toBeGreaterThan(0);

        const { tables } = await exportBackup(rawDb, { asAdmin: true });
        for (const table of HOUSEHOLD_TABLES)
          expect([table, ids(tables[table])]).toEqual([
            table,
            ids(backup.tables[table]),
          ]);
        expect(ids(backup.tables["people"]).length).toBeGreaterThan(0);
        restored.set(
          release,
          Object.fromEntries(HOUSEHOLD_TABLES.map((t) => [t, tables[t] ?? []])),
        );

        const figures: Record<string, string> = {};
        for (const [name, read] of READS) {
          const value = await read(caller);
          expect([name, nanPaths(value)]).toEqual([name, []]);
          figures[name] = digestOf(value);
        }
        // A new release's file: its digests, to record in figures.json.
        if (!FIGURES[release])
          console.log(
            `FROZEN_FIGURES ${JSON.stringify({ [release]: figures })}`,
          );
        for (const [name] of READS)
          expect([release, name, figures[name]]).toEqual([
            release,
            name,
            FIGURES[release]?.[name],
          ]);
      } finally {
        cleanup();
      }
    },
    60_000,
  );

  it("every release restores to the newest release's rows, but where the demo changed", () => {
    const newest = RELEASES.at(-1)!;
    expect([...restored.keys()]).toEqual(RELEASES);
    for (const release of RELEASES)
      for (const table of HOUSEHOLD_TABLES) {
        const got = comparable(release, table, restored.get(release)![table]!);
        if (got === "demo changed") continue;
        expect([release, table, got]).toEqual([
          release,
          table,
          comparable(release, table, restored.get(newest)![table]!),
        ]);
      }
  });
});
