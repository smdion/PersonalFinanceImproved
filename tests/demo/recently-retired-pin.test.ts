/**
 * Pins the rows the Recently Retired demo seeds (seedProfile, the path
 * demo.activateProfile takes), every table and every column: a dated net
 * while its data table is re-encoded. A change to the profile's data on
 * purpose re-pins the digest and counts in that commit.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedProfile } from "@/server/services/demo/demo-seed";
import { DEMO_PROFILES } from "@/lib/demo";

/** Columns the database fills from the clock: never pinned. */
const CLOCK_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "changed_at",
  "computed_at",
  "fetched_at",
  "first_seen_at",
  "last_seen_at",
  "last_read_at",
  "requested_at",
  "settled_at",
]);

/** Today's rows per table (tables left empty are absent). */
const COUNTS = {
  account_performance: 77,
  annual_performance: 10,
  app_settings: 4,
  budget_items: 15,
  budget_profiles: 1,
  home_improvement_items: 3,
  jobs: 4,
  mortgage_loans: 1,
  net_worth_annual: 10,
  other_asset_items: 4,
  people: 2,
  performance_accounts: 7,
  portfolio_accounts: 7,
  portfolio_snapshots: 1,
  property_taxes: 4,
  retirement_profile_people: 2,
  retirement_profiles: 1,
  retirement_settings: 2,
  return_rate_table: 5,
  salary_profiles: 1,
  savings_goal_profile_allocations: 2,
  savings_goals: 2,
  savings_monthly: 24,
};

/** The day the pins were recorded: the seed dates rows from the clock. */
const PINNED_DAY = new Date("2026-11-05T12:00:00Z");

/** sha256 of today's rows (JSON, tables by name, rows in insert order). */
const DIGEST =
  "fd2b505e9a50a2d309704bfc89e24877646a4020e1215eda1d211af6a9cfb02b";

type Seeded = Awaited<ReturnType<typeof createTestCaller>>;

/** Every table's rows in insert order, clock columns dropped; empty tables left out. */
function dump(sqlite: Seeded["sqlite"]): Record<string, unknown[]> {
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
    )
    .all() as { name: string }[];
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const rows = sqlite
      .prepare(`SELECT * FROM "${name}" ORDER BY rowid`)
      .all() as Record<string, unknown>[];
    if (rows.length === 0) continue;
    out[name] = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([column]) => !CLOCK_COLUMNS.has(column)),
      ),
    );
  }
  return out;
}

describe("Recently Retired demo seed (pinned)", () => {
  let seeded: Seeded;
  let rows: Record<string, unknown[]>;

  beforeAll(async () => {
    vi.useFakeTimers({ now: PINNED_DAY, toFake: ["Date"] });
    seeded = await createTestCaller();
    // From empty tables, as a demo schema starts (CREATE TABLE LIKE copies no rows).
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
    await seedProfile(seeded.rawDb, DEMO_PROFILES["recently-retired"]!);
    rows = dump(sqlite);
  });

  afterAll(() => {
    vi.useRealTimers();
    seeded?.cleanup();
  });

  it("seeds today's row count in every table", () => {
    expect(
      Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length])),
    ).toEqual(COUNTS);
  });

  it("seeds today's rows, byte for byte", () => {
    const digest = createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex");
    expect(digest).toBe(DIGEST);
  });
});
