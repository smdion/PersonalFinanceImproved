/**
 * Tests for pure historical data temporal resolution logic.
 * Covers: resolveCarryForwardAssetValue,
 * resolveOtherAssetsForYear, computeHomeImpCumulative.
 */
import { describe, it, expect } from "vitest";
import {
  resolveCarryForwardAssetValue,
  resolveOtherAssetsForYear,
  computeHomeImpCumulative,
} from "@/lib/pure/net-worth/historical";

describe("resolveCarryForwardAssetValue", () => {
  const items = [
    { name: "Car", year: 2020, value: "15000", note: "Toyota" },
    { name: "Car", year: 2022, value: "12000", note: "depreciated" },
    { name: "Car", year: 2024, value: "0", note: "sold" },
    { name: "Boat", year: 2021, value: "30000", note: null },
  ];

  it("returns most recent value at-or-before year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2021);
    expect(result).toEqual({
      value: 15000,
      note: "Toyota",
      yearRecorded: 2020,
    });
  });

  it("returns updated value after change year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2023);
    expect(result).toEqual({
      value: 12000,
      note: "depreciated",
      yearRecorded: 2022,
    });
  });

  it("returns null when value drops to 0", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2024);
    expect(result).toBeNull();
  });

  it("returns null when no entries before year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2019);
    expect(result).toBeNull();
  });

  it("carries forward correctly across years", () => {
    const result = resolveCarryForwardAssetValue(items, "Boat", 2025);
    expect(result).toEqual({ value: 30000, note: null, yearRecorded: 2021 });
  });

  it("passes through id when present (audit Batch 8 F1 — assets.ts needs it for sync lookups)", () => {
    const itemsWithId = [
      { id: 42, name: "Car", year: 2020, value: "15000", note: "Toyota" },
    ];
    const result = resolveCarryForwardAssetValue(itemsWithId, "Car", 2021);
    expect(result).toEqual({
      id: 42,
      value: 15000,
      note: "Toyota",
      yearRecorded: 2020,
    });
  });
});

describe("resolveOtherAssetsForYear", () => {
  const assets = [
    { name: "Car", year: 2020, value: "15000", note: null },
    { name: "Boat", year: 2021, value: "30000", note: "new" },
    { name: "Car", year: 2023, value: "0", note: "sold" },
  ];

  it("includes only positive-value assets", () => {
    const result = resolveOtherAssetsForYear(assets, 2022);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(45000);
  });

  it("excludes zero-value assets after disposal", () => {
    const result = resolveOtherAssetsForYear(assets, 2024);
    expect(result.items).toHaveLength(1); // only Boat
    expect(result.total).toBe(30000);
  });

  it("passes through id when present, omits it when absent", () => {
    const withId = resolveOtherAssetsForYear(
      [{ id: 1, name: "Car", year: 2020, value: "15000", note: null }],
      2022,
    );
    expect(withId.items[0]!.id).toBe(1);

    const withoutId = resolveOtherAssetsForYear(
      [{ name: "Car", year: 2020, value: "15000", note: null }],
      2022,
    );
    expect(withoutId.items[0]!.id).toBeUndefined();
  });
});

describe("computeHomeImpCumulative", () => {
  const items = [
    { year: 2019, cost: "5000" },
    { year: 2020, cost: "15000" },
    { year: 2022, cost: "8000" },
  ];

  it("sums up to target year", () => {
    expect(computeHomeImpCumulative(items, 2020)).toBe(20000);
  });

  it("includes all items when past last year", () => {
    expect(computeHomeImpCumulative(items, 2025)).toBe(28000);
  });

  it("returns 0 for year before first item", () => {
    expect(computeHomeImpCumulative(items, 2018)).toBe(0);
  });

  it("handles null costs", () => {
    expect(
      computeHomeImpCumulative(
        [
          { year: 2020, cost: null },
          { year: 2021, cost: "5000" },
        ],
        2021,
      ),
    ).toBe(5000);
  });
});
