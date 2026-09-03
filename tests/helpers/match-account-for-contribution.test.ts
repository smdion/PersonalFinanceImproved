/**
 * R35 — the 6-tier account-matching cascade that maps a contribution spec to
 * a physical account row was an unnamed, undocumented, untested inline chain
 * inside `buildProfileContribData`, in a file (`contribution.ts`) that was
 * the site of the v0.7.6 employer-match grouping bug. Extracted as
 * `matchAccountForContribution`; this file pins each precedence tier so a
 * future refactor of the chain can't silently change which account a
 * contribution lands in.
 *
 * Tiers (tightest → loosest):
 *   1. owner + taxType + accountType + parentCat
 *   2. no-owner + taxType + accountType + parentCat
 *   3. owner + taxType + parentCat            (drop accountType)
 *   4. no-owner + taxType + parentCat
 *   5. owner + parentCat                       (drop taxType)
 *   6. owner OR no-owner                       (loosest)
 */
import { describe, it, expect, vi } from "vitest";

// Same shims the sibling contribution.test.ts uses — importing the module
// pulls in the db/config barrels; the function under test touches none of them.
vi.mock("@/lib/db/schema", () => ({
  contributionAccounts: {},
  jobs: {},
  people: {},
  performanceAccounts: {},
  contributionProfiles: {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/config/account-types", () => ({
  isTaxFree: (t: string) => t === "roth" || t === "after_tax",
  buildCategoryRecord: (fn: () => unknown) =>
    Object.fromEntries(
      ["401k", "ira", "brokerage", "hsa"].map((c) => [c, fn()]),
    ),
  categoriesWithTaxPreference: () => ["401k", "ira"],
  getAllCategories: () => ["401k", "ira", "brokerage", "hsa"],
  getDisplayGroup: () => "retirement",
  getParentCategory: (c: string) => c,
}));
vi.mock("@/lib/config/display-labels", () => ({
  TAX_TREATMENT_TO_TAX_TYPE: { pre_tax: "traditional", roth: "roth" },
}));

import {
  matchAccountForContribution,
  type BreakdownAccount,
} from "@/server/helpers/contribution";

const CRIT = {
  contribOwner: "Sean" as string | undefined,
  matchTaxType: "traditional" as string | undefined,
  accountType: "401k" as string | undefined,
  contribParentCat: "Retirement" as string | undefined,
};

const acct = (o: Partial<BreakdownAccount>): BreakdownAccount => ({
  name: "acc",
  taxType: "traditional",
  accountType: "401k",
  ownerName: "Sean",
  parentCategory: "Retirement",
  ...o,
});

describe("matchAccountForContribution — tier precedence", () => {
  it("tier 1: prefers exact owner + taxType + accountType + parentCat over every looser row", () => {
    const accts = [
      acct({ name: "loose-owner-only", taxType: "roth", accountType: "ira" }),
      acct({ name: "no-owner-exact", ownerName: undefined }),
      acct({ name: "EXACT" }),
    ];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe("EXACT");
  });

  it("tier 2: falls to a no-owner (joint) row matching taxType + accountType + parentCat when no exact-owner row exists", () => {
    const accts = [
      acct({ name: "wrong-owner", ownerName: "Joanna" }),
      acct({ name: "JOINT", ownerName: undefined }),
      acct({ name: "owner-but-wrong-tax", taxType: "roth" }),
    ];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe("JOINT");
  });

  it("tier 3: drops the accountType requirement (owner + taxType + parentCat)", () => {
    const accts = [
      acct({ name: "owner-wrong-acctType", accountType: "403b" }),
      acct({
        name: "no-owner-wrong-acctType",
        ownerName: undefined,
        accountType: "403b",
      }),
    ];
    // no tier-1/2 match (accountType differs); tier 3 = exact owner still wins over tier 4
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe(
      "owner-wrong-acctType",
    );
  });

  it("tier 4: no-owner + taxType + parentCat when accountType differs and there's no owner row", () => {
    const accts = [
      acct({
        name: "wrong-owner-wrong-acct",
        ownerName: "Joanna",
        accountType: "403b",
      }),
      acct({
        name: "JOINT-wrong-acct",
        ownerName: undefined,
        accountType: "403b",
      }),
    ];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe(
      "JOINT-wrong-acct",
    );
  });

  it("tier 5: drops taxType too (owner + parentCat) when nothing matches taxType", () => {
    const accts = [
      acct({ name: "owner-roth-403b", taxType: "roth", accountType: "403b" }),
      acct({
        name: "joint-roth-403b",
        ownerName: undefined,
        taxType: "roth",
        accountType: "403b",
      }),
    ];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe(
      "owner-roth-403b",
    );
  });

  it("tier 6 (loosest): any owner-or-joint row when even parentCat/taxType/accountType all differ", () => {
    const accts = [
      acct({
        name: "totally-different-but-mine",
        taxType: "roth",
        accountType: "hsa",
        parentCategory: "HSA",
      }),
    ];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe(
      "totally-different-but-mine",
    );
  });

  it("returns undefined when no row is even loosely the household's (all rows owned by someone else)", () => {
    const accts = [acct({ name: "hers", ownerName: "Joanna" })];
    expect(matchAccountForContribution(accts, CRIT)).toBeUndefined();
  });

  it("returns undefined for an empty category", () => {
    expect(matchAccountForContribution([], CRIT)).toBeUndefined();
  });
});

describe("matchAccountForContribution — parentCategory 'matches anything' rule", () => {
  it("a row with no parentCategory matches a spec that has one", () => {
    const accts = [acct({ name: "no-pc", parentCategory: undefined })];
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe("no-pc");
  });

  it("a spec with no parentCategory matches a row that has one", () => {
    const accts = [acct({ name: "row-has-pc" })];
    expect(
      matchAccountForContribution(accts, {
        ...CRIT,
        contribParentCat: undefined,
      })!.name,
    ).toBe("row-has-pc");
  });

  it("mismatched non-empty parentCategories block tiers 1–5, dropping to the loosest tier", () => {
    const accts = [
      acct({ name: "mine-wrong-pc", parentCategory: "Brokerage" }),
      acct({ name: "joint-right-pc", ownerName: undefined }),
    ];
    // tiers 2/4 require the no-owner row; "mine-wrong-pc" is blocked from
    // tiers 1/3/5 by the parentCat mismatch, so the joint row wins at tier 2.
    expect(matchAccountForContribution(accts, CRIT)!.name).toBe(
      "joint-right-pc",
    );
  });
});

describe("matchAccountForContribution — undefined contribOwner (spec with no person)", () => {
  it("only matches joint (no-owner) rows; exactOwner becomes ownerName===undefined", () => {
    const crit = { ...CRIT, contribOwner: undefined };
    const accts = [
      acct({ name: "someones", ownerName: "Sean" }),
      acct({ name: "joint", ownerName: undefined }),
    ];
    expect(matchAccountForContribution(accts, crit)!.name).toBe("joint");
  });
});
