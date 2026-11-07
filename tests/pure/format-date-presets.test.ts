/**
 * formatDate's presets print exactly what the hand-rolled date formats they
 * replace printed: every day of a year (and a leap day), and timestamps at
 * 23:30 Chicago on each month-end, where a UTC slip would show a day late.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { formatDate } from "@/lib/utils/format";
import { parseLocalDateOnly } from "@/lib/utils/date";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Chicago";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const pad = (n: number) => String(n).padStart(2, "0");

/** Every YYYY-MM-DD of 2026, plus 2028-02-29. */
function days(): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const last = new Date(2026, m, 0).getDate();
    for (let d = 1; d <= last; d++) out.push(`2026-${pad(m)}-${pad(d)}`);
  }
  out.push("2028-02-29");
  return out;
}

/** 23:30 local (Chicago) on each month-end of 2026, and midday the 1st. */
function stamps(): Date[] {
  const out: Date[] = [];
  for (let m = 0; m < 12; m++) {
    out.push(new Date(2026, m + 1, 0, 23, 30));
    out.push(new Date(2026, m, 1, 12, 5));
  }
  return out;
}

describe("formatDate presets equal the hand formats they replace", () => {
  it("monthDay: the spreadsheet, lifetime and historical 'Jan 5' (date-only)", () => {
    for (const day of days())
      expect(formatDate(day, "monthDay")).toBe(
        parseLocalDateOnly(day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      );
  });

  it("monthDay: shortDay's UTC-noon 'Oct 30'", () => {
    for (const day of days())
      expect(formatDate(day, "monthDay")).toBe(
        new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      );
  });

  it("monthDay: data freshness's due date (a Date)", () => {
    for (const at of stamps())
      expect(formatDate(at, "monthDay")).toBe(
        at.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      );
  });

  it("short: the debts card's month label from YYYY-MM", () => {
    for (let m = 1; m <= 12; m++) {
      const ym = `2026-${pad(m)}`;
      const [y, mo] = ym.split("-").map(Number) as [number, number];
      expect(formatDate(`${ym}-01`, "short")).toBe(
        new Date(y, mo - 1, 1).toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
      );
    }
  });

  it("medium: the historical cell's date", () => {
    for (const day of days())
      expect(formatDate(day, "medium")).toBe(
        parseLocalDateOnly(day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      );
  });

  it("dayShortYear: the portfolio chart's axis label", () => {
    for (const day of days())
      expect(formatDate(day, "dayShortYear")).toBe(
        new Date(day + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "2-digit",
        }),
      );
  });

  it("dateTime: the versions list's timestamp (an ISO string made a Date)", () => {
    for (const at of stamps()) {
      const iso = at.toISOString();
      expect(formatDate(new Date(iso), "dateTime")).toBe(
        new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }
  });

  it("time: the net worth card's sync time and the snapshot draft's saved time", () => {
    for (const at of stamps()) {
      expect(formatDate(at, "time")).toBe(
        at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
      expect(formatDate(at, "time")).toBe(
        at.toLocaleTimeString(undefined, { timeStyle: "short" }),
      );
    }
  });

  it("time: the two clock formats agree in other locales too", () => {
    const at = new Date(2026, 0, 31, 23, 30);
    for (const locale of ["en-GB", "de-DE", "fr-FR", "ja-JP", "es-MX", "ko-KR"])
      expect(
        at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
      ).toBe(at.toLocaleTimeString(locale, { timeStyle: "short" }));
  });
});
