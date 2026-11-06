import { describe, it, expect } from "vitest";
import {
  classifyAssetClasses,
  computeCurrentStockAllocationPercent,
  glidePathFromRows,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";

describe("stock share by age", () => {
  const glide = glidePathFromRows([
    { age: 60, assetClassId: 1, allocation: "0.8" },
    { age: 60, assetClassId: 2, allocation: "0.2" },
    { age: 70, assetClassId: 1, allocation: "0.4" },
    { age: 70, assetClassId: 2, allocation: "0.6" },
  ]);
  // Class 1 holds a stock bucket among others; class 2 is bonds only.
  const classes = classifyAssetClasses([
    { assetClassId: 1, bucket: "us_equity" },
    { assetClassId: 1, bucket: "us_bond" },
    { assetClassId: 2, bucket: "us_bond" },
  ]);

  it("a class with any stock bucket counts as stocks", () => {
    expect([...classes.stocks]).toEqual([1]);
    expect([...classes.mapped].sort()).toEqual([1, 2]);
  });

  it("interpolates between glide-path ages and holds outside them", () => {
    const share = stockShareByAge(glide, classes, 58, 72)!;
    expect(share[58]).toBeCloseTo(0.8);
    expect(share[65]).toBeCloseTo(0.6);
    expect(share[72]).toBeCloseTo(0.4);
  });

  it("no glide path: none (the strategy uses its own)", () => {
    expect(stockShareByAge([], classes, 60, 70)).toBeNull();
  });

  it("unmapped classes are unknown, never bonds: share of the mapped part, none if nothing's mapped", () => {
    const withUnmapped = glidePathFromRows([
      { age: 60, assetClassId: 1, allocation: "0.5" },
      { age: 60, assetClassId: 2, allocation: "0.25" },
      { age: 60, assetClassId: 9, allocation: "0.25" },
    ]);
    expect(stockShareByAge(withUnmapped, classes, 60, 60)![60]).toBeCloseTo(
      0.5 / 0.75,
    );
    expect(
      stockShareByAge(withUnmapped, classifyAssetClasses([]), 60, 60),
    ).toBeNull();
  });

  it("Plan Health's stock allocation: the percent at the whole age, one decimal; null when there's none", () => {
    const bucketRows = [
      { assetClassId: 1, bucket: "us_equity" as const },
      { assetClassId: 2, bucket: "us_bond" as const },
    ];
    // 63 is 30% of the way from 60 (80%) to 70 (40%): 80 − 12 = 68.
    expect(
      computeCurrentStockAllocationPercent(
        { defaultPreset: { glidePath: glide }, classBucketRows: bucketRows },
        63.9,
      ),
    ).toBeCloseTo(68, 10);
    // 0.5 of the 0.75 that's mapped: 66.666… → 66.7.
    const withUnmapped = glidePathFromRows([
      { age: 60, assetClassId: 1, allocation: "0.5" },
      { age: 60, assetClassId: 2, allocation: "0.25" },
      { age: 60, assetClassId: 9, allocation: "0.25" },
    ]);
    expect(
      computeCurrentStockAllocationPercent(
        {
          defaultPreset: { glidePath: withUnmapped },
          classBucketRows: bucketRows,
        },
        60,
      ),
    ).toBe(66.7);
    expect(
      computeCurrentStockAllocationPercent(
        { defaultPreset: { glidePath: [] }, classBucketRows: bucketRows },
        60,
      ),
    ).toBeNull();
    expect(
      computeCurrentStockAllocationPercent(
        { defaultPreset: { glidePath: glide }, classBucketRows: [] },
        60,
      ),
    ).toBeNull();
  });
});
