import { describe, it, expect } from "vitest";
import { findOldestDateSource } from "@/lib/pure/data-freshness";

describe("findOldestDateSource", () => {
  it("returns null when no dates are given", () => {
    expect(findOldestDateSource([])).toBeNull();
    expect(findOldestDateSource([null, undefined, ""])).toBeNull();
  });

  it("picks the chronologically oldest among mixed date-only and timestamp sources", () => {
    // Regression case: Balance/Performance (date-only) are the true
    // oldest here, but a naive string/positional pick could return YNAB.
    const result = findOldestDateSource([
      "2026-08-01", // Balance (date-only)
      "2026-08-01", // Performance (date-only)
      "2026-08-06T13:39:00.000Z", // YNAB (timestamp)
      "2026-08-05T18:30:00.000Z", // SimpleFIN (timestamp)
    ]);
    expect(result).toBe("2026-08-01");
  });

  it("returns the original raw string of the winner, not a reconstructed date", () => {
    // The caller must be able to hand this straight to formatDate() and
    // get the date-only (local midnight) interpretation, not a shifted
    // one from an ISO round-trip.
    const result = findOldestDateSource([
      "2026-08-01",
      "2026-08-06T00:00:00.000Z",
    ]);
    expect(result).toBe("2026-08-01");
    expect(result).not.toContain("T");
  });

  it("ignores invalid/unparseable entries", () => {
    const result = findOldestDateSource(["not-a-date", "2026-08-01", null]);
    expect(result).toBe("2026-08-01");
  });

  it("compares a date-only source against a same-day timestamp correctly", () => {
    // A date-only string is local midnight; a timestamp later that same
    // day is still chronologically after it.
    const result = findOldestDateSource([
      "2026-08-01",
      "2026-08-01T09:00:00.000Z",
    ]);
    expect(result).toBe("2026-08-01");
  });
});
