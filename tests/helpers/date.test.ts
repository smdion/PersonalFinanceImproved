import { describe, it, expect } from "vitest";
import {
  isPriorYearContribWindow,
  ageInYear,
  localDateStr,
  parseLocalDateOnly,
  localMidnight,
} from "@/lib/utils/date";
import { PENALTY_FREE_AGE } from "@/lib/constants";

describe("ageInYear", () => {
  it("computes integer age as year - birthYear", () => {
    expect(ageInYear(1990, 2026)).toBe(36);
  });

  it("the PENALTY_FREE_AGE (59.5) convention rounds eligibility up to 60, not down to 59", () => {
    // Born 1966: turns 59 in 2025, 60 in 2026. Year-granularity modeling has
    // no mid-year resolution, so a person born in 1966 is only considered
    // >= 59.5 starting the year they turn 60 (2026), not the year they turn
    // 59 (2025) even though they turn 59.5 partway through 2025.
    expect(ageInYear(1966, 2025) >= PENALTY_FREE_AGE).toBe(false);
    expect(ageInYear(1966, 2026) >= PENALTY_FREE_AGE).toBe(true);
  });
});

describe("isPriorYearContribWindow", () => {
  it("returns true for January 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 0, 1))).toBe(true);
  });

  it("returns true for February 15", () => {
    expect(isPriorYearContribWindow(new Date(2026, 1, 15))).toBe(true);
  });

  it("returns true for March 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 2, 31))).toBe(true);
  });

  it("returns true for April 15 (deadline day)", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 15))).toBe(true);
  });

  it("returns false for April 16", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 16))).toBe(false);
  });

  it("returns false for May 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 4, 1))).toBe(false);
  });

  it("returns false for December 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 11, 31))).toBe(false);
  });
});

/**
 * `localDateStr`/`parseLocalDateOnly`/`localMidnight` (2026-09-01, TODO.md
 * date-parsing audit) — the shared fix for `new Date().toISOString().slice(0,10)`
 * ("today", UTC) and unguarded `new Date("YYYY-MM-DD")` (parses as UTC
 * midnight), both of which silently shift by a calendar day outside UTC.
 */
describe("localDateStr", () => {
  it("formats using LOCAL getters, not UTC — no timezone shift", () => {
    // A local date deliberately chosen with single-digit month/day to also
    // pin the zero-padding.
    const d = new Date(2026, 0, 5, 23, 30); // Jan 5, 2026, 11:30pm local
    expect(localDateStr(d)).toBe("2026-01-05");
  });

  it("defaults to the current local date when called with no argument", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localDateStr()).toBe(expected);
  });
});

describe("parseLocalDateOnly", () => {
  it("parses a bare date-only string as LOCAL midnight, not UTC midnight", () => {
    const d = parseLocalDateOnly("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March, 0-indexed
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it("passes a full ISO timestamp through unchanged (doesn't double-append a time)", () => {
    const iso = "2026-03-15T18:30:00.000Z";
    expect(parseLocalDateOnly(iso).getTime()).toBe(new Date(iso).getTime());
  });

  it("passes an already-constructed Date through unchanged", () => {
    const d = new Date(2026, 5, 1);
    expect(parseLocalDateOnly(d)).toBe(d);
  });

  it("round-trips through localDateStr for a same-day identity check", () => {
    // The bug this whole module exists to prevent: parsing a date-only
    // string must reproduce the SAME calendar date localDateStr would
    // format it back to, regardless of the host's timezone offset from UTC.
    expect(localDateStr(parseLocalDateOnly("2026-12-31"))).toBe("2026-12-31");
    expect(localDateStr(parseLocalDateOnly("2026-01-01"))).toBe("2026-01-01");
  });
});

describe("localMidnight", () => {
  it("zeroes out the time component of a local date", () => {
    const d = new Date(2026, 5, 15, 14, 22, 9);
    const mid = localMidnight(d);
    expect(mid.getFullYear()).toBe(2026);
    expect(mid.getMonth()).toBe(5);
    expect(mid.getDate()).toBe(15);
    expect(mid.getHours()).toBe(0);
    expect(mid.getMinutes()).toBe(0);
    expect(mid.getSeconds()).toBe(0);
  });

  it("used together with parseLocalDateOnly gives a stable whole-day difference", () => {
    // This is exactly server/helpers/snapshot.ts's snapshotAgeDays fix: a
    // snapshot dated "yesterday" should read as exactly 1 day old regardless
    // of what time of day "now" is.
    const snapshotDate = "2026-06-01";
    const now = new Date(2026, 5, 2, 23, 45); // June 2, 11:45pm local
    const ageDays = Math.round(
      (localMidnight(now).getTime() -
        parseLocalDateOnly(snapshotDate).getTime()) /
        86_400_000,
    );
    expect(ageDays).toBe(1);
  });
});
