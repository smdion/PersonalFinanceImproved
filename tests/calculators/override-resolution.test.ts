/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
import { describe, it, expect } from "vitest";
import {
  resolveAccumulationConfig,
  resolveDecumulationConfig,
} from "@/lib/calculators/engine/override-resolution";
import {
  makeAccumulationDefaults,
  makeDecumulationDefaults,
} from "./fixtures/engine-fixtures";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";

describe("resolveAccumulationConfig", () => {
  const defaults = makeAccumulationDefaults();

  it("returns defaults when no overrides", () => {
    const config = resolveAccumulationConfig(2025, defaults, []);
    expect(config.contributionRate).toBe(0.25);
    expect(config.routingMode).toBe("waterfall");
    expect(config.accountOrder).toEqual(defaults.accountOrder);
  });

  it("applies sticky-forward contributionRate", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, contributionRate: 0.3 },
    ];
    const config2025 = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config2025.contributionRate).toBe(0.3);

    // Still applied in 2027 (sticky-forward)
    const config2027 = resolveAccumulationConfig(2027, defaults, overrides);
    expect(config2027.contributionRate).toBe(0.3);
  });

  it("later override replaces earlier for same field", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, contributionRate: 0.3 },
      { year: 2028, contributionRate: 0.4 },
    ];
    const config2027 = resolveAccumulationConfig(2027, defaults, overrides);
    expect(config2027.contributionRate).toBe(0.3);

    const config2030 = resolveAccumulationConfig(2030, defaults, overrides);
    expect(config2030.contributionRate).toBe(0.4);
  });

  it("fields are independent — setting rate doesn't affect taxSplits", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, contributionRate: 0.5 },
    ];
    const config = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config.contributionRate).toBe(0.5);
    expect(config.taxSplits).toEqual(defaults.taxSplits);
  });

  it("merges accountSplits (spread)", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, accountSplits: { "401k": 0.8 } },
    ];
    const config = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config.accountSplits["401k"]).toBe(0.8);
    // Other splits preserved from defaults
    expect(config.accountSplits.hsa).toBe(0.15);
  });

  it("merges accountCaps — null removes a cap", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, accountCaps: { "401k": 15000 } },
      { year: 2027, accountCaps: { "401k": null } },
    ];
    const config2026 = resolveAccumulationConfig(2026, defaults, overrides);
    expect(config2026.accountCaps["401k"]).toBe(15000);

    const config2028 = resolveAccumulationConfig(2028, defaults, overrides);
    expect(config2028.accountCaps["401k"]).toBeNull();
  });

  it("reset reverts all fields to defaults", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, contributionRate: 0.5, routingMode: "percentage" },
      { year: 2028, reset: true },
    ];
    const config2027 = resolveAccumulationConfig(2027, defaults, overrides);
    expect(config2027.contributionRate).toBe(0.5);
    expect(config2027.routingMode).toBe("percentage");

    const config2029 = resolveAccumulationConfig(2029, defaults, overrides);
    expect(config2029.contributionRate).toBe(defaults.contributionRate);
    expect(config2029.routingMode).toBe(defaults.routingMode);
  });

  it("ignores overrides for future years", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2030, contributionRate: 0.9 },
    ];
    const config = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config.contributionRate).toBe(defaults.contributionRate);
  });

  it("lump sums are exact-year only (not sticky)", () => {
    const overrides: AccumulationOverride[] = [
      {
        year: 2025,
        lumpSums: [{ amount: 50000, taxBucket: "afterTax" as unknown }],
      },
    ];
    const config2025 = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config2025.lumpSums).toHaveLength(1);

    const config2026 = resolveAccumulationConfig(2026, defaults, overrides);
    expect(config2026.lumpSums).toHaveLength(0);
  });

  it("applies taxTypeCaps with selective merge", () => {
    const overrides: AccumulationOverride[] = [
      { year: 2025, taxTypeCaps: { roth: 20000 } },
    ];
    const config = resolveAccumulationConfig(2025, defaults, overrides);
    expect(config.taxTypeCaps.roth).toBe(20000);
    expect(config.taxTypeCaps.traditional).toBeNull(); // untouched
  });
});

describe("resolveDecumulationConfig", () => {
  const defaults = makeDecumulationDefaults();

  it("returns defaults when no overrides", () => {
    const config = resolveDecumulationConfig(2050, defaults, []);
    expect(config.withdrawalRate).toBe(0.04);
    expect(config.withdrawalRoutingMode).toBe("bracket_filling");
  });

  it("applies sticky-forward withdrawalRate", () => {
    const overrides: DecumulationOverride[] = [
      { year: 2050, withdrawalRate: 0.035 },
    ];
    const config = resolveDecumulationConfig(2055, defaults, overrides);
    expect(config.withdrawalRate).toBe(0.035);
  });

  it("applies sticky-forward rothConversionTarget", () => {
    const overrides: DecumulationOverride[] = [
      { year: 2050, rothConversionTarget: 0.22 },
    ];
    const config = resolveDecumulationConfig(2055, defaults, overrides);
    expect(config.rothConversionTarget).toBe(0.22);
  });

  it("merges withdrawalSplits per-category", () => {
    const overrides: DecumulationOverride[] = [
      { year: 2050, withdrawalSplits: { "401k": 0.6 } },
    ];
    const config = resolveDecumulationConfig(2050, defaults, overrides);
    expect(config.withdrawalSplits["401k"]).toBe(0.6);
    expect(config.withdrawalSplits.ira).toBe(0.2); // unchanged
  });

  it("merges withdrawalTaxPreference", () => {
    const overrides: DecumulationOverride[] = [
      { year: 2050, withdrawalTaxPreference: { "401k": "roth" } },
    ];
    const config = resolveDecumulationConfig(2050, defaults, overrides);
    expect(config.withdrawalTaxPreference["401k"]).toBe("roth");
    expect(config.withdrawalTaxPreference.ira).toBe("traditional"); // unchanged
  });

  it("reset reverts all decumulation fields", () => {
    const overrides: DecumulationOverride[] = [
      { year: 2050, withdrawalRate: 0.05, rothConversionTarget: 0.22 },
      { year: 2055, reset: true },
    ];
    const config2053 = resolveDecumulationConfig(2053, defaults, overrides);
    expect(config2053.withdrawalRate).toBe(0.05);

    const config2056 = resolveDecumulationConfig(2056, defaults, overrides);
    expect(config2056.withdrawalRate).toBe(defaults.withdrawalRate);
  });

  it("lump sums are exact-year only", () => {
    const overrides: DecumulationOverride[] = [
      {
        year: 2050,
        lumpSums: [{ amount: 100000, taxBucket: "preTax" as unknown }],
      },
    ];
    const config2050 = resolveDecumulationConfig(2050, defaults, overrides);
    expect(config2050.lumpSums).toHaveLength(1);

    const config2051 = resolveDecumulationConfig(2051, defaults, overrides);
    expect(config2051.lumpSums).toHaveLength(0);
  });
});
