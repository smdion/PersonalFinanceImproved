/**
 * Tests for src/lib/pure/glide-path.ts
 */
import { describe, it, expect } from "vitest";
import { recommendedStockPercent, checkGlidePath } from "@/lib/pure/glide-path";

describe("recommendedStockPercent (110-age rule)", () => {
  it("returns 80 for age 30", () => {
    expect(recommendedStockPercent(30)).toBe(80);
  });
  it("returns 60 for age 50", () => {
    expect(recommendedStockPercent(50)).toBe(60);
  });
  it("returns 50 for age 60", () => {
    expect(recommendedStockPercent(60)).toBe(50);
  });
  it("clamps to 0 at very old age", () => {
    expect(recommendedStockPercent(120)).toBe(0);
  });
  it("clamps to 100 for negative-age safety", () => {
    expect(recommendedStockPercent(-10)).toBe(100);
  });
});

describe("checkGlidePath", () => {
  it("returns null when within ±10pp tolerance", () => {
    // Age 50 → recommend 60. 50–70 is in tolerance.
    expect(checkGlidePath(50, 60)).toBeNull();
    expect(checkGlidePath(50, 70)).toBeNull();
    expect(checkGlidePath(50, 50)).toBeNull();
  });

  it("returns 'info' for 10-20pp deviation", () => {
    // Age 50 → recommend 60. 75 is +15pp (within 11-20pp band).
    const w = checkGlidePath(50, 75);
    expect(w?.severity).toBe("info");
    expect(w?.deviationPoints).toBe(15);
  });

  it("returns 'warn' for 20-35pp deviation (audit's main concern)", () => {
    // Age 60 → recommend 50. 85% stock is +35pp.
    const w = checkGlidePath(60, 85);
    expect(w?.severity).toBe("warn");
    expect(w?.message).toMatch(/110.*age|aggressive/i);
  });

  it("returns 'danger' for >35pp deviation (very aggressive at old age)", () => {
    // Age 65 → recommend 45. 95% stock is +50pp.
    const w = checkGlidePath(65, 95);
    expect(w?.severity).toBe("danger");
    expect(w?.deviationPoints).toBe(50);
  });

  it("returns 'warn' for very conservative allocations too", () => {
    // Age 30 → recommend 80. 40% stock is -40pp.
    const w = checkGlidePath(30, 40);
    expect(w?.severity).toBe("danger");
    expect(w?.message).toMatch(/conservative/i);
  });

  it("returns null for invalid inputs", () => {
    expect(checkGlidePath(NaN, 60)).toBeNull();
    expect(checkGlidePath(50, NaN)).toBeNull();
    expect(checkGlidePath(-1, 60)).toBeNull();
    expect(checkGlidePath(50, 110)).toBeNull();
    expect(checkGlidePath(50, -5)).toBeNull();
  });

  it("includes recommended + current in the warning struct", () => {
    const w = checkGlidePath(60, 90);
    expect(w?.currentStockPercent).toBe(90);
    expect(w?.recommendedStockPercent).toBe(50);
  });
});
