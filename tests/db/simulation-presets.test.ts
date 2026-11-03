/**
 * The shipped Simulation presets (reference-data/simulation-presets.json):
 * seeded only into a database whose preset tables are all empty, never
 * over rows already there, and holding what the methodology page states.
 */
import { describe, it, expect } from "vitest";
import { openTestSqlite } from "../helpers/db-harness";
import {
  parseSimulationPresets,
  seedSimulationPresetsSync,
  SIMULATION_PRESET_TABLES,
  type SimulationPresetsFile,
} from "@/lib/db/reference-reconcile-core";
import { readSimulationPresetsFile } from "@/lib/db/reference-data";
import { interpolateAllocations } from "@/lib/calculators/random";
import { COMPOSITION_BUCKET_VALUES } from "@/lib/config/enum-values";

type Db = ReturnType<typeof openTestSqlite>;

const seed = (db: Db, file = readSimulationPresetsFile()) =>
  seedSimulationPresetsSync((text, params) => {
    const stmt = db.prepare(text);
    if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
    stmt.run(...params);
    return [];
  }, file);

const count = (db: Db, table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const tableRows = (db: Db) =>
  Object.fromEntries(
    SIMULATION_PRESET_TABLES.map((t) => [
      t,
      db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(),
    ]),
  );

const emptyPresetTables = (db: Db) => {
  for (const t of [...SIMULATION_PRESET_TABLES].reverse())
    db.prepare(`DELETE FROM ${t}`).run();
};

/** A preset's glide path as age → class name → allocation. */
function glidePath(file: SimulationPresetsFile, key: string) {
  const byAge = new Map<number, Record<string, number>>();
  for (const r of file.mc_preset_glide_paths.filter((g) => g.preset === key))
    byAge.set(r.age, { ...byAge.get(r.age), [r.asset_class]: r.allocation });
  return [...byAge.entries()].sort(([a], [b]) => a - b);
}

const STOCK_CLASSES = ["US Equities", "International Equities"];
const stockShare = (alloc: Record<string, number>) =>
  STOCK_CLASSES.reduce((s, c) => s + (alloc[c] ?? 0), 0);

describe("seeding the shipped presets", () => {
  it("a fresh database holds exactly the file", () => {
    const db = openTestSqlite();
    const file = readSimulationPresetsFile();
    for (const t of SIMULATION_PRESET_TABLES)
      expect(count(db, t), t).toBe(file[t].length);
    const classes = new Map(
      (
        db
          .prepare("SELECT id, name, mean_return FROM asset_class_params")
          .all() as {
          id: number;
          name: string;
          mean_return: string;
        }[]
      ).map((c) => [c.id, c]),
    );
    for (const c of file.asset_class_params)
      expect(
        Number(
          [...classes.values()].find((r) => r.name === c.name)?.mean_return,
        ),
        c.name,
      ).toBe(c.mean_return);
    const glide = db
      .prepare(
        "SELECT p.key, g.age, g.asset_class_id, g.allocation FROM mc_preset_glide_paths g JOIN mc_presets p ON p.id = g.preset_id",
      )
      .all() as {
      key: string;
      age: number;
      asset_class_id: number;
      allocation: string;
    }[];
    for (const r of file.mc_preset_glide_paths)
      expect(
        glide.some(
          (g) =>
            g.key === r.preset &&
            g.age === r.age &&
            classes.get(g.asset_class_id)?.name === r.asset_class &&
            Number(g.allocation) === r.allocation,
        ),
        `${r.preset} ${r.age} ${r.asset_class}`,
      ).toBe(true);
  });

  it("running again inserts nothing", () => {
    const db = openTestSqlite();
    const before = tableRows(db);
    expect(seed(db)).toBe(0);
    expect(tableRows(db)).toEqual(before);
  });

  it("an install with preset rows keeps them as they are, even with one table emptied", () => {
    const db = openTestSqlite();
    db.prepare(
      "UPDATE asset_class_params SET mean_return = '0.123000' WHERE name = 'US Equities'",
    ).run();
    db.prepare("DELETE FROM mc_preset_return_overrides").run();
    db.prepare("DELETE FROM mc_presets WHERE key = 'aggressive'").run();
    const before = tableRows(db);
    expect(seed(db)).toBe(0);
    expect(tableRows(db)).toEqual(before);
  });

  it("rows in any one preset table stop the seed", () => {
    const db = openTestSqlite();
    emptyPresetTables(db);
    db.prepare(
      "INSERT INTO asset_class_params (name, mean_return, std_dev) VALUES ('Own class', '0.07', '0.15')",
    ).run();
    expect(seed(db)).toBe(0);
    expect(count(db, "mc_presets")).toBe(0);
    expect(count(db, "asset_class_params")).toBe(1);
  });

  it("emptied preset tables (Reset all data) are seeded again", () => {
    const db = openTestSqlite();
    const file = readSimulationPresetsFile();
    emptyPresetTables(db);
    expect(seed(db)).toBe(
      SIMULATION_PRESET_TABLES.reduce((n, t) => n + file[t].length, 0),
    );
    expect(count(db, "mc_presets")).toBe(file.mc_presets.length);
  });

  it("refuses a newer file format and a row naming a class it lacks", () => {
    const text = (f: unknown) => JSON.stringify(f);
    const file = readSimulationPresetsFile();
    expect(() =>
      parseSimulationPresets(text({ ...file, formatVersion: 99 })),
    ).toThrow(/newer than this app reads/);
    expect(() =>
      parseSimulationPresets(
        text({
          ...file,
          mc_preset_return_overrides: [
            { preset: "default", asset_class: "Nowhere", mean_return: 0.1 },
          ],
        }),
      ),
    ).toThrow(/Nowhere/);
  });

  it("refuses a figure that isn't finite, a correlation outside [-1, 1] and a glide path off 100%", () => {
    const file = readSimulationPresetsFile();
    const withRow = (table: string, i: number, row: object) =>
      JSON.stringify({
        ...file,
        [table]: (file[table as keyof typeof file] as object[]).map((r, j) =>
          j === i ? { ...r, ...row } : r,
        ),
      });
    expect(() =>
      parseSimulationPresets(
        withRow("asset_class_params", 0, { mean_return: 7 }).replace(
          '"mean_return":7',
          '"mean_return":1e999',
        ),
      ),
    ).toThrow(/mean_return is not a finite number/);
    expect(() =>
      parseSimulationPresets(
        withRow("asset_class_correlations", 0, { correlation: 1.2 }),
      ),
    ).toThrow(/outside \[-1, 1\]/);
    expect(() =>
      parseSimulationPresets(
        withRow("mc_preset_glide_paths", 0, { allocation: 0.5 }),
      ),
    ).toThrow(/sums to/);
  });
});

describe("the shipped bucket links", () => {
  it("map each composition bucket to its own class, `other` to none", () => {
    const db = openTestSqlite();
    const links = db
      .prepare(
        "SELECT b.bucket, a.name FROM asset_class_buckets b JOIN asset_class_params a ON a.id = b.asset_class_id ORDER BY b.bucket",
      )
      .all();
    expect(links).toEqual([
      { bucket: "cash", name: "Cash" },
      { bucket: "intl_bond", name: "International Bonds" },
      { bucket: "intl_equity", name: "International Equities" },
      { bucket: "tips", name: "TIPS" },
      { bucket: "us_bond", name: "US Bonds" },
      { bucket: "us_equity", name: "US Equities" },
    ]);
    for (const { bucket } of readSimulationPresetsFile().asset_class_buckets)
      expect(COMPOSITION_BUCKET_VALUES).toContain(bucket);
  });
});

describe("the shipped presets match the methodology page", () => {
  const file = readSimulationPresetsFile();
  const preset = (key: string) => file.mc_presets.find((p) => p.key === key)!;
  const first = (key: string) => glidePath(file, key)[0]!;
  const last = (key: string) => glidePath(file, key).at(-1)!;

  it("every glide-path age sums to 100%", () => {
    for (const p of file.mc_presets)
      for (const [age, alloc] of glidePath(file, p.key))
        expect(
          Object.values(alloc).reduce((a, b) => a + b, 0),
          `${p.key} ${age}`,
        ).toBeCloseTo(1, 9);
  });

  it("Aggressive: 0.9x volatility, 95% stocks at 25 down to 35% at 85", () => {
    expect(preset("aggressive").vol_multiplier).toBe(0.9);
    expect(preset("aggressive").return_multiplier).toBe(1);
    expect(first("aggressive")[0]).toBe(25);
    expect(stockShare(first("aggressive")[1])).toBeCloseTo(0.95, 9);
    expect(last("aggressive")[0]).toBe(85);
    expect(stockShare(last("aggressive")[1])).toBeCloseTo(0.35, 9);
  });

  it("Default: historical returns, standard volatility, 90% stocks at 25", () => {
    expect(preset("default").return_multiplier).toBe(1);
    expect(preset("default").vol_multiplier).toBe(1);
    expect(stockShare(first("default")[1])).toBeCloseTo(0.9, 9);
  });

  it("Default preset keeps its 50% equity floor", () => {
    // Class names → numeric ids, the shape the Simulation interpolates.
    const id = (name: string) =>
      file.asset_class_params.findIndex((c) => c.name === name);
    const path = glidePath(file, "default").map(([age, alloc]) => ({
      age,
      allocations: Object.fromEntries(
        Object.entries(alloc).map(([name, w]) => [id(name), w]),
      ),
    }));
    const stockIds = STOCK_CLASSES.map(id);
    // Every age the Simulation can reach, interpolated as it is.
    for (let age = 18; age <= 110; age++) {
      const alloc = interpolateAllocations(path, age);
      expect(
        stockIds.reduce((s, i) => s + (alloc[i] ?? 0), 0),
        `age ${age}`,
      ).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
    expect(stockShare(last("default")[1])).toBeCloseTo(0.5, 9);
  });

  it("Conservative: forward-looking ~5% equity, +15% volatility, 3% / 1.5% inflation, heavy bonds", () => {
    const c = preset("conservative");
    expect(c.vol_multiplier).toBe(1.15);
    expect(c.inflation_mean).toBe(0.03);
    expect(c.inflation_std_dev).toBe(0.015);
    const overrides = new Map(
      file.mc_preset_return_overrides
        .filter((r) => r.preset === "conservative")
        .map((r) => [r.asset_class, r.mean_return]),
    );
    for (const cls of STOCK_CLASSES)
      expect(overrides.get(cls)!, cls).toBeCloseTo(0.05, 2);
    expect(stockShare(first("conservative")[1])).toBeCloseTo(0.75, 9);
    expect(stockShare(last("conservative")[1])).toBeCloseTo(0.15, 9);
  });

  it("asset class parameters: the table's mean return and standard deviation", () => {
    const stated: Record<string, [number, number]> = {
      "US Equities": [0.1, 0.16],
      "International Equities": [0.08, 0.17],
      "US Bonds": [0.05, 0.05],
      TIPS: [0.035, 0.04],
      Cash: [0.03, 0.01],
    };
    for (const [name, [mean, sd]] of Object.entries(stated)) {
      const c = file.asset_class_params.find((a) => a.name === name);
      expect(c, name).toBeDefined();
      expect([c!.mean_return, c!.std_dev], name).toEqual([mean, sd]);
    }
  });
});
