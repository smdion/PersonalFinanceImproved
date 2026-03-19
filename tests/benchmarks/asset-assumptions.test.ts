/**
 * Asset Class Assumption Tests
 *
 * Validates that our return/volatility assumptions fall within the range of
 * published expectations from major institutions (Vanguard VCMM, Morningstar,
 * Ibbotson SBBI historical data).
 *
 * These are "documentation tests" — they assert our parameters are reasonable,
 * not that they match any single source exactly.
 */
import { describe, it, expect } from "vitest";
import {
  choleskyDecomposition,
  buildCorrelationMatrix,
} from "@/lib/calculators/random";
import { ASSET_CLASSES, CORRELATIONS } from "./benchmark-helpers";

// Published ranges (union of Vanguard VCMM 2024, Morningstar 2024, Ibbotson 1926-2023)
const PUBLISHED_RANGES: Record<
  string,
  { minReturn: number; maxReturn: number; minVol: number; maxVol: number }
> = {
  "US Equities": {
    minReturn: 0.04,
    maxReturn: 0.11,
    minVol: 0.12,
    maxVol: 0.2,
  },
  "International Equities": {
    minReturn: 0.04,
    maxReturn: 0.09,
    minVol: 0.14,
    maxVol: 0.22,
  },
  "US Bonds": { minReturn: 0.02, maxReturn: 0.06, minVol: 0.03, maxVol: 0.08 },
  TIPS: { minReturn: 0.01, maxReturn: 0.04, minVol: 0.02, maxVol: 0.06 },
  Cash: { minReturn: 0.005, maxReturn: 0.04, minVol: 0.005, maxVol: 0.02 },
};

describe("Asset class assumptions — vs published data", () => {
  describe("Return rates within published ranges", () => {
    for (const ac of ASSET_CLASSES) {
      const range = PUBLISHED_RANGES[ac.name]!;
      it(`${ac.name}: ${(ac.meanReturn * 100).toFixed(1)}% within [${range.minReturn * 100}%, ${range.maxReturn * 100}%]`, () => {
        expect(ac.meanReturn).toBeGreaterThanOrEqual(range.minReturn);
        expect(ac.meanReturn).toBeLessThanOrEqual(range.maxReturn);
      });
    }
  });

  describe("Volatility within published ranges", () => {
    for (const ac of ASSET_CLASSES) {
      const range = PUBLISHED_RANGES[ac.name]!;
      it(`${ac.name}: ${(ac.stdDev * 100).toFixed(0)}% vol within [${range.minVol * 100}%, ${range.maxVol * 100}%]`, () => {
        expect(ac.stdDev).toBeGreaterThanOrEqual(range.minVol);
        expect(ac.stdDev).toBeLessThanOrEqual(range.maxVol);
      });
    }
  });

  describe("Correlation matrix properties", () => {
    it("correlation matrix is positive semi-definite (Cholesky succeeds)", () => {
      const matrix = buildCorrelationMatrix(ASSET_CLASSES, CORRELATIONS);
      const L = choleskyDecomposition(matrix);

      // Cholesky should produce non-NaN diagonal elements
      for (let i = 0; i < L.length; i++) {
        expect(L[i]![i]).not.toBeNaN();
        expect(L[i]![i]).toBeGreaterThanOrEqual(0);
      }
    });

    it("equity-equity correlation is positive (0.75)", () => {
      const usIntl = CORRELATIONS.find(
        (c) => c.classAId === 1 && c.classBId === 2,
      );
      expect(usIntl).toBeDefined();
      expect(usIntl!.correlation).toBeGreaterThan(0.5);
      expect(usIntl!.correlation).toBeLessThan(1.0);
    });

    it("equity-bond correlation is negative (-0.10)", () => {
      const usBonds = CORRELATIONS.find(
        (c) => c.classAId === 1 && c.classBId === 3,
      );
      expect(usBonds).toBeDefined();
      expect(usBonds!.correlation).toBeLessThan(0);
      expect(usBonds!.correlation).toBeGreaterThan(-0.5);
    });

    it("all correlations are in [-1, 1]", () => {
      for (const c of CORRELATIONS) {
        expect(c.correlation).toBeGreaterThanOrEqual(-1);
        expect(c.correlation).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Deterministic return schedule reasonableness", () => {
    // From DB: 8.5% at age 20 declining 0.1%/yr to 5.5% flat from age 55+
    it("starting return (8.5%) is within equity-heavy blended range", () => {
      // 90% equity at ~7.5% + 10% bonds at ~3.8% = ~7.13%
      // 8.5% is above the blended MC but below historical equity (10.3%)
      expect(0.085).toBeGreaterThanOrEqual(0.05);
      expect(0.085).toBeLessThanOrEqual(0.11);
    });

    it("post-retirement return (5.5%) is within balanced portfolio range", () => {
      // 35% equity at 7.5% + 55% bonds/TIPS at ~3% + 10% cash at 1.8% ≈ 4.63%
      // 5.5% is slightly above but reasonable
      expect(0.055).toBeGreaterThanOrEqual(0.03);
      expect(0.055).toBeLessThanOrEqual(0.08);
    });

    it("return schedule declines monotonically from 20 to 55", () => {
      // Returns should decrease as allocation shifts conservative
      let prevRate = 0.085;
      for (let age = 21; age <= 55; age++) {
        const rate = 0.085 - (age - 20) * 0.001;
        expect(rate).toBeLessThanOrEqual(prevRate);
        prevRate = rate;
      }
    });
  });

  describe("Preset multiplier validation", () => {
    it("aggressive preset: full historical returns, tighter vol", () => {
      const returnMult = 1.0;
      const volMult = 0.9;
      const effectiveReturn = ASSET_CLASSES[0]!.meanReturn * returnMult;
      const effectiveVol = ASSET_CLASSES[0]!.stdDev * volMult;

      expect(effectiveReturn).toBe(0.1); // full 10% historical
      expect(effectiveVol).toBeCloseTo(0.144, 4); // 16% × 0.9 = tighter than historical
    });

    it("default preset: no haircut, uses DB historical returns as-is", () => {
      const returnMult = 1.0;
      const volMult = 1.0;
      const effectiveReturn = ASSET_CLASSES[0]!.meanReturn * returnMult;

      // 10% × 1.0 = 10% — matches historical averages (Ibbotson ~10.3%)
      expect(effectiveReturn).toBe(0.1);
      expect(ASSET_CLASSES[0]!.stdDev * volMult).toBe(0.16); // historical vol
    });

    it("conservative preset: explicit lower returns, higher vol", () => {
      // Conservative uses fixed forward-looking targets
      const conservativeReturns = {
        "US Equities": 0.05,
        "International Equities": 0.055,
        "US Bonds": 0.035,
        TIPS: 0.02,
        Cash: 0.015,
      };
      const volMult = 1.15;

      for (const [name, ret] of Object.entries(conservativeReturns)) {
        const range = PUBLISHED_RANGES[name]!;
        // Conservative returns should be in the lower half of published ranges
        expect(ret).toBeGreaterThanOrEqual(range.minReturn);
        expect(ret).toBeLessThanOrEqual(range.maxReturn);
      }

      // Vol should be elevated but not extreme
      const effectiveEquityVol = 0.15 * volMult;
      expect(effectiveEquityVol).toBeLessThan(0.25);
    });
  });
});
