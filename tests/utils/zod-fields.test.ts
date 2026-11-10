/**
 * `zCalendarDate` accepts a `YYYY-MM-DD` day that exists, in a year
 * `zYear` accepts; `zYear` is every request's year range (decision B6:
 * 1900–2100, whole years).
 */
import { describe, it, expect } from "vitest";
import { zCalendarDate, zMonthKey, zYear } from "@/lib/utils/zod-fields";

const CASES: [string, boolean][] = [
  ["2026-11-05", true],
  ["2028-02-29", true],
  ["1900-01-01", true],
  ["2100-12-31", true],
  ["2026-02-29", false],
  ["2026-02-30", false],
  ["2026-13-45", false],
  ["2026-00-10", false],
  ["2026-11-00", false],
  ["1899-12-31", false],
  ["2101-01-01", false],
  ["0002-01-09", false],
  ["9999-99-99", false],
  ["2026-1-05", false],
  ["26-11-05", false],
  ["20261-01-01", false],
  ["2026-11-05T00:00:00.000Z", false],
  [" 2026-11-05", false],
  ["2026-11-05\n", false],
  ["2026/11/05", false],
  ["", false],
];

describe("zCalendarDate", () => {
  it.each(CASES)("%j accepted: %s", (value, accepted) => {
    expect(zCalendarDate.safeParse(value).success).toBe(accepted);
  });

  it("refuses a non-string", () => {
    expect(zCalendarDate.safeParse(20261105).success).toBe(false);
    expect(zCalendarDate.safeParse(null).success).toBe(false);
  });

  it("keeps a nullable field's null", () => {
    expect(zCalendarDate.nullable().parse(null)).toBeNull();
  });
});

describe("zYear", () => {
  it.each([
    [1900, true],
    [2026, true],
    [2100, true],
    [1899, false],
    [2101, false],
    [2200, false],
    [2026.5, false],
    [Number.NaN, false],
  ])("%d accepted: %s", (year, accepted) => {
    expect(zYear.safeParse(year).success).toBe(accepted);
  });
});

describe("zMonthKey", () => {
  it.each([
    ["2026-11", true],
    ["1900-01", true],
    ["2026-13", false],
    ["2026-00", false],
    ["2101-01", false],
    ["2026-1", false],
    ["2026-11-01", false],
  ])("%j accepted: %s", (value, accepted) => {
    expect(zMonthKey.safeParse(value).success).toBe(accepted);
  });
});
