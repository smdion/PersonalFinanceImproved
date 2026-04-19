/**
 * Tests for display-labels utility functions.
 * Covers emptyTaxBucketMap and wealthScoreTier.
 */
import { describe, it, expect } from "vitest";
import {
  emptyTaxBucketMap,
  wealthScoreTier,
} from "@/lib/config/display-labels";

describe("emptyTaxBucketMap", () => {
  it("returns a zero-initialized tax bucket map", () => {
    const map = emptyTaxBucketMap();
    expect(map).toEqual({ preTax: 0, taxFree: 0, hsa: 0, afterTax: 0 });
  });

  it("returns a fresh object each call", () => {
    const a = emptyTaxBucketMap();
    const b = emptyTaxBucketMap();
    a.preTax = 999;
    expect(b.preTax).toBe(0);
  });
});

describe("wealthScoreTier", () => {
  it("returns PAW for score >= 2.0", () => {
    const result = wealthScoreTier(2.5);
    expect(result.tier).toBe("paw");
    expect(result.label).toContain("PAW");
    expect(result.shortLabel).toContain("PAW");
  });

  it("returns PAW at the 2.0 boundary", () => {
    const result = wealthScoreTier(2.0);
    expect(result.tier).toBe("paw");
  });

  it("returns AAW for score >= 1.0 and < 2.0", () => {
    const result = wealthScoreTier(1.5);
    expect(result.tier).toBe("aaw");
    expect(result.label).toContain("AAW");
    expect(result.shortLabel).toContain("AAW");
  });

  it("returns AAW at the 1.0 boundary", () => {
    const result = wealthScoreTier(1.0);
    expect(result.tier).toBe("aaw");
  });

  it("returns UAW for score < 1.0", () => {
    const result = wealthScoreTier(0.5);
    expect(result.tier).toBe("uaw");
    expect(result.label).toContain("UAW");
    expect(result.shortLabel).toContain("UAW");
  });

  it("returns UAW at zero", () => {
    const result = wealthScoreTier(0);
    expect(result.tier).toBe("uaw");
  });
});
