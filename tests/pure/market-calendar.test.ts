import { describe, it, expect } from "vitest";
import {
  marketHolidays,
  isTradingDay,
  tradingDayOnOrBefore,
  valuationDateFor,
} from "@/lib/pure/market-calendar";

describe("marketHolidays", () => {
  it("matches the published NYSE 2025 schedule", () => {
    expect([...marketHolidays(2025)].sort()).toEqual([
      "2025-01-01",
      "2025-01-20",
      "2025-02-17",
      "2025-04-18",
      "2025-05-26",
      "2025-06-19",
      "2025-07-04",
      "2025-09-01",
      "2025-11-27",
      "2025-12-25",
    ]);
  });

  it("observes weekend holidays on the nearest weekday", () => {
    // 2026: Independence Day is a Saturday → observed Friday Jul 3.
    expect(marketHolidays(2026).has("2026-07-03")).toBe(true);
    // 2022: Christmas is a Sunday → observed Monday Dec 26.
    expect(marketHolidays(2022).has("2022-12-26")).toBe(true);
  });

  it("does not observe a Saturday New Year's Day on the prior Friday", () => {
    // 2022-01-01 was a Saturday; NYSE was open Friday 2021-12-31.
    expect(marketHolidays(2021).has("2021-12-31")).toBe(false);
    expect(marketHolidays(2022).has("2021-12-31")).toBe(false);
  });

  it("only includes Juneteenth from 2022", () => {
    expect(marketHolidays(2021).has("2021-06-18")).toBe(false);
    expect(marketHolidays(2022).has("2022-06-20")).toBe(true);
  });
});

describe("tradingDayOnOrBefore", () => {
  it("keeps a trading day and rolls weekends and holidays back", () => {
    expect(tradingDayOnOrBefore("2026-10-09")).toBe("2026-10-09"); // Friday
    expect(tradingDayOnOrBefore("2026-10-11")).toBe("2026-10-09"); // Sunday
    expect(tradingDayOnOrBefore("2025-11-27")).toBe("2025-11-26"); // Thanksgiving
    expect(isTradingDay("2026-04-03")).toBe(false); // Good Friday 2026
  });
});

describe("valuationDateFor", () => {
  it("maps an overnight report to the previous session's close", () => {
    // Saturday 08:09 UTC = Saturday 04:09 ET → Friday's close.
    expect(valuationDateFor(new Date("2026-10-10T08:09:11Z"))).toBe(
      "2026-10-09",
    );
    // Tuesday 07:00 UTC = Tuesday 03:00 ET → Monday's close.
    expect(valuationDateFor(new Date("2026-10-13T07:00:00Z"))).toBe(
      "2026-10-12",
    );
  });

  it("uses the same day once the market has closed", () => {
    // Monday 21:30 UTC = 17:30 ET (EDT) → Monday's close.
    expect(valuationDateFor(new Date("2026-10-12T21:30:00Z"))).toBe(
      "2026-10-12",
    );
  });

  it("rolls back over a holiday weekend", () => {
    // Tuesday after Labor Day 2026 (Sep 7), early morning → Friday Sep 4.
    expect(valuationDateFor(new Date("2026-09-08T08:00:00Z"))).toBe(
      "2026-09-04",
    );
  });
});
