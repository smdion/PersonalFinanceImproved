/** The 0015 restore step: a backup's holding observations lose
 *  performance_account_id and its dead settings stay out. */
import { describe, it, expect } from "vitest";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import { validateColumns } from "@/lib/db/compat";
import {
  DEAD_SETTING_KEYS,
  dropDeadHoldingLinkAndSettings,
} from "@/lib/db/migrate/v0102-dead-data";
import pgJournal from "../../drizzle/meta/_journal.json";

const tags = pgJournal.entries.map((e) => e.tag);
const CURRENT = tags.at(-1)!;
const holding = (over: Record<string, unknown>) => ({
  id: 1,
  simplefin_account_id: 3,
  performance_account_id: null,
  security_id: 7,
  balance_date: "2026-10-30T22:00:00.000Z",
  as_of: "2026-10-30",
  shares: "12.50000000",
  reported_market_value: "1250.00",
  avg_cost_per_share: null,
  source: "simplefin",
  created_at: "2026-10-30T22:00:01.000Z",
  ...over,
});
const backup = () => ({
  holding_observations: [
    holding({ id: 1 }),
    holding({ id: 2, balance_date: null }),
    // No version wrote one: a hand-made row with only a tracked account.
    holding({
      id: 3,
      simplefin_account_id: null,
      performance_account_id: 4,
      source: "manual",
    }),
  ],
  app_settings: [
    { id: 1, key: "dave_ramsey_benchmarks", value: { on: true } },
    { id: 2, key: "theme", value: "dark" },
    { id: 3, key: "wealth_score_start_year", value: 2020 },
    { id: 4, key: "use_3yr_salary_average", value: false },
  ],
});

describe("dropDeadHoldingLinkAndSettings", () => {
  it("drops the link key and the dead settings; a second run changes nothing", () => {
    const tables: Record<string, unknown[]> = backup();
    dropDeadHoldingLinkAndSettings(tables);
    const once = structuredClone(tables);
    dropDeadHoldingLinkAndSettings(tables);
    expect(tables).toEqual(once);
    const { performance_account_id: _gone, ...shape } = holding({});
    expect(tables.holding_observations).toEqual([
      { ...shape, id: 1 },
      { ...shape, id: 2, balance_date: null },
    ]);
    expect(tables.app_settings).toEqual([
      { id: 2, key: "theme", value: "dark" },
    ]);
  });

  it("keeps every other key and leaves absent tables absent", () => {
    const tables: Record<string, unknown[]> = {
      app_settings: [...DEAD_SETTING_KEYS, "budget_active_column"].map(
        (key, i) => ({ id: i + 1, key, value: null }),
      ),
    };
    dropDeadHoldingLinkAndSettings(tables);
    expect(tables.app_settings).toEqual([
      {
        id: DEAD_SETTING_KEYS.size + 1,
        key: "budget_active_column",
        value: null,
      },
    ]);
    expect(tables).not.toHaveProperty("holding_observations");
  });
});

describe("a backup from before 0015, restored", () => {
  for (const from of [tags[tags.indexOf(CURRENT) - 1]!, tags[0]!])
    it(`from ${from}: the restore's column check passes, the input is unchanged`, () => {
      const input = backup();
      const before = structuredClone(input);
      const { tables } = transformBackupToCurrentSchema(input, from, CURRENT);
      expect(input).toEqual(before);
      const rows = tables.holding_observations as Record<string, unknown>[];
      expect(rows.map((r) => r.id)).toEqual([1, 2]);
      for (const r of rows)
        expect(() =>
          validateColumns("holding_observations", Object.keys(r)),
        ).not.toThrow();
      expect(
        (tables.app_settings as { key: string }[]).map((r) => r.key),
      ).toEqual(["theme"]);
    });

  it("the column is gone from the schema the restore checks against", () => {
    expect(() =>
      validateColumns("holding_observations", ["performance_account_id"]),
    ).toThrow(/Invalid column/);
  });
});
