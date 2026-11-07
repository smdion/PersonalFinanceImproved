/**
 * What a Simulation preset means, one definition: returns (run changes >
 * saved changes > preset return overrides > multiplier > table), the glide
 * path (the preset's, else Custom's table), and every reader of it.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";
import { clearSimulationPresets } from "../helpers/db-harness";
import * as sqlite from "@/lib/db/schema-sqlite";
import {
  loadSimulationPreset,
  presetAssetClasses,
} from "@/server/services/simulation/simulation-preset";
import { computeCurrentStockAllocationPercent } from "@/lib/pure/simulation/stock-share";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";

describe("simulation presets", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let stocks: number;
  let bonds: number;
  const classes = () => [
    { id: stocks, name: "Stocks", meanReturn: 0.1, stdDev: 0.2 },
    { id: bonds, name: "Bonds", meanReturn: 0.04, stdDev: 0.05 },
  ];

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    clearSimulationPresets(db);
    const cls = (name: string) =>
      db
        .insert(sqlite.assetClassParams)
        .values({ name, meanReturn: "0.07", stdDev: "0.15" })
        .returning()
        .get().id;
    stocks = cls("Preset Stocks");
    bonds = cls("Preset Bonds");
    db.insert(sqlite.assetClassBuckets)
      .values([
        { bucket: "us_equity", assetClassId: stocks },
        { bucket: "us_bond", assetClassId: bonds },
      ])
      .run();
    const preset = (key: string, returnMultiplier: string) =>
      db
        .insert(sqlite.mcPresets)
        .values({
          key,
          label: key,
          description: key,
          returnMultiplier,
          volMultiplier: "1.5",
          inflationMean: "0.03",
          inflationStdDev: "0.01",
          defaultTrials: 1000,
          returnClampMin: "-0.4",
          returnClampMax: "0.5",
        })
        .returning()
        .get().id;
    const def = preset("default", "0.5");
    preset("conservative", "0.5");
    db.insert(sqlite.mcPresetGlidePaths)
      .values([
        { presetId: def, age: 60, assetClassId: stocks, allocation: "0.6" },
        { presetId: def, age: 60, assetClassId: bonds, allocation: "0.4" },
      ])
      .run();
    db.insert(sqlite.mcPresetReturnOverrides)
      .values({ presetId: def, assetClassId: stocks, meanReturn: "0.06" })
      .run();
    db.insert(sqlite.glidePathAllocations)
      .values([
        { age: 60, assetClassId: stocks, allocation: "0.3" },
        { age: 60, assetClassId: bonds, allocation: "0.7" },
      ])
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("a named preset: its glide path, return overrides, multiplier for the rest, volatility", async () => {
    const p = await loadSimulationPreset(ctx.db as never, "default");
    expect(p.found).toBe(true);
    expect(p.glidePath[0]!.allocations[stocks]).toBeCloseTo(0.6);
    const [s, b] = presetAssetClasses(classes(), p);
    expect(s!.meanReturn).toBeCloseTo(0.06);
    expect(b!.meanReturn).toBeCloseTo(0.02);
    expect(s!.stdDev).toBeCloseTo(0.3);
  });

  it("Custom: the household's table, unadjusted", async () => {
    const p = await loadSimulationPreset(ctx.db as never, "custom");
    expect(p.found).toBe(true);
    expect(p.glidePath[0]!.allocations[stocks]).toBeCloseTo(0.3);
    expect(presetAssetClasses(classes(), p)[0]!.meanReturn).toBe(0.1);
  });

  it("a named preset without a glide path falls back to Custom's", async () => {
    const p = await loadSimulationPreset(ctx.db as never, "conservative");
    expect(p.glidePath[0]!.allocations[stocks]).toBeCloseTo(0.3);
  });

  it("a preset with no row isn't found", async () => {
    const p = await loadSimulationPreset(ctx.db as never, "aggressive");
    expect(p.found).toBe(false);
  });

  it("a run's change beats the saved one, which beats the preset", async () => {
    ctx.db
      .insert(sqlite.appSettings)
      .values({
        key: "mc_asset_class_overrides",
        value: [
          { id: stocks, meanReturn: 0.08 },
          { id: bonds, meanReturn: 0.03 },
        ],
      })
      .run();
    const p = await loadSimulationPreset(ctx.db as never, "default");
    const [s, b] = presetAssetClasses(classes(), p, [
      { id: stocks, meanReturn: 0.09 },
    ]);
    expect(s!.meanReturn).toBe(0.09);
    expect(b!.meanReturn).toBe(0.03);
  });

  it("the glide-path check reads the Default preset, not Custom's table", async () => {
    expect(
      computeCurrentStockAllocationPercent(
        await fetchRetirementData(ctx.db as never),
        60,
      ),
    ).toBeCloseTo(60, 1);
  });
});
