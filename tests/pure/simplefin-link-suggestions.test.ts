/** Suggesting sub-account links for SimpleFIN accounts. Invented accounts. */
import { describe, it, expect } from "vitest";
import {
  sameInstitution,
  suggestLinks,
  type SubAccountCandidate,
} from "@/lib/pure/simplefin-link-suggestions";

const sub = (over: Partial<SubAccountCandidate>): SubAccountCandidate => ({
  performanceAccountId: 1,
  institution: "Example Bank",
  accountType: "ira",
  ownerPersonId: 1,
  taxType: "taxFree",
  subType: null,
  amount: 100_000,
  ...over,
});

describe("sameInstitution", () => {
  it("matches short and long spellings", () => {
    expect(sameInstitution("Example Investments", "Example")).toBe(true);
    expect(sameInstitution("Example Financial", "Other")).toBe(false);
  });
});

describe("suggestLinks", () => {
  const aliceRoth = sub({ ownerPersonId: 1, amount: 190_000 });
  const bobRoth = sub({ ownerPersonId: 2, amount: 100_000 });
  const brokerage = sub({
    performanceAccountId: 2,
    accountType: "brokerage",
    taxType: "afterTax",
    ownerPersonId: null,
    amount: 12_000,
  });

  it("tells two people's Roth IRAs apart by balance, one each", () => {
    const s = suggestLinks(
      [
        {
          id: 10,
          orgName: "Example Bank",
          accountName: "Roth IRA Brokerage Account (xxxx)",
          balance: 98_000,
        },
        {
          id: 11,
          orgName: "Example Bank",
          accountName: "Roth IRA Brokerage Account (xxxx)",
          balance: 195_000,
        },
      ],
      [aliceRoth, bobRoth, brokerage],
    );
    expect(s.find((x) => x.simplefinAccountId === 10)?.candidate).toBe(bobRoth);
    expect(s.find((x) => x.simplefinAccountId === 11)?.candidate).toBe(
      aliceRoth,
    );
  });

  it("never crosses tax treatment or account kind", () => {
    const s = suggestLinks(
      [
        {
          id: 12,
          orgName: "Example Bank",
          accountName: "Traditional IRA Account",
          balance: 100_000,
        },
      ],
      [aliceRoth, brokerage],
    );
    expect(s).toEqual([]);
  });

  it("links a brokerage by kind and institution", () => {
    const s = suggestLinks(
      [
        {
          id: 13,
          orgName: "Example Bank",
          accountName: "Brokerage Account (xxxx)",
          balance: 11_500,
        },
      ],
      [aliceRoth, brokerage],
    );
    expect(s[0]?.candidate).toBe(brokerage);
  });

  it("ignores accounts at other institutions and names it can't place", () => {
    expect(
      suggestLinks(
        [
          {
            id: 14,
            orgName: "Other Bank",
            accountName: "Roth IRA",
            balance: 1,
          },
          {
            id: 15,
            orgName: "Example Bank",
            accountName: "Everyday Checking",
            balance: 1,
          },
        ],
        [aliceRoth],
      ),
    ).toEqual([]);
  });

  it("chooses the assignment with the smallest total gap, not the first close pair", () => {
    // Greedy would give 137k to Bob (closest single gap); the best overall
    // gives it to Alice and 75k to Bob.
    const alice = sub({ ownerPersonId: 1, amount: 188_000 });
    const bob = sub({ ownerPersonId: 2, amount: 102_000 });
    const s = suggestLinks(
      [
        {
          id: 20,
          orgName: "Example Bank",
          accountName: "Roth IRA",
          balance: 137_000,
        },
        {
          id: 21,
          orgName: "Example Bank",
          accountName: "Roth IRA",
          balance: 75_000,
        },
      ],
      [alice, bob],
    );
    expect(s.find((x) => x.simplefinAccountId === 20)?.candidate).toBe(alice);
    expect(s.find((x) => x.simplefinAccountId === 21)?.candidate).toBe(bob);
  });

  it("suggests the whole account for a plan whose name gives no tax treatment", () => {
    const roth = sub({
      performanceAccountId: 5,
      accountType: "401k",
      taxType: "taxFree",
      amount: 90_000,
    });
    const pre = sub({
      performanceAccountId: 5,
      accountType: "401k",
      taxType: "preTax",
      amount: 60_000,
    });
    const [s] = suggestLinks(
      [
        {
          id: 22,
          orgName: "Example Bank",
          accountName: "EMPLOYER 401(K) PLAN",
          balance: 152_000,
        },
      ],
      [roth, pre],
    );
    expect(s?.candidate).toMatchObject({
      performanceAccountId: 5,
      taxType: null,
      ownerPersonId: null,
      amount: 150_000,
    });
  });
});
