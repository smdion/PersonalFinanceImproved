/**
 * Glide Path Tests
 *
 * Validates our FIRE-adjusted glide path structural properties and documents
 * deviations from traditional Vanguard/Fidelity TDFs.
 *
 * Our Default preset intentionally holds MORE equity than traditional TDFs
 * post-retirement because early retirees (age 55, 40-year horizon, no SS)
 * need more growth runway than age-65 retirees with Social Security.
 *
 * Sources: Big ERN SWR series, Kitces rising equity research, Early Retirement Now.
 * Accumulation (25-45) matches Vanguard TDFs; retirement (55+) floors at ~50% equity.
 */
import { describe, it, expect } from "vitest";
import { interpolateAllocations } from "@/lib/calculators/random";
import { CURRENT_GLIDE_PATH, TOLERANCES } from "./benchmark-helpers";

// FIRE-adjusted equity targets for our Default preset.
// Accumulation phase (25-45) tracks Vanguard TDFs.
// Retirement phase (55+) holds more equity than traditional TDFs — intentional.
const FIRE_EQUITY_BY_AGE: Record<number, { min: number; max: number }> = {
  25: { min: 0.88, max: 0.92 }, // Same as Vanguard
  35: { min: 0.85, max: 0.92 }, // Same as Vanguard
  45: { min: 0.73, max: 0.82 }, // Same as Vanguard
  55: { min: 0.58, max: 0.68 }, // Same as Vanguard (de-risk to protect nest egg)
  65: { min: 0.55, max: 0.65 }, // FIRE: rising equity (Kitces), ~12pp above Vanguard TDF
  75: { min: 0.5, max: 0.6 }, // FIRE: ~25pp above Vanguard TDF
  85: { min: 0.45, max: 0.55 }, // FIRE: floors at ~50% (vs Vanguard 25%)
};

function getTotalEquity(allocations: Record<number, number>): number {
  return (allocations[1] ?? 0) + (allocations[2] ?? 0);
}

function getTotalBonds(allocations: Record<number, number>): number {
  return (allocations[3] ?? 0) + (allocations[4] ?? 0);
}

describe("Glide path — FIRE-adjusted equity targets", () => {
  describe("Equity allocation at key ages", () => {
    for (const [ageStr, range] of Object.entries(FIRE_EQUITY_BY_AGE)) {
      const age = Number(ageStr);
      it(`age ${age}: equity within FIRE target [${(range.min * 100).toFixed(0)}%, ${(range.max * 100).toFixed(0)}%] (±${TOLERANCES.allocationPct * 100}pp tolerance)`, () => {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        const equity = getTotalEquity(alloc);

        // Allow our tolerance on top of the range
        expect(equity).toBeGreaterThanOrEqual(
          range.min - TOLERANCES.allocationPct,
        );
        expect(equity).toBeLessThanOrEqual(
          range.max + TOLERANCES.allocationPct,
        );
      });
    }
  });

  describe("Current glide path vs FIRE targets (documenting)", () => {
    it("documents current equity allocations at each age", () => {
      const deviations: {
        age: number;
        ourEquity: number;
        targetMid: number;
        delta: number;
      }[] = [];

      for (const [ageStr, range] of Object.entries(FIRE_EQUITY_BY_AGE)) {
        const age = Number(ageStr);
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        const equity = getTotalEquity(alloc);
        const targetMid = (range.min + range.max) / 2;
        deviations.push({
          age,
          ourEquity: Math.round(equity * 100),
          targetMid: Math.round(targetMid * 100),
          delta: Math.round((equity - targetMid) * 100),
        });
      }

      // Log for visibility in test output
      console.table(deviations);

      // The glide path fix should bring these within ±5pp
      // After fix, all deltas should be within [-5, +5]
    });
  });

  describe("Structural properties", () => {
    it("allocations sum to ~100% at every age from 25 to 85", () => {
      for (let age = 25; age <= 85; age++) {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        const sum = Object.values(alloc).reduce((s, v) => s + v, 0);
        expect(sum).toBeGreaterThan(0.99);
        expect(sum).toBeLessThan(1.01);
      }
    });

    it("total equity monotonically decreases from age 25 to 85", () => {
      let prevEquity = 1.0;
      for (let age = 25; age <= 85; age++) {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        const equity = getTotalEquity(alloc);
        expect(equity).toBeLessThanOrEqual(prevEquity + 0.001); // allow tiny float noise
        prevEquity = equity;
      }
    });

    it("total bonds+TIPS monotonically increases from age 25 to 85", () => {
      let prevBonds = 0;
      for (let age = 25; age <= 85; age++) {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        const bonds = getTotalBonds(alloc);
        expect(bonds).toBeGreaterThanOrEqual(prevBonds - 0.001); // allow tiny float noise
        prevBonds = bonds;
      }
    });

    it("no negative allocations at any age", () => {
      for (let age = 25; age <= 85; age++) {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        for (const [name, val] of Object.entries(alloc)) {
          expect(val, `${name} at age ${age}`).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("interpolation produces smooth transitions (no jumps > 5pp between adjacent ages)", () => {
      let prevAlloc = interpolateAllocations(CURRENT_GLIDE_PATH, 25);
      for (let age = 26; age <= 85; age++) {
        const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, age);
        for (const key of Object.keys(alloc)) {
          const id = Number(key);
          const diff = Math.abs((alloc[id] ?? 0) - (prevAlloc[id] ?? 0));
          expect(diff, `class ${id} jump at age ${age}`).toBeLessThanOrEqual(
            0.05,
          );
        }
        prevAlloc = alloc;
      }
    });
  });

  describe("Edge cases", () => {
    it("age below minimum (20) returns first entry allocations", () => {
      const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, 20);
      const first = CURRENT_GLIDE_PATH[0]!.allocations;
      expect(getTotalEquity(alloc)).toBeCloseTo(getTotalEquity(first), 4);
    });

    it("age above maximum (100) returns last entry allocations", () => {
      const alloc = interpolateAllocations(CURRENT_GLIDE_PATH, 100);
      const last =
        CURRENT_GLIDE_PATH[CURRENT_GLIDE_PATH.length - 1]!.allocations;
      expect(getTotalEquity(alloc)).toBeCloseTo(getTotalEquity(last), 4);
    });
  });
});
