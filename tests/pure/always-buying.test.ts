import { describe, it, expect } from "vitest";
import {
  buyingMonths,
  downYears,
  recentCoveredMonths,
} from "@/lib/pure/always-buying";

describe("buyingMonths", () => {
  it("whole months after the first transaction, through the last completed one", () => {
    const months = buyingMonths({
      firstTransactionDay: "2026-07-14",
      contributionDays: ["2026-07-15", "2026-08-01", "2026-10-03"],
      // Reported through October, but no feed reported anything in September.
      reportDays: ["2026-07-20", "2026-08-31", "2026-10-31", "2026-11-02"],
      today: "2026-11-05",
    });
    expect(months).toEqual([
      { month: "2026-08", state: "invested" },
      { month: "2026-09", state: "unknown" },
      { month: "2026-10", state: "invested" },
    ]);
  });

  it("a covered month without a deposit breaks; one after the last report is unknown", () => {
    expect(
      buyingMonths({
        firstTransactionDay: "2026-06-30",
        contributionDays: ["2026-07-02"],
        reportDays: ["2026-07-10", "2026-08-15", "2026-09-01"],
        today: "2026-10-20",
      }),
    ).toEqual([
      { month: "2026-07", state: "invested" },
      { month: "2026-08", state: "notInvested" },
      // No report after September ended.
      { month: "2026-09", state: "unknown" },
    ]);
  });

  it("nothing without a transaction; months run across the year end", () => {
    expect(
      buyingMonths({
        firstTransactionDay: null,
        contributionDays: [],
        reportDays: [],
        today: "2026-10-20",
      }),
    ).toEqual([]);
    expect(
      buyingMonths({
        firstTransactionDay: "2026-11-10",
        contributionDays: ["2026-12-05", "2027-01-05"],
        reportDays: ["2026-12-20", "2027-01-20", "2027-02-01"],
        today: "2027-02-10",
      }).map((m) => m.month),
    ).toEqual(["2026-12", "2027-01"]);
  });
});

describe("recentCoveredMonths", () => {
  it("drops unknown months and keeps the latest 12", () => {
    const months = Array.from({ length: 15 }, (_, i) => ({
      month: `m${i}`,
      state: i === 14 ? ("unknown" as const) : ("invested" as const),
    }));
    const recent = recentCoveredMonths(months);
    expect(recent).toHaveLength(12);
    expect(recent[11]!.month).toBe("m13");
  });
});

describe("downYears", () => {
  it("each losing year against the year before, held up at 90%", () => {
    const years = new Map([
      [2021, { employee: 20_000, gain: 15_000 }],
      [2022, { employee: 18_000, gain: -30_000 }],
      [2023, { employee: 25_000, gain: 40_000 }],
      [2024, { employee: 20_000, gain: -1_000 }],
    ]);
    expect(downYears(years)).toEqual([
      {
        year: 2022,
        gain: -30_000,
        contributed: 18_000,
        prior: 20_000,
        heldUp: true,
      },
      {
        year: 2024,
        gain: -1_000,
        contributed: 20_000,
        prior: 25_000,
        heldUp: false,
      },
    ]);
  });

  it("a losing first year has nothing to compare with", () => {
    expect(downYears(new Map([[2022, { employee: 1, gain: -5 }]]))).toEqual([]);
  });
});
