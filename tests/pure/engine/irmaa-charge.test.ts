/**
 * The year's IRMAA charge paid on top of the budget: paid from what the year
 * has to spend, and the unpaid rest is unmet need, never spending below $0.
 * Self-derived: 6,936.00 is the 2026 top tier for one person
 * (($487.00 + $91.00) × 12, CMS 2026).
 */
import { describe, expect, it } from "vitest";
import {
  payIrmaaCharge,
  type IrmaaCharge,
} from "@/lib/pure/engine/projection-year-handlers/irmaa-charge";
import { fundingShortfallForYear } from "@/lib/pure/engine/projection-year-handlers/funding-shortfall";

const charge = (atYearStart: boolean): IrmaaCharge => ({
  cost: 6936,
  onTop: 6936,
  taxYear: { year: 2028, magi: 600_000, rothConversion: 0 },
  atYearStart,
  warnings: [],
});
const spend = { config: { rmdExcessHandling: "spend" }, ssIncome: 2000 };
const reinvest = { config: { rmdExcessHandling: "reinvest" }, ssIncome: 0 };
const needSized = { portfolioWithdrawal: null };
const withdrawalSized = { portfolioWithdrawal: 40_000 };

describe("payIrmaaCharge", () => {
  it("a year with enough to spend pays the whole charge", () => {
    const paid = payIrmaaCharge(charge(true), withdrawalSized, spend as never, {
      deliveredAfterTax: 30_000,
      rmdExcessAmount: 0,
    });
    expect(paid).toEqual({ paid: 6936, unpaid: 0, reinvested: 0 });
  });

  it("a withdrawal-sized year pays what it has; the rest is unpaid", () => {
    // 1,000 delivered + 2,000 Social Security = 3,000 paid; 3,936 unpaid.
    const paid = payIrmaaCharge(charge(true), withdrawalSized, spend as never, {
      deliveredAfterTax: 1000,
      rmdExcessAmount: 0,
    });
    expect(paid).toEqual({ paid: 3000, unpaid: 3936, reinvested: 0 });
  });

  it("RMD money reinvested isn't there to pay it", () => {
    const paid = payIrmaaCharge(
      charge(true),
      withdrawalSized,
      reinvest as never,
      {
        deliveredAfterTax: 5000,
        rmdExcessAmount: 4000,
      },
    );
    expect(paid).toEqual({ paid: 1000, unpaid: 5936, reinvested: 4000 });
  });

  it("a need-sized year's need already holds the year-start charge: nothing more is unmet", () => {
    const paid = payIrmaaCharge(charge(true), needSized, spend as never, {
      deliveredAfterTax: 0,
      rmdExcessAmount: 0,
    });
    expect(paid).toEqual({ paid: 2000, unpaid: 0, reinvested: 0 });
  });

  it("a charge read from the year's own MAGI isn't in the need: its unpaid rest is", () => {
    const paid = payIrmaaCharge(charge(false), needSized, spend as never, {
      deliveredAfterTax: 0,
      rmdExcessAmount: 0,
    });
    expect(paid).toEqual({ paid: 2000, unpaid: 4936, reinvested: 0 });
  });
});

describe("fundingShortfallForYear: a withdrawal-sized year that runs out", () => {
  it("adds the unpaid surcharge to the unmet need", () => {
    // Strategy amount 40,000; 1,000 left the portfolio (39,000 short), and
    // 3,936 of the 6,936 surcharge couldn't be paid: 42,936 unmet.
    const result = fundingShortfallForYear(
      withdrawalSized,
      { ...spend, taxRates: { grossUpForTaxes: true } } as never,
      {
        rmd: { totalWithdrawal: 1000 },
        repriced: { taxCost: 0 },
        parts: { penaltyCost: 0, surplusCredit: () => 0 },
        need: { afterTaxNeed: 40_000 },
        route: { routedUnmetNeed: undefined },
        settle: { rmdExcessAmount: 0 },
      } as never,
      { irmaa: charge(true) },
    );
    expect(result.irmaaPayment.paid).toBe(3000);
    expect(result.unmetNeedRaw).toBe(42_936);
    expect(result.unmetNeedMaterial).toBe(true);
  });

  it("a no-gross-up household's netting leaves the unpaid surcharge unmet", () => {
    // Tax 2,000 nets out of the 39,000 gap at most; the 3,936 stays.
    const result = fundingShortfallForYear(
      withdrawalSized,
      { ...spend, taxRates: { grossUpForTaxes: false } } as never,
      {
        rmd: { totalWithdrawal: 3000 },
        repriced: { taxCost: 2000 },
        parts: { penaltyCost: 0, surplusCredit: () => 0 },
        need: { afterTaxNeed: 40_000 },
        route: { routedUnmetNeed: undefined },
        settle: { rmdExcessAmount: 0 },
      } as never,
      { irmaa: charge(true) },
    );
    // 1,000 delivered + 2,000 Social Security paid; 37,000 + 3,936 unmet.
    expect(result.irmaaPayment.unpaid).toBe(3936);
    expect(result.unmetNeedRaw).toBe(40_936);
    expect(result.unmetNeedMaterial).toBe(true);
  });
});
