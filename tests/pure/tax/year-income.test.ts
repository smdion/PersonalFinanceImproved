import { describe, it, expect } from "vitest";
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";

/** An invented retiree year: every stream set, so each one shows in a sum. */
const income: YearIncome = {
  traditionalDraws: 30_000,
  rothConversions: 5_000,
  rothTaxableGrowth: 1_000,
  realizedGains: 2_000,
  socialSecurity: { gross: 24_000, taxable: 12_000 },
};
const agiStreams = 30_000 + 5_000 + 1_000 + 2_000;

describe("yearMagi", () => {
  it("aca adds the whole Social Security benefit (IRC § 36B(d)(2)(B))", () => {
    expect(yearMagi(income, "aca")).toBe(agiStreams + 24_000);
  });

  it.each(["irmaa", "niit", "seniorDeduction"] as const)(
    "%s adds only the taxable share of Social Security",
    (rule) => {
      expect(yearMagi(income, rule)).toBe(agiStreams + 12_000);
    },
  );

  it("counts non-qualified Roth growth like any other ordinary income", () => {
    const withoutGrowth = { ...income, rothTaxableGrowth: 0 };
    expect(yearMagi(income, "aca")).toBe(
      yearMagi(withoutGrowth, "aca") + 1_000,
    );
  });

  it("asks only for the Social Security reading the rule uses", () => {
    const streams = {
      traditionalDraws: 10_000,
      rothConversions: 0,
      realizedGains: 0,
      rothTaxableGrowth: 0,
    };
    expect(
      yearMagi({ ...streams, socialSecurity: { gross: 3_000 } }, "aca"),
    ).toBe(13_000);
    // @ts-expect-error IRMAA reads the taxable share, which this lacks.
    yearMagi({ ...streams, socialSecurity: { gross: 3_000 } }, "irmaa");
  });
});
