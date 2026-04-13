import { describe, it, expect } from "vitest";
import {
  projectFIYear,
  formatFIProjection,
  type FIProjectionResult,
} from "@/lib/calculators/fi-projection";

/**
 * Financial Independence projection — pure linear-extrapolation helper
 * used by the Net Worth page and Financial Independence card. 58-line
 * module with three status branches; tests pin every branch so the
 * formula can't silently drift.
 */

describe("projectFIYear", () => {
  it("returns 'achieved' when currentFIProgress >= 1.0", () => {
    expect(projectFIYear(1.0, 0.95, 2026, 2025)).toEqual({
      status: "achieved",
    });
    expect(projectFIYear(1.25, 0.9, 2026, 2025)).toEqual({
      status: "achieved",
    });
  });

  it("returns 'stalled' when yearsApart is 0 or negative", () => {
    expect(projectFIYear(0.5, 0.4, 2025, 2025)).toEqual({ status: "stalled" });
    expect(projectFIYear(0.5, 0.4, 2024, 2025)).toEqual({ status: "stalled" });
  });

  it("returns 'stalled' when progress did not improve year over year", () => {
    // flat progress
    expect(projectFIYear(0.5, 0.5, 2026, 2025)).toEqual({ status: "stalled" });
    // negative progress (went backward)
    expect(projectFIYear(0.4, 0.5, 2026, 2025)).toEqual({ status: "stalled" });
  });

  it("projects the FI year via linear extrapolation", () => {
    // From 30% → 33% in one year → 3pp/yr. 67pp to go = ~22.3 years.
    // 2026 + 22 = 2048.
    const result = projectFIYear(0.33, 0.3, 2026, 2025);
    expect(result.status).toBe("projected");
    if (result.status === "projected") {
      expect(result.year).toBe(2048);
      expect(result.yearsRemaining).toBeCloseTo(22.3, 1);
    }
  });

  it("averages progress across multi-year gaps (yearsApart > 1)", () => {
    // From 20% → 40% over 5 years → 4pp/yr. 60pp to go = 15 years.
    const result = projectFIYear(0.4, 0.2, 2026, 2021);
    expect(result.status).toBe("projected");
    if (result.status === "projected") {
      expect(result.year).toBe(2041);
      expect(result.yearsRemaining).toBeCloseTo(15.0, 1);
    }
  });
});

describe("formatFIProjection", () => {
  it("renders the 'achieved' status as a celebratory string", () => {
    expect(formatFIProjection({ status: "achieved" })).toBe("FI Achieved!");
  });

  it("renders the 'stalled' status as a warning string", () => {
    expect(formatFIProjection({ status: "stalled" })).toBe("Progress Stalled");
  });

  it("renders the 'projected' status as 'YYYY (N.N years)'", () => {
    const result: FIProjectionResult = {
      status: "projected",
      year: 2048,
      yearsRemaining: 22.3,
    };
    expect(formatFIProjection(result)).toBe("2048 (22.3 years)");
  });

  it("pads yearsRemaining to 1 decimal place even when whole", () => {
    const result: FIProjectionResult = {
      status: "projected",
      year: 2040,
      yearsRemaining: 14,
    };
    expect(formatFIProjection(result)).toBe("2040 (14.0 years)");
  });
});
