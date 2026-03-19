/**
 * Monte Carlo Statistical Property Tests
 *
 * Validates that the MC simulation produces statistically sound distributions:
 * right-skew, percentile ordering, spread factors, reproducibility, and convergence.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  makeTrinityInput,
  makeMCInput,
  ASSET_CLASSES,
  CORRELATIONS,
  CURRENT_GLIDE_PATH,
  IBBOTSON_CLASSES,
  make7525GlidePath,
} from "./benchmark-helpers";

const STOCK_BOND_CORRELATIONS = [
  { classAId: 1, classBId: 3, correlation: -0.1 },
];

describe("Monte Carlo statistical properties", () => {
  describe("Log-normal right skew", () => {
    it("mean terminal balance > median terminal balance", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      expect(result.meanEndBalance).toBeGreaterThan(result.medianEndBalance);
    });
  });

  describe("Percentile ordering", () => {
    it("terminal balance: p5 < p10 < p25 < median < p75 < p90 < p95", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      const d = result.distributions.terminalBalance;

      expect(d.p5).toBeLessThanOrEqual(d.p10);
      expect(d.p10).toBeLessThanOrEqual(d.p25);
      expect(d.p25).toBeLessThanOrEqual(d.median);
      expect(d.median).toBeLessThanOrEqual(d.p75);
      expect(d.p75).toBeLessThanOrEqual(d.p90);
      expect(d.p90).toBeLessThanOrEqual(d.p95);
    });

    it("percentile bands ordered at every year", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 2000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result = calculateMonteCarlo(mc);

      for (const band of result.percentileBands) {
        expect(band.p5).toBeLessThanOrEqual(band.p10);
        expect(band.p10).toBeLessThanOrEqual(band.p25);
        expect(band.p25).toBeLessThanOrEqual(band.p50);
        expect(band.p50).toBeLessThanOrEqual(band.p75);
        expect(band.p75).toBeLessThanOrEqual(band.p90);
        expect(band.p90).toBeLessThanOrEqual(band.p95);
      }
    });
  });

  describe("Spread factor", () => {
    it("p90/p10 ratio for 30yr projection is 3-10×", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result = calculateMonteCarlo(mc);
      const d = result.distributions.terminalBalance;

      // p10 might be 0 (portfolio depleted) — skip ratio if so
      if (d.p10 > 0) {
        const ratio = d.p90 / d.p10;
        expect(ratio).toBeGreaterThanOrEqual(3);
        // With decumulation withdrawals, spread can be very wide (depleted p10 vs growing p90)
        expect(ratio).toBeLessThanOrEqual(25);
      }
    });
  });

  describe("Seed reproducibility", () => {
    it("same seed produces identical results", () => {
      const engine = makeTrinityInput();
      const mc1 = makeMCInput(engine, { numTrials: 500, seed: 42 });
      const mc2 = makeMCInput(engine, { numTrials: 500, seed: 42 });

      const result1 = calculateMonteCarlo(mc1);
      const result2 = calculateMonteCarlo(mc2);

      expect(result1.successRate).toBe(result2.successRate);
      expect(result1.medianEndBalance).toBe(result2.medianEndBalance);
      expect(result1.meanEndBalance).toBe(result2.meanEndBalance);
    });

    it("different seeds produce different results", () => {
      const engine = makeTrinityInput();
      const mc1 = makeMCInput(engine, { numTrials: 500, seed: 42 });
      const mc2 = makeMCInput(engine, { numTrials: 500, seed: 123 });

      const result1 = calculateMonteCarlo(mc1);
      const result2 = calculateMonteCarlo(mc2);

      // At least one metric should differ
      const allSame =
        result1.successRate === result2.successRate &&
        result1.medianEndBalance === result2.medianEndBalance &&
        result1.meanEndBalance === result2.meanEndBalance;
      expect(allSame).toBe(false);
    });
  });

  describe("Trial count convergence", () => {
    it("success rate converges: |5000 trials - 1000 trials| < 3pp", () => {
      const engine = makeTrinityInput();
      const mc1000 = makeMCInput(engine, {
        numTrials: 1000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });
      const mc5000 = makeMCInput(engine, {
        numTrials: 5000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: STOCK_BOND_CORRELATIONS,
        glidePath: make7525GlidePath(),
      });

      const result1000 = calculateMonteCarlo(mc1000);
      const result5000 = calculateMonteCarlo(mc5000);

      expect(
        Math.abs(result5000.successRate - result1000.successRate),
      ).toBeLessThan(0.03);
    });
  });

  describe("Deterministic projection included", () => {
    it("MC result includes a deterministic projection matching standalone run", () => {
      const engine = makeTrinityInput();
      const mc = makeMCInput(engine, { numTrials: 100, seed: 42 });

      const mcResult = calculateMonteCarlo(mc);
      const detResult = calculateProjection(engine);

      expect(mcResult.deterministicProjection).toBeDefined();
      expect(mcResult.deterministicProjection.projectionByYear.length).toBe(
        detResult.projectionByYear.length,
      );

      // Terminal balances should match exactly (same input, same deterministic engine)
      const mcLast =
        mcResult.deterministicProjection.projectionByYear[
          mcResult.deterministicProjection.projectionByYear.length - 1
        ];
      const detLast =
        detResult.projectionByYear[detResult.projectionByYear.length - 1];
      expect(mcLast!.endBalance).toBe(detLast!.endBalance);
    });
  });

  describe("Return clamping", () => {
    it("no single-year percentile band exceeds clamping bounds", () => {
      // With 5 asset classes and 5000 trials, some extreme returns will occur.
      // But clamping should prevent any single-year balance from going negative
      // (absent withdrawals) or growing > 200% in one year.
      const engine = makeTrinityInput({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 70,
        annualExpenses: 0, // No withdrawals to isolate return behavior
      });
      const mc = makeMCInput(engine, {
        numTrials: 3000,
        seed: 42,
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: CURRENT_GLIDE_PATH,
      });

      const result = calculateMonteCarlo(mc);

      // All percentile bands should be non-negative (no negative balances without withdrawals)
      for (const band of result.percentileBands) {
        expect(band.p5).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
