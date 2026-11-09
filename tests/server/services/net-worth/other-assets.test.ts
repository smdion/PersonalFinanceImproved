/**
 * getEffectiveOtherAssetsDetailed carries each asset's latest entry forward;
 * getEffectiveOtherAssets returns the total.
 */
import "../../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getEffectiveOtherAssets,
  getEffectiveOtherAssetsDetailed,
} from "@/server/services/net-worth/other-assets";
import { createTestDb, type TestDbContext } from "../../../helpers/db-harness";

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveOtherAssetsDetailed — carry-forward logic (lines 96-125)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveOtherAssetsDetailed — carry-forward", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("carries forward latest entry for each asset name", async () => {
    const currentYear = new Date().getFullYear();

    // Insert asset items for multiple years
    ctx.db
      .insert(ctx.schema.otherAssetItems)
      .values([
        { name: "Car", year: currentYear - 2, value: "20000" },
        { name: "Car", year: currentYear - 1, value: "18000" },
        { name: "Car", year: currentYear, value: "16000" },
        { name: "Boat", year: currentYear - 1, value: "30000" },
        // Boat has no current year entry — should carry forward from last year
      ])
      .run();

    const settings: { key: string; value: unknown }[] = [];
    const result = await getEffectiveOtherAssetsDetailed(
      ctx.rawDb,
      settings,
      new Date(),
    );

    expect(result.items.length).toBe(2);

    const car = result.items.find((i) => i.name === "Car");
    expect(car).toBeDefined();
    expect(car!.value).toBe(16000);
    expect(car!.sourceYear).toBe(currentYear);

    const boat = result.items.find((i) => i.name === "Boat");
    expect(boat).toBeDefined();
    expect(boat!.value).toBe(30000);
    expect(boat!.sourceYear).toBe(currentYear - 1);

    expect(result.total).toBe(16000 + 30000);
  });

  it("excludes assets with zero value", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([
          { name: "Sold Car", year: currentYear, value: "0" },
          { name: "Valuable Art", year: currentYear, value: "5000" },
        ])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
        new Date(),
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Valuable Art");
      expect(result.total).toBe(5000);
    } finally {
      ctx2.cleanup();
    }
  });

  it("excludes future-year entries", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([
          { name: "Future Asset", year: currentYear + 5, value: "99999" },
          { name: "Current Asset", year: currentYear, value: "10000" },
        ])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
        new Date(),
      );

      // Future asset should be excluded
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Current Asset");
      expect(result.total).toBe(10000);
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns items with id from DB rows", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([{ name: "House Equity", year: currentYear, value: "50000" }])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
        new Date(),
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0]!.id).not.toBeNull();
      expect(typeof result.items[0]!.id).toBe("number");
    } finally {
      ctx2.cleanup();
    }
  });

  it("falls back to manual scalar when no items exist", async () => {
    const ctx2 = await createTestDb();
    try {
      ctx2.db
        .insert(ctx2.schema.appSettings)
        .values({ key: "current_other_assets", value: 25000 })
        .run();

      const settings = ctx2.db.select().from(ctx2.schema.appSettings).all();

      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings as { key: string; value: unknown }[],
        new Date(),
      );

      expect(result.total).toBe(25000);
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Other Assets");
      expect(result.items[0]!.id).toBeNull();
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns empty items and zero total when no items and no manual setting", async () => {
    const ctx2 = await createTestDb();
    try {
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        [],
        new Date(),
      );
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    } finally {
      ctx2.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveOtherAssets — delegates to detailed version (line 76)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveOtherAssets — returns total only", () => {
  it("returns numeric total from items", async () => {
    const ctx = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();
      ctx.db
        .insert(ctx.schema.otherAssetItems)
        .values([
          { name: "Asset A", year: currentYear, value: "10000" },
          { name: "Asset B", year: currentYear, value: "5000" },
        ])
        .run();

      const result = await getEffectiveOtherAssets(ctx.rawDb, [], new Date());
      expect(result).toBe(15000);
    } finally {
      ctx.cleanup();
    }
  });
});
