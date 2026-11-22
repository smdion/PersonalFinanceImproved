import { describe, expect, it } from "vitest";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { withAccountId } from "./engine-input";

const part = (
  overrides: Partial<IndividualAccountInput>,
): IndividualAccountInput => ({
  name: "Brokerage",
  category: "brokerage",
  taxType: "afterTax",
  startingBalance: 1000,
  ownerPersonId: 1,
  ...overrides,
});

const idOf = (overrides: Partial<IndividualAccountInput>) =>
  withAccountId(part(overrides)).performanceAccountId;

describe("withAccountId", () => {
  it("gives same-named accounts of one category but two parents two ids", () => {
    expect(idOf({ parentCategory: "Retirement" })).not.toBe(
      idOf({ parentCategory: "Portfolio" }),
    );
  });

  it("gives an account's parts one id, whatever their owner and tax type", () => {
    const id = idOf({ parentCategory: "Portfolio" });
    expect(idOf({ parentCategory: "Portfolio", ownerPersonId: 2 })).toBe(id);
    expect(idOf({ parentCategory: "Portfolio", taxType: "preTax" })).toBe(id);
  });

  it("reads no parent as Retirement money, as the projection does", () => {
    expect(idOf({})).toBe(idOf({ parentCategory: "Retirement" }));
  });

  it("keeps an id the test wrote", () => {
    expect(idOf({ performanceAccountId: 7 })).toBe(7);
  });
});
