/**
 * The Roth conversion counts only Retirement money, as it stands when the
 * conversion runs: a lump sum into a Portfolio account earlier in the same
 * year stays out of the conversion and its tax.
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { acct, household } from "../fixtures/two-person-household";
import { withRothConversions } from "../fixtures/engine-arbitraries";

const YEAR = 2027;

/** Ann's IRA, an empty Retirement brokerage and a Portfolio brokerage;
 *  conversions on, the year's lump sum into the Portfolio brokerage. */
function run(lumpSum: number) {
  const retirement = (a: IndividualAccountInput) => ({
    ...a,
    parentCategory: "Retirement",
  });
  const accounts = [
    retirement(acct("Ann IRA", "ira", 500_000, 1, "preTax")),
    retirement(acct("Ann Brokerage", "brokerage", 0, 1, "afterTax")),
    {
      ...acct("Ann Portfolio Brokerage", "brokerage", 10_000, 1, "afterTax"),
      parentCategory: "Portfolio",
    },
  ];
  const input = withRothConversions(
    household(accounts, {
      decumulationOverrides: [
        {
          year: YEAR,
          lumpSums: [
            {
              amount: lumpSum,
              targetAccount: "brokerage",
              targetAccountName: "Ann Portfolio Brokerage",
              targetOwnerPersonId: 1,
            },
          ],
        },
      ],
    }),
  );
  const row = calculateProjection(input).projectionByYear.find(
    (y): y is EngineDecumulationYear =>
      y.phase === "decumulation" && y.year === YEAR,
  )!;
  const balance = (name: string) =>
    row.individualAccountBalances.find((r) => r.name === name)!.balance;
  return { row, balance };
}

describe("the conversion in a year with a lump sum into a Portfolio account", () => {
  it("pays no tax the empty Retirement brokerage can't, and leaves the Portfolio brokerage whole", () => {
    // The Retirement brokerage holds $0, so the conversion's tax can come
    // from nowhere: it stays within the room that costs no tax. The $50,000
    // lump sum is Portfolio money, never the conversion's.
    const { row, balance } = run(50_000);
    expect(row.rothConversionTaxCost).toBe(0);
    expect(balance("Ann Portfolio Brokerage")).toBe(60_000);
    expect(balance("Ann Brokerage")).toBe(0);
  });
});
