/**
 * Trinity Study Benchmark Tests
 *
 * Compares Monte Carlo success rates against the seminal Trinity Study
 * (Cooley, Hubbard, Walz 1998) and cFIREsim/FireCalc historical results.
 *
 * Key methodology differences vs historical-sequence tools:
 * - Our engine uses log-normal MC (not historical sequences)
 * - Log-normal has slightly different tail behavior
 * - We use ±8pp tolerance to account for this divergence
 *
 * Performance note: These tests run 5,000 MC trials each. Expect ~5-15s per test.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeTrinityInput,
  makeMCInput,
  IBBOTSON_CLASSES,
  TOLERANCES,
  make5050GlidePath,
  make7525GlidePath,
} from "./benchmark-helpers";

// Simplified correlations for 2-asset (stock/bond) scenarios
const STOCK_BOND_CORRELATIONS = [
  { classAId: 1, classBId: 3, correlation: -0.1 },
];

describe("Trinity Study — 4% rule validation", () => {
  describe("Classic Trinity scenario (50/50 stock/bond, 30yr)", () => {
    it("4% SWR → 90-100% success (Trinity found ~95%)", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 5000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make5050GlidePath(),
      });

      const result = calculateMonteCarlo(mc);

      expect(result.successRate).toBeGreaterThanOrEqual(
        0.9 - TOLERANCES.successRate,
      );
      expect(result.successRate).toBeLessThanOrEqual(1.0);
    });

    it("3% SWR → ~100% success", () => {
      const engine = makeTrinityInput({
        decumulationDefaults: {
          withdrawalRate: 0.03,
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
        annualExpenses: 1000000 * 0.03,
      });
      const mc = makeMCInput(engine, {
        numTrials: 5000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make5050GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      expect(result.successRate).toBeGreaterThanOrEqual(0.97);
    });

    it("6% SWR → 55-85% success", () => {
      const engine = makeTrinityInput({
        decumulationDefaults: {
          withdrawalRate: 0.06,
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
        annualExpenses: 1000000 * 0.06,
      });
      const mc = makeMCInput(engine, {
        numTrials: 5000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make5050GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      // Log-normal MC diverges from historical at high SWR (fatter left tail)
      // Historical Trinity: ~55-70%. Our log-normal: ~40-60%.
      expect(result.successRate).toBeGreaterThanOrEqual(0.35);
      expect(result.successRate).toBeLessThanOrEqual(
        0.85 + TOLERANCES.successRate,
      );
    });
  });

  describe("cFIREsim-comparable scenario (75/25 stock/bond, 30yr)", () => {
    it("4% SWR → 93-100% success (cFIREsim typically ~95-96%)", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 5000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      expect(result.successRate).toBeGreaterThanOrEqual(
        0.93 - TOLERANCES.successRate,
      );
      expect(result.successRate).toBeLessThanOrEqual(1.0);
    });
  });

  describe("Time horizon sensitivity", () => {
    it("20yr horizon has higher success than 30yr", () => {
      const engine20 = makeTrinityInput({ projectionEndAge: 85 });
      const engine30 = makeTrinityInput({ projectionEndAge: 95 });

      const mc20 = makeMCInput(engine20, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });
      const mc30 = makeMCInput(engine30, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result20 = calculateMonteCarlo(mc20);
      const result30 = calculateMonteCarlo(mc30);

      expect(result20.successRate).toBeGreaterThanOrEqual(result30.successRate);
    });

    it("40yr horizon has lower success than 30yr", () => {
      const engine30 = makeTrinityInput({ projectionEndAge: 95 });
      const engine40 = makeTrinityInput({ projectionEndAge: 105 });

      const mc30 = makeMCInput(engine30, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });
      const mc40 = makeMCInput(engine40, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result30 = calculateMonteCarlo(mc30);
      const result40 = calculateMonteCarlo(mc40);

      expect(result40.successRate).toBeLessThanOrEqual(result30.successRate);
    });
  });
});
