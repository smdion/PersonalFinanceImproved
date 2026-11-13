/** A check past an account's covered paydays takes only the limit room left, and FICA-exempt money
 *  only up to what the exempt cap leaves (checkMoneyFor). */
import { describe, expect, it } from "vitest";
import { account, job } from "../fixtures/paycheck-answer-key";
import { checkMoneyFor } from "@/lib/pure/paycheck/extra-check";
import type { ContributionAccountInput } from "@/lib/pure/paycheck/paycheck.types";

const usual = {
  preTax: 1_000,
  postTax: 0,
  ficaBase: 5_000,
  federalTaxableGross: 4_000,
  federalWithholding: 500,
};
const k401 = (room: number, coveredChecks = 26): ContributionAccountInput => ({
  ...account({
    name: "401k",
    perCheck: 1_000,
    checks: 26,
    treatment: "pre_tax",
  }),
  coveredChecks,
  extraCheckLimit: { group: "401k", room },
});
const moneyFor = (accounts: ContributionAccountInput[]) =>
  checkMoneyFor(job({ salary: 130_000, period: "biweekly", accounts }), usual);

describe("checkMoneyFor", () => {
  it("a covered payday is the usual check", () => {
    expect(moneyFor([k401(0)])(26)).toBe(usual);
  });

  it("past the covered paydays with part of the room: it cuts what it can't take", () => {
    const check = moneyFor([k401(400)])(27);
    expect(check.cut).toEqual({ preTax: 600, postTax: 0, ficaExempt: 0 });
    expect(check.preTax).toBe(400);
    expect(check.federalTaxableGross).toBe(4_600);
    expect(check.federalWithholding).toBeGreaterThan(usual.federalWithholding);
  });

  it("no room: the whole amount is cut", () => {
    expect(moneyFor([k401(0)])(27).cut?.preTax).toBe(1_000);
  });

  it("the room is used up payday by payday", () => {
    const money = moneyFor([k401(1_500, 25)]);
    expect(money(26).cut).toBeUndefined();
    expect(money(27).cut?.preTax).toBe(500);
  });

  it("an exempt cap used up: the money is taken, but it's FICA wages", () => {
    // HSA 200 a check, exempt cap 5,200 = 26 × 200: none left for payday 27.
    const hsa: ContributionAccountInput = {
      ...account({
        name: "HSA",
        perCheck: 200,
        checks: 26,
        treatment: "hsa",
        ficaExemptAnnualCap: 5_200,
      }),
      coveredChecks: 26,
      extraCheckLimit: { group: "hsa", room: 1_000 },
    };
    const check = moneyFor([hsa])(27);
    expect(check.cut).toEqual({ preTax: 0, postTax: 0, ficaExempt: 200 });
    expect(check.ficaBase).toBe(5_200);
  });
});
