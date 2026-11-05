/**
 * Demo completeness guard (keep rule 6, the shipped artifact works). Each
 * demo profile is seeded on SQLite as demo.activateProfile seeds a demo
 * schema (empty tables, the reference data, then seedProfile), and then:
 * - every table is listed once: shared (DEMO_SHARED_TABLES), a data table a
 *   page reads or deliberately empty (demo-tables.ts), so a new table is
 *   placed on purpose;
 * - every data table has rows;
 * - each page's main read returns data, not an empty state.
 * An empty table or read is either on purpose (ON_PURPOSE: checked to stay
 * empty) or a gap filed for v0.11 (GAPS: an expected failure, since
 * filling it moves demo figures): demo-tables.ts.
 */
import { getTableName } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedProfile } from "@/server/routers/demo";
import { applyReferenceData } from "@/lib/db/reference-data";
import { DEMO_PROFILES } from "@/lib/demo";
import * as pgSchema from "@/lib/db/schema-pg";
import { DEMO_SHARED_TABLES } from "@/lib/db/demo-schema-marker";
import {
  ALL,
  DEMO_DATA_TABLES,
  DEMO_EMPTY_TABLES,
  GAPS,
  ON_PURPOSE,
} from "./demo-tables";

type Seeded = Awaited<ReturnType<typeof createTestCaller>>;
type Caller = Seeded["caller"];

/** Each page's main read, as the page calls it on first load. */
const PAGE_READS: [string, (c: Caller) => Promise<unknown>][] = [
  ["dashboard: networth.computeSummary", (c) => c.networth.computeSummary()],
  ["assets: assets.computeSummary", (c) => c.assets.computeSummary({})],
  [
    "benchmarks: investments.getComparison",
    (c) => c.investments.getComparison({}),
  ],
  [
    "benchmarks: investments.getHoldingsOverview",
    (c) => c.investments.getHoldingsOverview(),
  ],
  ["brokerage: brokerage.listGoals", (c) => c.brokerage.listGoals()],
  [
    "budget: budget.computeActiveSummary",
    (c) => c.budget.computeActiveSummary({ selectedColumn: 0 }),
  ],
  ["profiles: contributionProfile.list", (c) => c.contributionProfile.list()],
  [
    "contributions: contribution.computeSummary",
    (c) => c.contribution.computeSummary({}),
  ],
  ["data-browser: dataBrowser.listTables", (c) => c.dataBrowser.listTables()],
  ["expenses: budget.listApiActuals", (c) => c.budget.listApiActuals()],
  [
    "historical: historical.computeSummary",
    (c) => c.historical.computeSummary(),
  ],
  ["house: assets.listPropertyTaxes", (c) => c.assets.listPropertyTaxes()],
  [
    "liabilities: mortgage.computeActiveSummary",
    (c) => c.mortgage.computeActiveSummary(),
  ],
  ["liabilities: debts.list", (c) => c.debts.list()],
  ["milestones: milestones.computeInputs", (c) => c.milestones.computeInputs()],
  ["networth: networth.listHistory", (c) => c.networth.listHistory()],
  ["paycheck: paycheck.computeSummary", (c) => c.paycheck.computeSummary()],
  [
    "performance: performance.computeSummary",
    (c) => c.performance.computeSummary(),
  ],
  [
    "portfolio: networth.listSnapshotTotals",
    (c) => c.networth.listSnapshotTotals(),
  ],
  [
    "retirement: projection.computeProjection",
    (c) => c.projection.computeProjection({}),
  ],
  ["savings: savings.computeSummary", (c) => c.savings.computeSummary()],
  ["settings: settings.getDataFreshness", (c) => c.settings.getDataFreshness()],
  [
    "tax-buckets: taxBuckets.computeBreakdown",
    (c) => c.taxBuckets.computeBreakdown(),
  ],
  [
    "tax-optimization: projection.projectTaxYears",
    (c) => c.projection.projectTaxYears({}),
  ],
  [
    "tools: projection.relocationScenarios.list",
    (c) => c.projection.relocationScenarios.list(),
  ],
  ["upkeep: utilities.listServices", (c) => c.utilities.listServices()],
  ["versions: version.list", (c) => c.version.list()],
];

/** Real data: some non-zero number or non-empty string anywhere in it. */
function hasData(value: unknown): boolean {
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "boolean" || value == null) return false;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.some(hasData);
  if (typeof value === "object") return Object.values(value).some(hasData);
  return false;
}

function schemaTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(pgSchema)) {
    try {
      const name = getTableName(value as never);
      if (name) names.push(name);
    } catch {
      // not a table
    }
  }
  return [...new Set(names)].sort();
}

/** The case for one table or page read of one profile: data, empty on
 *  purpose, or a known gap (an expected failure). */
function check(slug: string, key: string, hasRows: () => Promise<boolean>) {
  const onPurpose = ON_PURPOSE[key];
  if (onPurpose?.profiles.includes(slug))
    it(`${key} is empty on purpose (${onPurpose.reason})`, async () => {
      expect(await hasRows()).toBe(false);
    });
  else if (GAPS[key]?.includes(slug))
    it.fails(
      `${key} has data (gap: v0.11 Data and migrations, Demo data gaps)`,
      async () => {
        expect(await hasRows()).toBe(true);
      },
    );
  else
    it(`${key} has data`, async () => {
      expect(await hasRows()).toBe(true);
    });
}

describe("demo table lists", () => {
  it("name only known profiles, tables and page reads", () => {
    const keys = new Set([
      ...DEMO_DATA_TABLES,
      ...PAGE_READS.map(([page]) => page),
    ]);
    for (const [key, slugs] of [
      ...Object.entries(GAPS),
      ...Object.entries(ON_PURPOSE).map(([k, v]) => [k, v.profiles] as const),
    ]) {
      expect(keys.has(key), key).toBe(true);
      for (const slug of slugs) expect(ALL, key).toContain(slug);
    }
  });

  it("place every schema table exactly once", () => {
    const listed = [
      ...DEMO_SHARED_TABLES,
      ...DEMO_DATA_TABLES,
      ...Object.keys(DEMO_EMPTY_TABLES),
    ];
    expect([...listed].sort()).toEqual(schemaTables());
  });
});

describe.each(Object.values(DEMO_PROFILES).map((p) => [p.slug, p] as const))(
  "demo profile %s",
  (slug, profile) => {
    let seeded: Seeded;

    beforeAll(async () => {
      seeded = await createTestCaller();
      const { sqlite } = seeded;
      sqlite.pragma("foreign_keys = OFF");
      for (const { name } of sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
        )
        .all() as { name: string }[])
        sqlite.prepare(`DELETE FROM "${name}"`).run();
      sqlite.prepare("DELETE FROM sqlite_sequence").run();
      sqlite.pragma("foreign_keys = ON");
      await applyReferenceData(seeded.rawDb);
      await seedProfile(seeded.rawDb, profile);
    }, 120_000);

    afterAll(() => seeded?.cleanup());

    for (const table of DEMO_DATA_TABLES)
      check(slug, table, async () => {
        const { n } = seeded.sqlite
          .prepare(`SELECT count(*) AS n FROM "${table}"`)
          .get() as { n: number };
        return n > 0;
      });

    for (const [page, read] of PAGE_READS)
      check(slug, page, async () => hasData(await read(seeded.caller)));
  },
);
