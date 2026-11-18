import { describe, it, expect } from "vitest";
import { accountIdKeyOf, accountKeyOf } from "@/lib/pure/accounts/account-part";

const part = {
  name: "Alex 401k",
  category: "401k",
  taxType: "preTax",
  ownerPersonId: 1,
} as const;

describe("accountKeyOf", () => {
  it("keys a part by name and category, its tax type and its owner", () => {
    expect(accountKeyOf(part)).toBe("Alex 401k::401k::preTax::1");
    expect(accountKeyOf({ ...part, ownerPersonId: null })).toBe(
      "Alex 401k::401k::preTax::joint",
    );
  });
});

describe("accountIdKeyOf", () => {
  it("keys a part with a performance account by that account", () => {
    expect(
      accountIdKeyOf({
        ...part,
        performanceAccountId: 7,
        portfolioAccountId: 90,
      }),
    ).toBe("acct:7:401k::preTax::1");
  });

  it("keys a part with no performance account by its snapshot row", () => {
    expect(accountIdKeyOf({ ...part, portfolioAccountId: 90 })).toBe(
      "row:90:401k::preTax::1",
    );
  });

  it("keys the engine's own parts by category, and a projected one by its parent too", () => {
    expect(
      accountIdKeyOf({
        category: "brokerage",
        taxType: "afterTax",
        origin: "projected",
        parentCategory: "Retirement",
      }),
    ).toBe("projected:brokerage:Retirement::afterTax::joint");
    expect(
      accountIdKeyOf({
        category: "ira",
        taxType: "taxFree",
        origin: "synthetic",
      }),
    ).toBe("synthetic:ira::taxFree::joint");
  });

  it("keeps one account's parts of two categories apart", () => {
    const held = { ...part, performanceAccountId: 7 };
    expect(accountIdKeyOf({ ...held, category: "ira" })).not.toBe(
      accountIdKeyOf(held),
    );
    const row = { ...part, portfolioAccountId: 90 };
    expect(accountIdKeyOf({ ...row, category: "ira" })).not.toBe(
      accountIdKeyOf(row),
    );
  });

  it("keeps a declared sibling apart from its source by its tax type", () => {
    const held = { ...part, performanceAccountId: 7 };
    const sibling = {
      ...held,
      taxType: "taxFree",
      origin: "declared",
    } as const;
    expect(accountIdKeyOf(sibling)).not.toBe(accountIdKeyOf(held));
  });

  it("refuses a part with no account id and no snapshot row", () => {
    expect(() => accountIdKeyOf(part)).toThrow(/no performance account/);
  });
});
