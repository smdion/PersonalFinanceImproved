/**
 * Answer key, the NIIT on a gap year's draw (TAX-20). Worked by hand from
 * the statute, never read from `src/`. Invented household only.
 *
 * Citations: IRC § 1411(a)(1) (3.8% of the lesser of net investment income
 * and MAGI over the threshold), § 1411(b) ($250,000 married filing
 * jointly), § 1411(d) (MAGI is adjusted gross income, wages included);
 * Form 8960 instructions (2025). IRC § 1(h) and the Qualified Dividends
 * and Capital Gain Tax Worksheet (2025) for the 15% gains rate; 2026 MFJ
 * gains brackets: 0% to 98,900 of taxable income, 15% to 613,700 (Rev.
 * Proc. 2025-32 § 4.03).
 */
import { assert, describe, it } from "vitest";
import { cents, runOneYear } from "../../fixtures/answer-key";
import {
  engineHousehold,
  type KeyHousehold,
} from "../../fixtures/answer-key-household";

// MFJ. Person 1, born 1966, retired (a $0 job that ended in 2020), owns a
// brokerage of 1,000,000 with no basis: every dollar drawn is a long-term
// gain. Person 2, born 1966, works on at $300,000 to 2030. Spending
// 400,000 leaves the year short after pay, so 2026 is a gap year that
// draws from the brokerage.
const household: KeyHousehold = {
  status: "MFJ",
  people: [
    { birthYear: 1966, job: { salary: 0, lastYear: 2020 } },
    { birthYear: 1966, job: { salary: 300_000, lastYear: 2030 } },
  ],
  brokerage: { balance: 1_000_000, basis: 0 },
  spending: 400_000,
  endYear: 2028,
};

describe("answer key: the NIIT on a gap year's draw", () => {
  it("tax/GN1 [TAX-20] wages 300,000, an all-gain brokerage draw W: its tax is 15% + 3.8% = 18.8% of W", () => {
    // Taxable wages 300,000 − 32,200 = 267,800 are past the 0% top, so
    // every gain dollar is taxed at 15% (the stack stays under 613,700
    // for any draw under 345,900); the wages' ordinary rate is 24%, above
    // 15%, so line 25 doesn't bind. MAGI = 300,000 + W is over 250,000 by
    // 50,000 + W, more than the W of investment income, so the NIIT is
    // 3.8% × W. The draw's added tax is 0.188 × W, to the cent.
    const row = runOneYear(engineHousehold(household), 2026);
    assert(row.phase === "accumulation", "2026 is a working year");
    const gap = row.gapDraw;
    assert(gap && gap.withdrawal > 0, "2026 draws from the brokerage");
    cents(
      {
        taxCost: gap.taxCost,
        withdrawalUnder: gap.withdrawal < 345_900 ? 1 : 0,
      },
      {
        taxCost: Math.round(0.188 * gap.withdrawal * 100) / 100,
        withdrawalUnder: 1,
      },
      0.02,
    );
  });
});
