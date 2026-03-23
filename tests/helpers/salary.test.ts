import { describe, it, expect, vi } from "vitest";

// Mock DB schema to avoid pg driver import
vi.mock("@/lib/db/schema", () => ({
  salaryChanges: {},
  jobs: {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { computeBonusGross } from "@/server/helpers/salary";

describe("computeBonusGross", () => {
  it("computes bonus from percent and multiplier", () => {
    // $120,000 salary × 10% bonus × 1.0 multiplier × (12/12 months)
    expect(computeBonusGross(120000, "0.10", "1", null, null)).toBe(12000);
  });

  it("applies bonusMultiplier", () => {
    // $120,000 × 10% × 1.5 = $18,000
    expect(computeBonusGross(120000, "0.10", "1.5", null, null)).toBe(18000);
  });

  it("returns override directly when set", () => {
    expect(computeBonusGross(120000, "0.10", "1", "15000", null)).toBe(15000);
  });

  it("returns 0 when bonus percent is 0", () => {
    expect(computeBonusGross(120000, "0", "1", null, null)).toBe(0);
  });

  it("returns 0 when bonus percent is null", () => {
    expect(computeBonusGross(120000, null, null, null, null)).toBe(0);
  });

  it("prorates for partial bonus year", () => {
    // $120,000 × 10% × 1 × (6/12) = $6,000
    expect(computeBonusGross(120000, "0.10", "1", null, 6)).toBe(6000);
  });

  it("defaults multiplier to 1 when null", () => {
    expect(computeBonusGross(120000, "0.10", null, null, null)).toBe(12000);
  });

  it("defaults multiplier to 1 when zero", () => {
    // "0" multiplier fallback → 1
    expect(computeBonusGross(120000, "0.10", "0", null, null)).toBe(12000);
  });

  it("defaults monthsInBonusYear to 12 when null", () => {
    expect(computeBonusGross(120000, "0.10", "1", null, null)).toBe(12000);
  });

  it("rounds to cents", () => {
    // 100000 × 0.15 × 1.1 × (12/12) = 16500.000...
    const result = computeBonusGross(100000, "0.15", "1.1", null, null);
    expect(result).toBe(16500);
    // Check that the result has at most 2 decimal places
    expect(Math.round(result * 100)).toBe(result * 100);
  });
});
