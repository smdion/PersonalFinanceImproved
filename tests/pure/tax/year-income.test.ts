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
  it("is cent-exact: streams whose float sum is 84599.99999999999 read 84600", () => {
    // In this function's term order the five streams below carry a float's
    // last bit under 84,600, the 2-person ACA cliff; the cliff needs the cent.
    const edge: YearIncome = {
      traditionalDraws: 15_821.05,
      rothConversions: 46_201.95,
      rothTaxableGrowth: 3_097.57,
      realizedGains: 7_842.51,
      socialSecurity: { gross: 11_636.92, taxable: 0 },
    };
    expect(yearMagi(edge, "aca")).toBe(84_600);
  });

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
