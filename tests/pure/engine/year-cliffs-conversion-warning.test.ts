/**
 * `yearCliffChecks`' conversion warning reads the conversion inside the MAGI
 * it was given: the tax year two back (RR9), not this year's. Self-derived
 * on the 2026 joint table (> 218,000 the first tier, 1,148.40 a person;
 * > 274,000 the second, 2,884.80).
 */
import { describe, expect, it } from "vitest";
import { yearCliffChecks } from "@/lib/pure/engine/projection-year-handlers/year-cliffs";
import type { IrmaaTaxYears } from "@/lib/pure/engine/projection-year-handlers/irmaa-lookback";
import type { YearIncome } from "@/lib/pure/tax/year-income";
import { shippedTaxTables } from "../../helpers/tax-data";

const income = (rothConversions: number): YearIncome => ({
  traditionalDraws: 50_000,
  rothConversions,
  rothTaxableGrowth: 0,
  realizedGains: 0,
  socialSecurity: { gross: 0, taxable: 0 },
});

/** 2028, MFJ, one person 65+, with 2026 recorded as given. */
function run2028(
  year2026: { magi: number; rothConversion: number },
  thisYearsConversion: number,
) {
  const irmaaTaxYears: IrmaaTaxYears = new Map([
    [2026, { year: 2026, ...year2026 }],
  ]);
  const routeWarnings: string[] = [];
  const result = yearCliffChecks(
    { input: { filingStatus: "MFJ", irmaaOnTopOfBudget: true } } as never,
    { incomeHistory: [], irmaaTaxYears } as never,
    {
      year: 2028,
      personsAge65Plus: 1,
      personsUnder65: 0,
      tables: {
        grownIrmaaBracketsForCheck: shippedTaxTables(2026).irmaaBrackets,
        fplGrowthFactor: 1,
      },
      taxRates: { fplByHousehold: {} },
    } as never,
    {
      route: { routeWarnings },
      repriced: { income: income(thisYearsConversion) },
      conversion: { rothConversionAmount: thisYearsConversion },
    } as never,
  );
  return { irmaaCost: result.irmaaCost, routeWarnings };
}

describe("yearCliffChecks: the conversion warning", () => {
  it("this year's conversion isn't taken out of 2026's MAGI", () => {
    // 2026: 300,000 with no conversion, the second tier. This year's
    // 100,000 conversion is in 2030's premiums, not 2028's: no warning
    // (taking it out of 2026's 300,000 would claim it crossed 218,000).
    const { irmaaCost, routeWarnings } = run2028(
      { magi: 300_000, rothConversion: 0 },
      100_000,
    );
    expect(irmaaCost).toBeCloseTo(2884.8, 2);
    expect(routeWarnings.filter((w) => w.includes("Roth conversion"))).toEqual(
      [],
    );
  });

  it("2026's own conversion that crossed a tier is named", () => {
    // 2026: 220,000 including a 20,000 conversion; 200,000 without it is
    // under 218,000, so the conversion bought the first tier.
    const { irmaaCost, routeWarnings } = run2028(
      { magi: 220_000, rothConversion: 20_000 },
      0,
    );
    expect(irmaaCost).toBeCloseTo(1148.4, 2);
    const [warning] = routeWarnings.filter((w) =>
      w.includes("Roth conversion"),
    );
    expect(warning).toContain("the 2026 Roth conversion of $20000");
    expect(warning).toContain("a person");
  });
});
