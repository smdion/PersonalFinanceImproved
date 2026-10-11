/** Per-institution balance freshness. Invented institutions only. */
import { describe, it, expect } from "vitest";
import { summarizeBalanceDates } from "@/lib/pure/balance-dates";
import { tradingDaysBetween } from "@/lib/pure/market-calendar";

// 2026-05-15 is a Friday; 2026-05-25 is Memorial Day. 22:00 UTC = after the close.
const at = (iso: string) => new Date(iso);

describe("summarizeBalanceDates", () => {
  it("is empty without accounts", () => {
    expect(summarizeBalanceDates([])).toEqual({
      institutions: [],
      oldest: null,
      newest: null,
      behind: [],
    });
  });

  it("dates each institution by its least current account, least current first", () => {
    const s = summarizeBalanceDates([
      { institution: "B Plan", reportedAt: at("2026-05-14T22:00:00Z") },
      { institution: "A Bank", reportedAt: at("2026-05-14T22:00:00Z") },
      { institution: "A Bank", reportedAt: at("2026-05-12T22:00:00Z") },
    ]);
    expect(s.institutions).toEqual([
      { institution: "A Bank", asOf: "2026-05-12", tradingDaysBehind: 2 },
      { institution: "B Plan", asOf: "2026-05-14", tradingDaysBehind: 0 },
    ]);
    expect([s.oldest, s.newest]).toEqual(["2026-05-12", "2026-05-14"]);
    expect(s.behind.map((b) => b.institution)).toEqual(["A Bank"]);
  });

  it("does not call a weekend report behind Friday's close", () => {
    const s = summarizeBalanceDates([
      { institution: "A Bank", reportedAt: at("2026-05-15T22:00:00Z") }, // Fri after close
      { institution: "B Plan", reportedAt: at("2026-05-16T12:00:00Z") }, // Sat
    ]);
    expect(s.behind).toEqual([]);
    expect(s.oldest).toBe(s.newest);
  });
});

describe("tradingDaysBetween", () => {
  it("skips weekends and holidays", () => {
    expect(tradingDaysBetween("2026-05-22", "2026-05-26")).toBe(1); // Fri → Tue over Memorial Day
    expect(tradingDaysBetween("2026-05-15", "2026-05-15")).toBe(0);
    expect(tradingDaysBetween("2026-05-18", "2026-05-15")).toBe(0);
  });
});
