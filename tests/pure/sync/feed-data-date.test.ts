import { describe, it, expect } from "vitest";
import {
  feedDataDay,
  learnReportLag,
  provenDataDay,
  laggedSession,
} from "@/lib/pure/sync/feed-data-date";

/** Reports at an Eastern hour, with a balance that steps at given days. */
const et = (day: string, hour: number) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:00:00-04:00`);

// Three weeks of October 2026: 10-10 is a Saturday.
const days = Array.from({ length: 20 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 10 + i));
  return d.toISOString().slice(0, 10);
});
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function feed(hour: number, changesOn: (d: number) => boolean) {
  let balance = 100_000;
  return days.map((day) => {
    if (changesOn(dow(day))) balance += 500;
    return { reportedAt: et(day, hour), balance };
  });
}

describe("learnReportLag", () => {
  it("evening reports that never change on Monday but always on Saturday run a session behind", () => {
    // Fidelity's pattern: Mon 0, Tue–Sat change, Sun 0.
    const r = learnReportLag([feed(22, (d) => d >= 2 && d <= 6)]);
    expect(r).toEqual({ lag: 1, confident: true });
  });

  it("evening reports that change Mon–Fri are the same day's close", () => {
    const r = learnReportLag([feed(22, (d) => d >= 1 && d <= 5)]);
    expect(r?.lag).toBe(0);
  });

  it("overnight reports changing Tue–Sat are the prior close, no lag", () => {
    // Vanguard's pattern at 3am.
    const r = learnReportLag([feed(3, (d) => d >= 2 && d <= 6)]);
    expect(r?.lag).toBe(0);
  });

  it("a flat balance tells nothing; too little history isn't confident", () => {
    expect(learnReportLag([feed(22, () => false)])).toBeNull();
    const short = feed(22, (d) => d >= 2 && d <= 6).slice(0, 5);
    expect(learnReportLag([short])?.confident).toBe(false);
  });
});

describe("provenDataDay", () => {
  const series = (vals: Record<string, number>) =>
    new Map(Object.entries(vals).map(([d, close]) => [d, { close }]));
  const closes = new Map([
    [
      "VTI",
      series({ "2026-10-27": 300, "2026-10-28": 303, "2026-10-29": 306 }),
    ],
    ["BND", series({ "2026-10-27": 72, "2026-10-28": 72.5, "2026-10-29": 73 })],
  ]);

  it("the day whose closes match the institution's own prices", () => {
    expect(
      provenDataDay(
        [
          { ticker: "VTI", shares: 10, reportedMarketValue: 3030 },
          { ticker: "BND", shares: 100, reportedMarketValue: 7250 },
        ],
        closes,
        "2026-10-29",
      ),
    ).toBe("2026-10-28");
  });

  it("no match, an unpriced fund alone, or two fitting days prove nothing", () => {
    expect(
      provenDataDay(
        [{ ticker: "VTI", shares: 10, reportedMarketValue: 9999 }],
        closes,
        "2026-10-29",
      ),
    ).toBeNull();
    expect(
      provenDataDay(
        [{ ticker: null, shares: 10, reportedMarketValue: 3030 }],
        closes,
        "2026-10-29",
      ),
    ).toBeNull();
    const flat = new Map([
      ["CASH", series({ "2026-10-28": 1, "2026-10-29": 1 })],
    ]);
    expect(
      provenDataDay(
        [{ ticker: "CASH", shares: 10, reportedMarketValue: 10 }],
        flat,
        "2026-10-29",
      ),
    ).toBeNull();
  });
});

describe("provenDataDay: what it won't claim", () => {
  const series = (vals: Record<string, number>) =>
    new Map(Object.entries(vals).map(([d, close]) => [d, { close }]));

  it("without the latest possible day's close, nothing is proven", () => {
    const closes = new Map([
      ["VTI", series({ "2026-10-27": 300, "2026-10-28": 303 })],
    ]);
    expect(
      provenDataDay(
        [{ ticker: "VTI", shares: 10, reportedMarketValue: 3000 }],
        closes,
        "2026-10-29",
      ),
    ).toBeNull();
  });

  it("only the last few sessions are tried, so an old look-alike can't match", () => {
    const closes = new Map([
      [
        "VTI",
        series({
          "2026-10-20": 299,
          "2026-10-26": 301,
          "2026-10-27": 302,
          "2026-10-28": 303,
          "2026-10-29": 304,
        }),
      ],
    ]);
    expect(
      provenDataDay(
        [{ ticker: "VTI", shares: 10, reportedMarketValue: 2990 }],
        closes,
        "2026-10-29",
      ),
    ).toBeNull();
  });

  it("rounding, not a percentage: a large position must match to the cent, a tiny one still can", () => {
    const closes = new Map([
      ["VTI", series({ "2026-10-28": 300.0, "2026-10-29": 300.1 })],
    ]);
    // 10,000 shares: $1,000 apart between the days, cents decide.
    expect(
      provenDataDay(
        [{ ticker: "VTI", shares: 10_000, reportedMarketValue: 3_000_000 }],
        closes,
        "2026-10-29",
      ),
    ).toBe("2026-10-28");
    expect(
      provenDataDay(
        [{ ticker: "VTI", shares: 0.03, reportedMarketValue: 9.0 }],
        closes,
        "2026-10-29",
      ),
    ).toBeNull(); // both days fit a position this small: no proof
  });
});

describe("learnReportLag: evidence", () => {
  it("one Saturday deposit on a flat feed isn't a pattern", () => {
    const flat = days.map((day, i) => ({
      reportedAt: et(day, 22),
      balance: i >= 7 ? 1_500 : 1_000, // 10-17 is a Saturday
    }));
    expect(learnReportLag([flat])?.confident).toBe(false);
  });
});

describe("feedDataDay", () => {
  const reportedAt = et("2026-10-29", 22); // Thursday night
  it("proven beats learned beats assumed", () => {
    expect(
      feedDataDay({
        reportedAt,
        proven: "2026-10-27",
        learned: { lag: 1, confident: true },
      }),
    ).toEqual({ day: "2026-10-27", basis: "proven" });
    expect(
      feedDataDay({
        reportedAt,
        proven: null,
        learned: { lag: 1, confident: true },
      }),
    ).toEqual({ day: "2026-10-28", basis: "learned" });
    expect(
      feedDataDay({
        reportedAt,
        proven: null,
        learned: { lag: 1, confident: false },
      }),
    ).toEqual({ day: "2026-10-29", basis: "assumed" });
  });
  it("a one-session lag: Mon night and Sat night show Friday, Fri night Thursday", () => {
    expect(laggedSession(et("2026-10-26", 22), 1)).toBe("2026-10-23");
    expect(laggedSession(et("2026-10-24", 22), 1)).toBe("2026-10-23");
    expect(laggedSession(et("2026-10-23", 22), 1)).toBe("2026-10-22");
  });
});
