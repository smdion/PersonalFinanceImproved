/**
 * Withdrawal Rate Sensitivity Tests
 *
 * Validates that success rates respond correctly to changes in withdrawal rate
 * and time horizon, and documents your real-scenario sensitivity curve.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeTrinityInput,
  makeMCInput,
  IBBOTSON_CLASSES,
  make7525GlidePath,
} from "./benchmark-helpers";

const STOCK_BOND_CORRELATIONS = [
  { classAId: 1, classBId: 3, correlation: -0.1 },
];

describe("Withdrawal rate sensitivity", () => {
  describe("SWR sweep — monotonically decreasing success rates", () => {
    const swrRates = [0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06];
    const results: { swr: number; successRate: number }[] = [];

    // Run all scenarios first
    for (const swr of swrRates) {
      const engine = makeTrinityInput({
        decumulationDefaults: {
          withdrawalRate: swr,
          withdrawalRoutingMode: "waterfall",
          withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
          withdrawalSplits: {
            "401k": 0,
            "403b": 0,
            ira: 0,
            brokerage: 1,
            hsa: 0,
          },
          withdrawalTaxPreference: {},
          distributionTaxRates: {
            traditionalFallbackRate: 0,
            roth: 0,
            hsa: 0,
            brokerage: 0,
          },
        },
        annualExpenses: 1000000 * swr,
      });
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });
      const result = calculateMonteCarlo(mc);
      results.push({ swr, successRate: result.successRate });
    }

    it("success rates are monotonically non-increasing as SWR increases", () => {
      for (let i = 1; i < results.length; i++) {
        expect(
          results[i]!.successRate,
          `SWR ${results[i]!.swr * 100}% should have ≤ success than ${results[i - 1]!.swr * 100}%`,
        ).toBeLessThanOrEqual(results[i - 1]!.successRate + 0.01); // 1pp tolerance for MC noise
      }
    });

    it("3% SWR has > 97% success", () => {
      expect(results[0]!.successRate).toBeGreaterThan(0.97);
    });

    it("4% SWR has > 85% success", () => {
      const r4 = results.find((r) => r.swr === 0.04);
      expect(r4!.successRate).toBeGreaterThan(0.85);
    });

    it("6% SWR has < 90% success", () => {
      const r6 = results.find((r) => r.swr === 0.06);
      expect(r6!.successRate).toBeLessThan(0.9);
    });

    it("documents the full SWR sensitivity curve", () => {
      console.table(
        results.map((r) => ({
          "SWR (%)": (r.swr * 100).toFixed(1),
          "Success Rate (%)": (r.successRate * 100).toFixed(1),
        })),
      );
    });
  });

  describe("Time horizon sweep — monotonically decreasing success rates", () => {
    const horizons = [
      { label: "20yr", endAge: 85 },
      { label: "25yr", endAge: 90 },
      { label: "30yr", endAge: 95 },
      { label: "35yr", endAge: 100 },
      { label: "40yr", endAge: 105 },
    ];
    const results: { label: string; endAge: number; successRate: number }[] =
      [];

    for (const h of horizons) {
      const engine = makeTrinityInput({ projectionEndAge: h.endAge });
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });
      const result = calculateMonteCarlo(mc);
      results.push({
        label: h.label,
        endAge: h.endAge,
        successRate: result.successRate,
      });
    }

    it("success rates are monotonically non-increasing as horizon lengthens", () => {
      for (let i = 1; i < results.length; i++) {
        expect(
          results[i]!.successRate,
          `${results[i]!.label} should have ≤ success than ${results[i - 1]!.label}`,
        ).toBeLessThanOrEqual(results[i - 1]!.successRate + 0.01);
      }
    });

    it("20yr horizon has > 95% success", () => {
      expect(results[0]!.successRate).toBeGreaterThan(0.95);
    });

    it("40yr horizon has > 70% success", () => {
      const r40 = results.find((r) => r.label === "40yr");
      expect(r40!.successRate).toBeGreaterThan(0.7);
    });

    it("documents the full horizon sensitivity curve", () => {
      console.table(
        results.map((r) => ({
          Horizon: r.label,
          "Success Rate (%)": (r.successRate * 100).toFixed(1),
        })),
      );
    });
  });
});
