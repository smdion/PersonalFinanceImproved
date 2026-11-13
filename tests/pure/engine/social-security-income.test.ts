/**
 * `socialSecurityForYear`'s per-person entries: nothing before the start
 * age, the entry's amount from it, and a later amount from the year the
 * other spouse files (the spousal excess's start).
 */
import { describe, expect, it } from "vitest";
import { socialSecurityForYear } from "@/lib/pure/engine/social-security-income";

const paid = (year: number) =>
  socialSecurityForYear(
    {
      socialSecurityEntries: [
        {
          personId: 2,
          personName: "B",
          annualAmount: 8_400,
          startAge: 62,
          birthYear: 1965,
          fromSpouseFiling: { year: 2030, annualAmount: 12_900 },
        },
      ],
      socialSecurityAnnual: 0,
      ssStartAge: 67,
      asOfDate: new Date("2026-01-01"),
    },
    year,
    0,
    1,
  ).ssIncome;

describe("socialSecurityForYear with a later spousal amount", () => {
  it("pays nothing before the start age", () => {
    expect(paid(2026)).toBe(0);
  });

  it("pays the entry's amount from the start age until the spouse files", () => {
    expect(paid(2027)).toBe(8_400);
    expect(paid(2029)).toBe(8_400);
  });

  it("pays the later amount from the spouse's filing year on", () => {
    expect(paid(2030)).toBe(12_900);
    expect(paid(2040)).toBe(12_900);
  });
});
