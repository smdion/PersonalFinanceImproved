import { describe, it, expect } from "vitest";
import { currentMonthKey } from "@/lib/pure/date-keys";

describe("currentMonthKey", () => {
  it("formats as YYYY-MM-01, ignoring the day of month", () => {
    expect(currentMonthKey(new Date(2026, 8, 1))).toBe("2026-09-01");
    expect(currentMonthKey(new Date(2026, 8, 15))).toBe("2026-09-01");
    expect(currentMonthKey(new Date(2026, 8, 30))).toBe("2026-09-01");
  });

  it("pads single-digit months with a leading zero", () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe("2026-01-01");
  });

  it("does not pad October-December (already two digits)", () => {
    expect(currentMonthKey(new Date(2026, 9, 1))).toBe("2026-10-01");
    expect(currentMonthKey(new Date(2026, 11, 31))).toBe("2026-12-01");
  });
});
