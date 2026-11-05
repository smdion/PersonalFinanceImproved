import "../../../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { clearSimulationPresets } from "../../../helpers/db-harness";

describe("computeCurrentStockAllocationPercent (M6)", () => {
  // The glide path's stock share at an age — the same helper VPW sizes by
  // (lib/pure/simulation/stock-share.ts, which has the interpolation cases).
  it("the mapped stock share at the age; null without a glide path or mapping", async () => {
    const { createTestCaller } = await import("../../../routers/setup");
    const { computeCurrentStockAllocationPercent } =
      await import("@/server/services/projection/projection-run");
    const { fetchRetirementData } =
      await import("@/server/services/projection/engine-payload/build-engine-payload");
    const sqlite = await import("@/lib/db/schema-sqlite");
    const { db, cleanup } = await createTestCaller();
    try {
      clearSimulationPresets(db);
      expect(
        computeCurrentStockAllocationPercent(
          await fetchRetirementData(db as never),
          35,
        ),
      ).toBeNull();
      const cls = (name: string) =>
        db
          .insert(sqlite.assetClassParams)
          .values({ name, meanReturn: "0.07", stdDev: "0.15" })
          .returning()
          .get().id;
      const stocks = cls("Example Stocks");
      const bonds = cls("Example Bonds");
      db.insert(sqlite.glidePathAllocations)
        .values([
          { age: 30, assetClassId: stocks, allocation: "0.8" },
          { age: 30, assetClassId: bonds, allocation: "0.2" },
          { age: 40, assetClassId: stocks, allocation: "0.4" },
          { age: 40, assetClassId: bonds, allocation: "0.6" },
        ])
        .run();
      db.delete(sqlite.assetClassBuckets).run();
      // Nothing mapped: unknown, not "all bonds".
      expect(
        computeCurrentStockAllocationPercent(
          await fetchRetirementData(db as never),
          35,
        ),
      ).toBeNull();
      db.insert(sqlite.assetClassBuckets)
        .values([
          { bucket: "us_equity", assetClassId: stocks },
          { bucket: "us_bond", assetClassId: bonds },
        ])
        .run();
      expect(
        computeCurrentStockAllocationPercent(
          await fetchRetirementData(db as never),
          35,
        ),
      ).toBeCloseTo(60, 1);
    } finally {
      cleanup();
    }
  });
});
