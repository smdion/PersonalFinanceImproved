/**
 * Coverage tests for src/server/routers/_shared.ts
 *
 * The file is declaration-only (documentation + re-exports comment).
 * There is nothing executable to test. This test file exercises the
 * settings/_shared.ts exports (zDecimal, settingValue, recomputeAnnualRollups)
 * that are actually used by routers.
 *
 * The recomputeAnnualRollups function is already tested in shared-rollups.test.ts.
 * This file covers zDecimal and settingValue validation schemas.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import { zDecimal, settingValue } from "@/server/routers/settings/_shared";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

describe("zDecimal validation", () => {
  it("accepts a valid decimal string", () => {
    expect(zDecimal.safeParse("123.45").success).toBe(true);
  });

  it("accepts an integer string", () => {
    expect(zDecimal.safeParse("100").success).toBe(true);
  });

  it("accepts negative numbers", () => {
    expect(zDecimal.safeParse("-50.25").success).toBe(true);
  });

  it("accepts zero", () => {
    expect(zDecimal.safeParse("0").success).toBe(true);
  });

  it("rejects non-numeric string", () => {
    expect(zDecimal.safeParse("abc").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(zDecimal.safeParse("").success).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(zDecimal.safeParse("   ").success).toBe(false);
  });
});

describe("settingValue validation", () => {
  it("accepts a string value", () => {
    expect(settingValue.safeParse("hello").success).toBe(true);
  });

  it("accepts a number value", () => {
    expect(settingValue.safeParse(42).success).toBe(true);
  });

  it("accepts a boolean value", () => {
    expect(settingValue.safeParse(true).success).toBe(true);
  });

  it("accepts null", () => {
    expect(settingValue.safeParse(null).success).toBe(true);
  });

  it("accepts an object", () => {
    expect(settingValue.safeParse({ key: "value" }).success).toBe(true);
  });

  it("accepts an array", () => {
    expect(settingValue.safeParse([1, 2, 3]).success).toBe(true);
  });
});
