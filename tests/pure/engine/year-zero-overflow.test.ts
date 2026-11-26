/**
 * A year-0 brokerage slot cut below the year's IRS overflow: the overflow is
 * part of its slot, so the parts take no more than the slot's money, as the
 * category does.
 */
import { describe, expect, it } from "vitest";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import { distributeContributions } from "@/lib/pure/engine/individual-accounts/contributions";
import { specKeyOf } from "@/lib/pure/engine/individual-accounts/ledger";
import { openingTotals } from "@/lib/pure/engine/opening-parts";
import { creditYearContributions } from "@/lib/pure/engine/projection-year-handlers/contribution-credits";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";
import {
  makeAccumulationSlot,
  makeContributionSpec,
  makeIndividualAccount,
  paysInto,
} from "../fixtures/engine-fixtures";

describe("a year-0 brokerage slot below the year's overflow", () => {
  it("a $100 slot holding a $300 overflow: the parts take $100, as the category does", () => {
    const brokerage = makeIndividualAccount({
      name: "Retirement brokerage",
      category: "brokerage",
      taxType: "afterTax",
      parentCategory: "Retirement",
      startingBalance: 1000,
      startingBasis: 1000,
    });
    const parts = [brokerage];
    const key = accountIdKeyOf(brokerage);
    const spec = makeContributionSpec({
      name: brokerage.name,
      category: "brokerage",
      taxTreatment: "after_tax",
      method: "fixed_monthly",
      baseAnnual: 400,
      parentCategory: "Retirement",
      contributionAccountId: 1,
      account: paysInto(brokerage),
    });
    const { balances, accountBalance } = openingTotals(parts);
    const indBalance = new Map([[key, 1000]]);
    const brokBasis = new Map([[key, 1000]]);
    const ctx = {
      ledgerRuns: true,
      indAccounts: parts,
      indKey: accountIdKeyOf,
      lumpSumTargets: new Map(),
    };
    const state = { balances, accountBalance, indBalance, brokBasis };
    // Year 0's cut leaves the slot $100; the overflow is pro-rated only.
    const slots = [makeAccumulationSlot("brokerage", { employeeContrib: 100 })];

    creditYearContributions(
      slots,
      balances,
      accountBalance,
      0,
      "brokerage",
      parts,
      accountIdKeyOf,
      indBalance,
      brokBasis,
      // eslint-disable-next-line no-restricted-syntax -- only the lump sums are read
      { lumpSums: [] } as unknown as Parameters<
        typeof creditYearContributions
      >[9],
      // eslint-disable-next-line no-restricted-syntax -- only the fields the lump sums read
      ctx as unknown as ProjectionContext,
      // eslint-disable-next-line no-restricted-syntax -- only the fields the lump sums read
      state as unknown as ProjectionLoopState,
    );
    const { indOverflow } = distributeContributions({
      slots,
      contributionSpecs: [spec],
      indAccounts: parts,
      indKey: accountIdKeyOf,
      indBalance,
      indParentCat: new Map([[key, "Retirement"]]),
      specToAccount: new Map([[specKeyOf(spec), [key]]]),
      accountsWithSpecs: new Set([key]),
      projectedSalary: 100000,
      currentSalary: 100000,
      limitGrowthRate: 0,
      yearIndex: 0,
      proRate: 0.5,
      useRealContributions: false,
      overflowToBrokerage: 300,
      rampAmount: 0,
    });

    expect(accountBalance.brokerage).toMatchObject({ balance: 1100 });
    expect(indBalance.get(key)).toBe(1100);
    expect(indOverflow.get(key)).toBe(100);
  });
});
